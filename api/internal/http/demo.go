package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/soremo/city/api/internal/reports"
	"github.com/soremo/city/api/internal/store"
)

type demoHandler struct {
	demo *reports.Demo
	q    *store.Queries
}

func (h *demoHandler) report(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "buildingID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Пример отчёта не найден.", nil)
		return
	}
	v, err := h.demo.Get(r.Context(), id)
	if errors.Is(err, reports.ErrNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, "Для этого объекта нет примера отчёта.", nil)
		return
	}
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (h *demoHandler) buildings(w http.ResponseWriter, r *http.Request) {
	rows, err := h.q.ListDemoBuildings(r.Context())
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	type item struct {
		ID      int64      `json:"id"`
		Address string     `json:"address"`
		Name    *string    `json:"name"`
		Center  [2]float64 `json:"center"`
	}
	out := make([]item, 0, len(rows))
	for _, b := range rows {
		it := item{ID: b.ID, Address: b.Address, Center: [2]float64{b.Lon, b.Lat}}
		if b.Name.Valid {
			it.Name = &b.Name.String
		}
		out = append(out, it)
	}
	writeJSON(w, http.StatusOK, out)
}
