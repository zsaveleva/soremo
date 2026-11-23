package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/soremo/city/api/internal/access"
	"github.com/soremo/city/api/internal/buildings"
	"github.com/soremo/city/api/internal/reports"
	"github.com/soremo/city/api/internal/store"
)

type reportsHandler struct {
	svc  *reports.Service
	demo *reports.Demo
	pdf  *reports.PDFRenderer
	q    *store.Queries
}

func (h *reportsHandler) start(w http.ResponseWriter, r *http.Request) {
	bid, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Объект не найден.", nil)
		return
	}
	p, _ := principal(r)
	id, err := h.svc.Start(r.Context(), p.UserID, bid)
	switch {
	case errors.Is(err, buildings.ErrNotFound):
		writeError(w, http.StatusNotFound, CodeNotFound, "Объект не найден.", nil)
	case errors.Is(err, access.ErrNoAccess):
		writeError(w, http.StatusPaymentRequired, CodeAccessExpired, "Для отчёта нужен доступ: выберите пакет.", nil)
	case errors.Is(err, access.ErrQuotaExceeded):
		writeError(w, http.StatusPaymentRequired, CodeQuotaExceeded, "Лимит объектов в пакете исчерпан.", nil)
	case err != nil:
		writeInternal(w, r, err)
	default:
		writeJSON(w, http.StatusAccepted, map[string]any{"report_id": id, "status": "queued"})
	}
}

func (h *reportsHandler) get(w http.ResponseWriter, r *http.Request) {
	v, ok := h.load(w, r)
	if ok {
		writeJSON(w, http.StatusOK, v)
	}
}

func (h *reportsHandler) load(w http.ResponseWriter, r *http.Request) (reports.View, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Отчёт не найден.", nil)
		return reports.View{}, false
	}
	p, _ := principal(r)
	v, err := h.svc.Get(r.Context(), id, p)
	switch {
	case errors.Is(err, reports.ErrNotFound):
		writeError(w, http.StatusNotFound, CodeNotFound, "Отчёт не найден.", nil)
	case errors.Is(err, reports.ErrForbidden):
		writeError(w, http.StatusForbidden, CodeForbidden, "Это отчёт другого пользователя.", nil)
	case err != nil:
		writeInternal(w, r, err)
	default:
		return v, true
	}
	return reports.View{}, false
}

func (h *reportsHandler) pdfFile(w http.ResponseWriter, r *http.Request) {
	v, ok := h.load(w, r)
	if !ok {
		return
	}
	if v.Status != "ready" {
		writeError(w, http.StatusConflict, CodeConflict, "Отчёт ещё считается.", nil)
		return
	}
	pdf, err := h.pdf.Cached(r.Context(), reportPDFKey(v.ID), "/print/reports/"+v.ID, v.ID)
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	writePDF(w, pdf, v.Building.Address)
}

func (h *reportsHandler) demoPDF(w http.ResponseWriter, r *http.Request) {
	bid, err := strconv.ParseInt(chi.URLParam(r, "buildingID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Пример отчёта не найден.", nil)
		return
	}
	v, err := h.demo.Get(r.Context(), bid)
	if errors.Is(err, reports.ErrNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, "Пример отчёта не найден.", nil)
		return
	}
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	key := fmt.Sprintf("pdf/demo-%d-%d-v%d.pdf", bid, v.CreatedAt.Unix(), pdfLayout)
	pdf, err := h.pdf.Cached(r.Context(), key, fmt.Sprintf("/print/demo/%d", bid), "")
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	writePDF(w, pdf, v.Building.Address)
}

func (h *reportsHandler) share(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Отчёт не найден.", nil)
		return
	}
	p, _ := principal(r)
	sh, err := h.svc.Share(r.Context(), id, p.UserID)
	if h.shareError(w, r, err) {
		writeJSON(w, http.StatusOK, sh)
	}
}

func (h *reportsHandler) unshare(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Отчёт не найден.", nil)
		return
	}
	p, _ := principal(r)
	if h.shareError(w, r, h.svc.Unshare(r.Context(), id, p.UserID)) {
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *reportsHandler) shareError(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case errors.Is(err, reports.ErrNotFound):
		writeError(w, http.StatusNotFound, CodeNotFound, "Отчёт не найден.", nil)
	case errors.Is(err, reports.ErrForbidden):
		writeError(w, http.StatusForbidden, CodeForbidden, "Поделиться может только владелец отчёта.", nil)
	case errors.Is(err, reports.ErrNotReady):
		writeError(w, http.StatusConflict, CodeConflict, "Отчёт ещё считается: поделиться можно готовым отчётом.", nil)
	case err != nil:
		writeInternal(w, r, err)
	default:
		return true
	}
	return false
}

// loadShared opens a report by its link. A closed or unknown link is 404, as
// is any other report: the token is the only key.
func (h *reportsHandler) loadShared(w http.ResponseWriter, r *http.Request) (reports.View, bool) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	v, err := h.svc.GetShared(r.Context(), chi.URLParam(r, "token"))
	switch {
	case errors.Is(err, reports.ErrNotFound):
		writeError(w, http.StatusNotFound, CodeNotFound, "Ссылка не действует: владелец закрыл доступ к отчёту или ссылка скопирована не полностью.", nil)
	case err != nil:
		writeInternal(w, r, err)
	default:
		return v, true
	}
	return reports.View{}, false
}

func (h *reportsHandler) shared(w http.ResponseWriter, r *http.Request) {
	if v, ok := h.loadShared(w, r); ok {
		w.Header().Set("X-Robots-Tag", "noindex")
		writeJSON(w, http.StatusOK, v)
	}
}

func (h *reportsHandler) sharedPDF(w http.ResponseWriter, r *http.Request) {
	v, ok := h.loadShared(w, r)
	if !ok {
		return
	}
	// Тот же PDF, что скачивает владелец: один расчёт, одна вёрстка.
	pdf, err := h.pdf.Cached(r.Context(), reportPDFKey(v.ID), "/print/reports/"+v.ID, v.ID)
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	writePDF(w, pdf, v.Building.Address)
}

// pdfLayout versions cached PDFs: bump it when the report layout changes so
// files printed with the old layout are not served again.
const pdfLayout = 4

func reportPDFKey(id string) string { return fmt.Sprintf("pdf/report-%s-v%d.pdf", id, pdfLayout) }

func writePDF(w http.ResponseWriter, pdf []byte, address string) {
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="soremo-report.pdf"; filename*=UTF-8''%s`,
		urlEscape("SOREMO — "+address+".pdf")))
	if w.Header().Get("Cache-Control") == "" {
		w.Header().Set("Cache-Control", "private, max-age=3600")
	}
	_, _ = w.Write(pdf)
}

func (h *reportsHandler) mine(w http.ResponseWriter, r *http.Request) {
	p, _ := principal(r)
	list, err := h.svc.Mine(r.Context(), p.UserID)
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}
