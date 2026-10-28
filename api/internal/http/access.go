package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/soremo/city/api/internal/access"
)

type accessHandler struct{ svc *access.Service }

func (h *accessHandler) packages(w http.ResponseWriter, r *http.Request) {
	ps, err := h.svc.Packages(r.Context())
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, ps)
}

func (h *accessHandler) checkout(w http.ResponseWriter, r *http.Request) {
	var in struct {
		PackageID int32 `json:"package_id" validate:"required"`
	}
	if !decode(w, r, &in) {
		return
	}
	p, _ := principal(r)
	pay, pk, err := h.svc.Checkout(r.Context(), p.UserID, in.PackageID)
	if errors.Is(err, access.ErrPackageNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, "Такого пакета нет. Выберите пакет заново.", nil)
		return
	}
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"payment_id": pay.ID, "amount": pay.AmountRub, "package": pk})
}

func (h *accessHandler) confirm(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Платёж не найден.", nil)
		return
	}
	var in struct {
		Card access.Card `json:"card_mock"`
	}
	if !decode(w, r, &in) {
		return
	}
	if f := access.ValidateCard(in.Card, time.Now()); len(f) > 0 {
		writeError(w, http.StatusUnprocessableEntity, CodeValidation, "Проверьте данные карты.", f)
		return
	}
	p, _ := principal(r)
	_, err = h.svc.Confirm(r.Context(), p.UserID, id, in.Card)
	switch {
	case errors.Is(err, access.ErrPaymentNotFound):
		writeError(w, http.StatusNotFound, CodeNotFound, "Платёж не найден. Начните оформление заново.", nil)
		return
	case errors.Is(err, access.ErrPaymentDone):
		writeError(w, http.StatusConflict, CodeConflict, "Этот платёж уже проведён.", nil)
		return
	case errors.Is(err, access.ErrCardDeclined):
		writeError(w, http.StatusPaymentRequired, "card_declined", "Банк отклонил платёж. Попробуйте другую карту.",
			map[string]string{"number": "Банк отклонил эту карту — укажите другую"})
		return
	case err != nil:
		writeInternal(w, r, err)
		return
	}
	cur, err := h.svc.Current(r.Context(), p.UserID)
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"access": cur})
}

func (h *accessHandler) current(w http.ResponseWriter, r *http.Request) {
	p, _ := principal(r)
	cur, err := h.svc.Current(r.Context(), p.UserID)
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"access": cur})
}
