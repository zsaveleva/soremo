package httpapi

import (
	"net/http"
	"strings"

	"github.com/soremo/city/api/internal/buildings"
	"github.com/soremo/city/api/internal/store"
)

type objectsHandler struct {
	requests *buildings.Requests
	geo      *buildings.Geocoder
	q        *store.Queries
}

var objectMessages = map[string]string{
	"address.required":           "Введите адрес здания",
	"address.min":                "Введите адрес полностью: улица и номер дома",
	"lon.required":               "Поставьте точку на карте",
	"lat.required":               "Поставьте точку на карте",
	"year_built.required":        "Укажите год постройки",
	"year_built.min":             "Сервис работает со зданиями 1920–1991 годов",
	"year_built.max":             "Сервис работает со зданиями 1920–1991 годов",
	"area_total_m2.required":     "Укажите общую площадь",
	"area_total_m2.min":          "Площадь — от 100 м²",
	"floors.required":            "Укажите этажность",
	"original_function.required": "Выберите исходное назначение",
}

func init() {
	for k, v := range objectMessages {
		fieldMessages[k] = v
	}
}

func (h *objectsHandler) create(w http.ResponseWriter, r *http.Request) {
	var in buildings.NewObject
	if !decode(w, r, &in) {
		return
	}
	city, err := h.q.GetCityBySlug(r.Context(), "spb")
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	p, _ := principal(r)
	in.Address = strings.TrimSpace(in.Address)
	req, err := h.requests.Create(r.Context(), p.UserID, city.ID, in)
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": req.ID, "building_id": req.BuildingID, "status": req.Status})
}

func (h *objectsHandler) mine(w http.ResponseWriter, r *http.Request) {
	p, _ := principal(r)
	rows, err := h.q.ListMyObjectRequests(r.Context(), p.UserID)
	if err != nil {
		writeInternal(w, r, err)
		return
	}
	out := make([]objectRequestJSON, 0, len(rows))
	for _, o := range rows {
		out = append(out, objectRequestJSON{ID: o.ID, BuildingID: o.BuildingID, Address: o.Address, Status: o.Status,
			Comment: textOrNil(o.Comment), ReviewComment: textOrNil(o.ReviewComment), CreatedAt: o.CreatedAt.Time})
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *objectsHandler) geocode(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) < 3 {
		writeJSON(w, http.StatusOK, []buildings.GeoHit{})
		return
	}
	hits, err := h.geo.Search(r.Context(), q)
	if err != nil {
		writeError(w, http.StatusBadGateway, "geocoder_unavailable", "Поиск адреса недоступен. Поставьте точку на карте вручную.", nil)
		return
	}
	writeJSON(w, http.StatusOK, hits)
}
