package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/soremo/city/api/internal/buildings"
	"github.com/soremo/city/api/internal/documents"
	"github.com/soremo/city/api/internal/store"
)

type adminHandler struct {
	q        *store.Queries
	docs     *documents.Service
	requests *buildings.Requests
}

func statusParam(r *http.Request) pgtype.Text {
	s := r.URL.Query().Get("status")
	return pgtype.Text{String: s, Valid: s == "pending" || s == "accepted" || s == "rejected"}
}

type reviewInput struct {
	Decision string `json:"decision" validate:"required,oneof=accepted rejected"`
	Comment  string `json:"comment" validate:"max=1000"`
}

func (in reviewInput) check(w http.ResponseWriter) bool {
	if in.Decision == "rejected" && len(in.Comment) < 5 {
		writeError(w, http.StatusUnprocessableEntity, CodeValidation, "Укажите причину отклонения.",
			map[string]string{"comment": "Напишите причину — пользователь увидит её в кабинете"})
		return false
	}
	return true
}

func (h *adminHandler) listDocuments(w http.ResponseWriter, r *http.Request) {
	rows, err := h.q.ListDocumentsForReview(r.Context(), statusParam(r))
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	out := make([]docJSON, 0, len(rows))
	for _, d := range rows {
		j := docOf(store.Document{ID: d.ID, BuildingID: d.BuildingID, Kind: d.Kind, IssuedOn: d.IssuedOn, FileName: d.FileName,
			Mime: d.Mime, Size: d.Size, Status: d.Status, ReviewComment: d.ReviewComment, CreatedAt: d.CreatedAt}, d.Address)
		j.UserEmail = d.Email
		j.UserCompany = textOrNil(d.CompanyName)
		out = append(out, j)
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *adminHandler) reviewDocument(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Документ не найден.", nil)
		return
	}
	var in reviewInput
	if !decode(w, r, &in) || !in.check(w) {
		return
	}
	p, _ := principal(r)
	err = h.docs.Review(r.Context(), id, p.UserID, in.Decision == "accepted", in.Comment)
	if errors.Is(err, documents.ErrAlreadyReview) {
		writeError(w, http.StatusConflict, CodeConflict, "Документ уже проверен.", nil)
		return
	}
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type objectRequestJSON struct {
	ID               uuid.UUID  `json:"id"`
	BuildingID       int64      `json:"building_id"`
	Address          string     `json:"address"`
	Status           string     `json:"status"`
	Comment          *string    `json:"comment"`
	ReviewComment    *string    `json:"review_comment"`
	CreatedAt        time.Time  `json:"created_at"`
	YearBuilt        int32      `json:"year_built,omitempty"`
	OriginalFunction string     `json:"original_function,omitempty"`
	Floors           int32      `json:"floors,omitempty"`
	AreaTotalM2      float64    `json:"area_total_m2,omitempty"`
	Center           [2]float64 `json:"center,omitempty"`
	UserEmail        string     `json:"user_email,omitempty"`
	UserCompany      *string    `json:"user_company,omitempty"`
}

func (h *adminHandler) listObjectRequests(w http.ResponseWriter, r *http.Request) {
	rows, err := h.q.ListObjectRequests(r.Context(), statusParam(r))
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	out := make([]objectRequestJSON, 0, len(rows))
	for _, o := range rows {
		out = append(out, objectRequestJSON{
			ID: o.ID, BuildingID: o.BuildingID, Address: o.Address, Status: o.Status, Comment: textOrNil(o.Comment),
			ReviewComment: textOrNil(o.ReviewComment), CreatedAt: o.CreatedAt.Time, YearBuilt: o.YearBuilt,
			OriginalFunction: o.OriginalFunction, Floors: o.Floors, AreaTotalM2: o.AreaTotalM2, Center: [2]float64{o.Lon, o.Lat},
			UserEmail: o.Email, UserCompany: textOrNil(o.CompanyName),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *adminHandler) reviewObjectRequest(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Заявка не найдена.", nil)
		return
	}
	var in reviewInput
	if !decode(w, r, &in) || !in.check(w) {
		return
	}
	err = h.requests.Review(r.Context(), id, in.Decision == "accepted", in.Comment)
	if errors.Is(err, buildings.ErrRequestReviewed) {
		writeError(w, http.StatusConflict, CodeConflict, "Заявка уже рассмотрена.", nil)
		return
	}
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *adminHandler) users(w http.ResponseWriter, r *http.Request) {
	rows, err := h.q.ListUsers(r.Context())
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	type u struct {
		ID        uuid.UUID `json:"id"`
		Email     string    `json:"email"`
		Type      string    `json:"type"`
		Segment   string    `json:"segment"`
		Company   *string   `json:"company_name"`
		Phone     *string   `json:"phone"`
		Role      string    `json:"role"`
		Verified  bool      `json:"verified"`
		Reports   int32     `json:"reports"`
		PaidRub   int64     `json:"paid_rub"`
		CreatedAt time.Time `json:"created_at"`
	}
	out := make([]u, 0, len(rows))
	for _, x := range rows {
		out = append(out, u{x.ID, x.Email, x.Type, x.Segment, textOrNil(x.CompanyName), textOrNil(x.Phone), x.Role,
			x.EmailVerifiedAt.Valid, x.Reports, x.PaidRub, x.CreatedAt.Time})
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *adminHandler) payments(w http.ResponseWriter, r *http.Request) {
	rows, err := h.q.ListPayments(r.Context())
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	type p struct {
		ID           uuid.UUID `json:"id"`
		AmountRub    int64     `json:"amount_rub"`
		Status       string    `json:"status"`
		Provider     string    `json:"provider"`
		CreatedAt    time.Time `json:"created_at"`
		Email        string    `json:"email"`
		Company      *string   `json:"company_name"`
		ObjectsLimit *int32    `json:"objects_limit"`
		Months       int32     `json:"months"`
	}
	out := make([]p, 0, len(rows))
	for _, x := range rows {
		var lim *int32
		if x.ObjectsLimit.Valid {
			v := x.ObjectsLimit.Int32
			lim = &v
		}
		out = append(out, p{x.ID, x.AmountRub, x.Status, x.Provider, x.CreatedAt.Time, x.Email, textOrNil(x.CompanyName), lim, x.Months})
	}
	writeJSON(w, http.StatusOK, out)
}
