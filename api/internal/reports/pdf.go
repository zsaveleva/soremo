package reports

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"sync"
	"time"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"

	"github.com/soremo/city/api/internal/blob"
)

// PDFRenderer prints the web report page in headless Chromium, so the PDF
// uses exactly the same template, fonts and styles as the browser (ТЗ 8.1).
type PDFRenderer struct {
	// BaseURL is where Chromium reaches the frontend (http://web in compose).
	BaseURL string
	// ChromeURL — адрес удалённого Chromium (ws://… или http://host:9222); пусто — локальный Chrome.
	ChromeURL string
	Blobs     blob.Store
	// Token issues a short-lived token that can read only the given report.
	Token func(reportID string) (string, error)

	mu sync.Mutex // один рендер за раз: Chromium тяжёлый
}

// Cached returns the stored PDF under key or renders path and stores it.
// reportID is empty for public pages (demo reports).
func (p *PDFRenderer) Cached(ctx context.Context, key, path, reportID string) ([]byte, error) {
	if b, err := blob.ReadAll(ctx, p.Blobs, key); err == nil {
		return b, nil
	} else if !errors.Is(err, blob.ErrNotFound) {
		return nil, err
	}
	// Рендер не прерывается, если клиент ушёл: готовый PDF всё равно попадёт в кеш.
	ctx = context.WithoutCancel(ctx)
	pdf, err := p.render(ctx, path, reportID)
	if err != nil {
		return nil, err
	}
	if err := p.Blobs.Put(ctx, key, bytes.NewReader(pdf), int64(len(pdf)), "application/pdf"); err != nil {
		return nil, err
	}
	return pdf, nil
}

func (p *PDFRenderer) render(ctx context.Context, path, reportID string) ([]byte, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	url := p.BaseURL + path
	if reportID != "" {
		tok, err := p.Token(reportID)
		if err != nil {
			return nil, err
		}
		url += "?token=" + tok
	}

	var alloc context.Context
	var cancelAlloc context.CancelFunc
	if p.ChromeURL != "" {
		alloc, cancelAlloc = chromedp.NewRemoteAllocator(ctx, resolveHost(p.ChromeURL))
	} else {
		alloc, cancelAlloc = chromedp.NewExecAllocator(ctx, append(chromedp.DefaultExecAllocatorOptions[:],
			chromedp.Flag("headless", "new"))...)
	}
	defer cancelAlloc()
	cctx, cancel := chromedp.NewContext(alloc)
	defer cancel()
	cctx, cancelT := context.WithTimeout(cctx, 45*time.Second)
	defer cancelT()

	var pdf []byte
	err := chromedp.Run(cctx,
		chromedp.EmulateViewport(1200, 1600),
		chromedp.Navigate(url),
		// Страница ставит data-print-ready, когда отчёт и шрифты загружены.
		chromedp.WaitReady(`body[data-print-ready="1"]`, chromedp.ByQuery),
		chromedp.ActionFunc(func(ctx context.Context) error {
			var err error
			pdf, _, err = page.PrintToPDF().
				WithPrintBackground(true).
				WithPreferCSSPageSize(true).
				WithDisplayHeaderFooter(true).
				WithHeaderTemplate(`<span></span>`).
				WithFooterTemplate(`<div style="width:100%;padding:0 16mm;font:8px system-ui,sans-serif;color:#5C5A55;display:flex;justify-content:space-between">` +
					`<span>SOREMO CITY</span><span>Стр. <span class="pageNumber"></span> из <span class="totalPages"></span></span></div>`).
				Do(ctx)
			return err
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("render pdf %s: %w", path, err)
	}
	return pdf, nil
}

// resolveHost replaces a host name with its IP: Chromium refuses DevTools
// requests whose Host header is not an IP address or localhost.
func resolveHost(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || net.ParseIP(u.Hostname()) != nil || u.Hostname() == "localhost" {
		return raw
	}
	ips, err := net.LookupIP(u.Hostname())
	if err != nil || len(ips) == 0 {
		return raw
	}
	u.Host = net.JoinHostPort(ips[0].String(), u.Port())
	return u.String()
}
