package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/soremo/city/api/internal/buildings"
	"github.com/soremo/city/api/internal/reports"
	"github.com/soremo/city/api/internal/store"
)

type citiesHandler struct{ q *store.Queries }

func (h *citiesHandler) list(w http.ResponseWriter, r *http.Request) {
	rows, err := h.q.ListCities(r.Context())
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	type city struct {
		ID   int32      `json:"id"`
		Slug string     `json:"slug"`
		Name string     `json:"name"`
		BBox [4]float64 `json:"bbox"`
	}
	out := make([]city, 0, len(rows))
	for _, c := range rows {
		out = append(out, city{c.ID, c.Slug, c.Name, [4]float64{c.MinLon, c.MinLat, c.MaxLon, c.MaxLat}})
	}
	writeJSON(w, http.StatusOK, out)
}

type buildingsHandler struct {
	svc     *buildings.Service
	q       *store.Queries
	reports *reports.Service
}

var knownFunctions = map[string]bool{
	"industrial": true, "warehouse": true, "culture": true, "administrative": true,
	"research": true, "retail": true, "sport": true, "other": true,
}

func (h *buildingsHandler) list(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	fields := map[string]string{}
	f := buildings.Filter{Zoom: 14}

	city, err := h.q.GetCityBySlug(r.Context(), valueOr(q.Get("city"), "spb"))
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Город не найден.", nil)
		return
	}
	f.CityID = city.ID

	parts := strings.Split(q.Get("bbox"), ",")
	if len(parts) != 4 {
		fields["bbox"] = "Передайте bbox в формате min_lon,min_lat,max_lon,max_lat"
	} else {
		var v [4]float64
		for i, p := range parts {
			if v[i], err = strconv.ParseFloat(strings.TrimSpace(p), 64); err != nil {
				fields["bbox"] = "Передайте bbox числами в формате min_lon,min_lat,max_lon,max_lat"
			}
		}
		f.BBox = buildings.BBox{MinLon: v[0], MinLat: v[1], MaxLon: v[2], MaxLat: v[3]}
	}
	if s := q.Get("zoom"); s != "" {
		if f.Zoom, err = strconv.ParseFloat(s, 64); err != nil {
			fields["zoom"] = "Передайте zoom числом"
		}
	}
	f.YearFrom = parseInt(q, "year_from", fields)
	f.YearTo = parseInt(q, "year_to", fields)
	f.AreaFrom = parseFloat(q, "area_from", fields)
	f.AreaTo = parseFloat(q, "area_to", fields)
	if s := q.Get("function"); s != "" {
		for _, fn := range strings.Split(s, ",") {
			if !knownFunctions[fn] {
				fields["function"] = "Укажите назначение из списка"
			}
			f.Functions = append(f.Functions, fn)
		}
	}
	if s := q.Get("has_docs"); s != "" {
		v := s == "true" || s == "1"
		f.HasDocs = &v
	}
	if q.Get("mine") == "true" {
		if p, ok := principal(r); ok {
			f.MineUser = &p.UserID
		}
	}

	if len(fields) > 0 {
		writeError(w, http.StatusBadRequest, CodeValidation, "Проверьте параметры запроса.", fields)
		return
	}
	fc, err := h.svc.List(r.Context(), f)
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, fc)
}

func (h *buildingsHandler) get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Объект не найден.", nil)
		return
	}
	card, err := h.svc.Get(r.Context(), id)
	if errors.Is(err, buildings.ErrNotFound) {
		writeError(w, http.StatusNotFound, CodeNotFound, "Объект не найден.", nil)
		return
	}
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	if p, ok := principal(r); ok {
		card.MyReportID = h.reports.LatestFor(r.Context(), p.UserID, id)
	}
	writeJSON(w, http.StatusOK, card)
}

func (h *buildingsHandler) search(w http.ResponseWriter, r *http.Request) {
	city, err := h.q.GetCityBySlug(r.Context(), valueOr(r.URL.Query().Get("city"), "spb"))
	if err != nil {
		writeError(w, http.StatusNotFound, CodeNotFound, "Город не найден.", nil)
		return
	}
	hits, err := h.svc.Search(r.Context(), city.ID, r.URL.Query().Get("q"))
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, hits)
}

func valueOr(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

func parseInt(q map[string][]string, key string, fields map[string]string) *int32 {
	s := firstOf(q, key)
	if s == "" {
		return nil
	}
	v, err := strconv.ParseInt(s, 10, 32)
	if err != nil {
		fields[key] = "Передайте целое число"
		return nil
	}
	i := int32(v)
	return &i
}

func parseFloat(q map[string][]string, key string, fields map[string]string) *float64 {
	s := firstOf(q, key)
	if s == "" {
		return nil
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		fields[key] = "Передайте число"
		return nil
	}
	return &v
}

func firstOf(q map[string][]string, key string) string {
	if v := q[key]; len(v) > 0 {
		return v[0]
	}
	return ""
}
