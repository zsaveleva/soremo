package httpapi

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/soremo/city/api/internal/buildings"
	"github.com/soremo/city/api/internal/documents"
	"github.com/soremo/city/api/internal/store"
)

type documentsHandler struct {
	svc       *documents.Service
	buildings *buildings.Service
	q         *store.Queries
}

type docJSON struct {
	ID            uuid.UUID `json:"id"`
	BuildingID    int64     `json:"building_id"`
	Address       string    `json:"address"`
	Kind          string    `json:"kind"`
	IssuedOn      string    `json:"issued_on"`
	FileName      string    `json:"file_name"`
	Mime          string    `json:"mime"`
	Size          int64     `json:"size"`
	Status        string    `json:"status"`
	ReviewComment *string   `json:"review_comment"`
	CreatedAt     time.Time `json:"created_at"`
	UserEmail     string    `json:"user_email,omitempty"`
	UserCompany   *string   `json:"user_company,omitempty"`
}

func docOf(d store.Document, address string) docJSON {
	j := docJSON{ID: d.ID, BuildingID: d.BuildingID, Address: address, Kind: d.Kind, IssuedOn: d.IssuedOn.Time.Format("2006-01-02"),
		FileName: d.FileName, Mime: d.Mime, Size: d.Size, Status: d.Status, CreatedAt: d.CreatedAt.Time}
	if d.ReviewComment.Valid {
		j.ReviewComment = &d.ReviewComment.String
	}
	return j
}

func (h *documentsHandler) upload(w http.ResponseWriter, r *http.Request) {
	bid, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Объект не найден.", nil)
		return
	}
	card, err := h.buildings.Get(r.Context(), bid)
	if errors.Is(err, buildings.ErrNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, "Объект не найден.", nil)
		return
	}
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, documents.MaxSize+1<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "file_too_large", "Файл больше 50 МБ. Сожмите PDF или разделите документ на части.",
			map[string]string{"file": "Файл больше 50 МБ — сожмите или разделите на части"})
		return
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	fields := map[string]string{}
	kind := r.FormValue("kind")
	if kind != "survey" && kind != "expertise" && kind != "other" {
		fields["kind"] = "Выберите тип документа"
	}
	issued, err := time.Parse("2006-01-02", r.FormValue("issued_on"))
	if err != nil || issued.After(time.Now()) || issued.Year() < 1950 {
		fields["issued_on"] = "Укажите дату документа — не позже сегодняшней"
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		fields["file"] = "Выберите файл"
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, CodeValidation, "Проверьте поля формы.", fields)
		return
	}
	defer func() { _ = file.Close() }()
	data, err := io.ReadAll(io.LimitReader(file, documents.MaxSize+1))
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	p, _ := principal(r)
	d, err := h.svc.Upload(r.Context(), documents.Upload{BuildingID: bid, UserID: p.UserID, Kind: kind, IssuedOn: issued, FileName: hdr.Filename, Data: data})
	switch {
	case errors.Is(err, documents.ErrTooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, "file_too_large", "Файл больше 50 МБ.", map[string]string{"file": "Файл больше 50 МБ — сожмите или разделите на части"})
	case errors.Is(err, documents.ErrBadType), errors.Is(err, documents.ErrEmpty):
		writeError(w, http.StatusUnprocessableEntity, "file_type", "Формат не подходит.",
			map[string]string{"file": "Подходят PDF, DOCX, JPG и PNG — сохраните документ в одном из них"})
	case err != nil:
		writeInternal(w, r, err)
	default:
		writeJSON(w, http.StatusCreated, docOf(d, card.Address))
	}
}

func (h *documentsHandler) forBuilding(w http.ResponseWriter, r *http.Request) {
	bid, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Объект не найден.", nil)
		return
	}
	p, _ := principal(r)
	rows, err := h.q.ListBuildingDocuments(r.Context(), store.ListBuildingDocumentsParams{BuildingID: bid, UserID: p.UserID})
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	out := make([]docJSON, 0, len(rows))
	for _, d := range rows {
		j := docOf(store.Document{ID: d.ID, BuildingID: d.BuildingID, Kind: d.Kind, IssuedOn: d.IssuedOn, FileName: d.FileName,
			Mime: d.Mime, Size: d.Size, Status: d.Status, ReviewComment: d.ReviewComment, CreatedAt: d.CreatedAt}, d.Address)
		if d.UserID != p.UserID {
			j.FileName = "Документ другого пользователя" // чужие принятые документы видны только как факт
		}
		out = append(out, j)
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *documentsHandler) mine(w http.ResponseWriter, r *http.Request) {
	p, _ := principal(r)
	rows, err := h.q.ListMyDocuments(r.Context(), p.UserID)
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	out := make([]docJSON, 0, len(rows))
	for _, d := range rows {
		out = append(out, docOf(store.Document{ID: d.ID, BuildingID: d.BuildingID, Kind: d.Kind, IssuedOn: d.IssuedOn, FileName: d.FileName,
			Mime: d.Mime, Size: d.Size, Status: d.Status, ReviewComment: d.ReviewComment, CreatedAt: d.CreatedAt}, d.Address))
	}
	writeJSON(w, http.StatusOK, out)
}

// file streams the original upload to its owner or an admin (preview in moderation).
func (h *documentsHandler) file(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Документ не найден.", nil)
		return
	}
	d, rc, err := h.svc.Open(r.Context(), id)
	if errors.Is(err, documents.ErrNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, "Документ не найден.", nil)
		return
	}
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	defer func() { _ = rc.Close() }()
	p, _ := principal(r)
	if d.UserID != p.UserID && !p.IsAdmin() {
		writeError(w, http.StatusForbidden, CodeForbidden, "Это документ другого пользователя.", nil)
		return
	}
	w.Header().Set("Content-Type", d.Mime)
	w.Header().Set("Content-Disposition", `inline; filename*=UTF-8''`+urlEscape(d.FileName))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
	_, _ = io.Copy(w, rc)
}

func textOrNil(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	return &t.String
}
