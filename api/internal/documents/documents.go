// Package documents accepts technical surveys and other files for moderation (ТЗ 4.4, 8.5).
package documents

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/soremo/city/api/internal/blob"
	"github.com/soremo/city/api/internal/engine"
	"github.com/soremo/city/api/internal/store"
)

const MaxSize = 50 << 20 // 50 МБ

var (
	ErrTooLarge      = errors.New("file too large")
	ErrBadType       = errors.New("unsupported file type")
	ErrEmpty         = errors.New("empty file")
	ErrNotFound      = errors.New("document not found")
	ErrAlreadyReview = errors.New("document already reviewed")
)

const mimeDOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

var extFor = map[string]string{"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", mimeDOCX: ".docx"}

// DetectType looks at the content, never at the extension: PDF, JPEG, PNG and
// DOCX (a zip archive with word/document.xml) are accepted.
func DetectType(data []byte) (string, error) {
	if len(data) == 0 {
		return "", ErrEmpty
	}
	switch ct := http.DetectContentType(data); ct {
	case "application/pdf", "image/jpeg", "image/png":
		return ct, nil
	case "application/zip":
		zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return "", ErrBadType
		}
		for _, f := range zr.File {
			if f.Name == "word/document.xml" {
				return mimeDOCX, nil
			}
		}
	}
	return "", ErrBadType
}

var unsafeChars = regexp.MustCompile(`[^\p{L}\p{N}._\- ()«»]+`)

// SafeName keeps a readable original name for lists; storage uses a UUID key.
func SafeName(name, mime string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	if !utf8.ValidString(name) {
		name = ""
	}
	base := strings.TrimSuffix(name, filepath.Ext(name))
	base = strings.Trim(unsafeChars.ReplaceAllString(base, "_"), " ._")
	if r := []rune(base); len(r) > 120 {
		base = string(r[:120])
	}
	if base == "" {
		base = "document"
	}
	return base + extFor[mime]
}

type Service struct {
	pool  *pgxpool.Pool
	q     *store.Queries
	blobs blob.Store
}

func NewService(pool *pgxpool.Pool, blobs blob.Store) *Service {
	return &Service{pool: pool, q: store.New(pool), blobs: blobs}
}

type Upload struct {
	BuildingID int64
	UserID     uuid.UUID
	Kind       string
	IssuedOn   time.Time
	FileName   string
	Data       []byte
}

func (s *Service) Upload(ctx context.Context, u Upload) (store.Document, error) {
	if len(u.Data) > MaxSize {
		return store.Document{}, ErrTooLarge
	}
	mime, err := DetectType(u.Data)
	if err != nil {
		return store.Document{}, err
	}
	key := fmt.Sprintf("documents/%d/%s%s", u.BuildingID, uuid.NewString(), extFor[mime])
	if err := s.blobs.Put(ctx, key, bytes.NewReader(u.Data), int64(len(u.Data)), mime); err != nil {
		return store.Document{}, err
	}
	d, err := s.q.CreateDocument(ctx, store.CreateDocumentParams{
		BuildingID: u.BuildingID, UserID: u.UserID, Kind: u.Kind,
		IssuedOn: pgtype.Date{Time: u.IssuedOn, Valid: true}, FileKey: key,
		FileName: SafeName(u.FileName, mime), Mime: mime, Size: int64(len(u.Data)),
	})
	if err != nil {
		_ = s.blobs.Delete(ctx, key)
	}
	return d, err
}

func (s *Service) Open(ctx context.Context, id uuid.UUID) (store.GetDocumentRow, io.ReadCloser, error) {
	d, err := s.q.GetDocument(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, nil, ErrNotFound
	}
	if err != nil {
		return d, nil, err
	}
	rc, err := s.blobs.Get(ctx, d.FileKey)
	return d, rc, err
}

// Название документа и согласованные формы глагола: «обследование принято», «экспертиза принята».
var kindName = map[string][3]string{
	"survey":    {"Техническое обследование", "принято", "отклонено"},
	"expertise": {"Экспертиза", "принята", "отклонена"},
	"other":     {"Документ", "принят", "отклонён"},
}

// Review applies the moderator's decision and notifies the uploader.
func (s *Service) Review(ctx context.Context, id, reviewer uuid.UUID, accepted bool, comment string) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		status := "rejected"
		if accepted {
			status = "accepted"
		}
		d, err := q.ReviewDocument(ctx, store.ReviewDocumentParams{
			ID: id, Status: status, ReviewComment: pgtype.Text{String: comment, Valid: comment != ""},
			ReviewedBy: uuid.NullUUID{UUID: reviewer, Valid: true},
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrAlreadyReview
		}
		if err != nil {
			return err
		}
		b, err := q.GetBuilding(ctx, d.BuildingID)
		if err != nil {
			return err
		}
		var text string
		link := pgtype.Text{String: fmt.Sprintf("/map?b=%d", d.BuildingID), Valid: true}
		if accepted {
			st, err := q.DocumentStatsForBuilding(ctx, d.BuildingID)
			if err != nil {
				return err
			}
			level := map[engine.AccuracyLevel]string{engine.AccuracyMid: "≈60%", engine.AccuracyHigh: "≈85%"}[engine.AccuracyFor(st.AcceptedKinds)]
			k := kindName[d.Kind]
			text = fmt.Sprintf("%s по адресу %s %s. Точность отчёта — %s, пересчёт бесплатный.", k[0], b.Address, k[1], level)
			if r, err := q.LatestReportForBuilding(ctx, store.LatestReportForBuildingParams{UserID: d.UserID, BuildingID: d.BuildingID}); err == nil {
				link.String = "/reports/" + r.ID.String()
			}
		} else {
			k := kindName[d.Kind]
			text = fmt.Sprintf("%s по адресу %s %s: %s", k[0], b.Address, k[2], strings.TrimSuffix(comment, "."))
		}
		return q.CreateNotification(ctx, store.CreateNotificationParams{UserID: d.UserID, Kind: "document_" + status, Text: text, Link: link})
	})
}
