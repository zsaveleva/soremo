package buildings

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Geocoder proxies Nominatim for the add-object form, bounded to the city,
// and caches answers for a day (Nominatim policy: at most one request per second).
type Geocoder struct {
	Endpoint string
	client   *http.Client
	mu       sync.Mutex
	cache    map[string]geoEntry
	last     time.Time
}

type geoEntry struct {
	at   time.Time
	hits []GeoHit
}

type GeoHit struct {
	Address string     `json:"address"`
	Center  [2]float64 `json:"center"`
}

func NewGeocoder() *Geocoder {
	return &Geocoder{Endpoint: "https://nominatim.openstreetmap.org/search", client: &http.Client{Timeout: 8 * time.Second}, cache: map[string]geoEntry{}}
}

func (g *Geocoder) Search(ctx context.Context, q string) ([]GeoHit, error) {
	key := strings.ToLower(strings.TrimSpace(q))
	g.mu.Lock()
	if e, ok := g.cache[key]; ok && time.Since(e.at) < 24*time.Hour {
		g.mu.Unlock()
		return e.hits, nil
	}
	if wait := time.Second - time.Since(g.last); wait > 0 {
		time.Sleep(wait)
	}
	g.last = time.Now()
	g.mu.Unlock()

	v := url.Values{
		"q": {q + ", Санкт-Петербург"}, "format": {"jsonv2"}, "addressdetails": {"1"}, "limit": {"5"},
		"accept-language": {"ru"}, "viewbox": {"29.42,60.25,30.76,59.63"}, "bounded": {"1"},
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, g.Endpoint+"?"+v.Encode(), nil)
	req.Header.Set("User-Agent", "soremo-city/1.0 (renovation scenarios MVP)")
	resp, err := g.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("nominatim status %d", resp.StatusCode)
	}
	var raw []struct {
		Lat, Lon string
		Address  map[string]string `json:"address"`
		Display  string            `json:"display_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}
	hits := make([]GeoHit, 0, len(raw))
	seen := map[string]bool{}
	for _, r := range raw {
		lat, _ := strconv.ParseFloat(r.Lat, 64)
		lon, _ := strconv.ParseFloat(r.Lon, 64)
		addr := r.Display
		if road := r.Address["road"]; road != "" {
			addr = shortStreet(road)
			if h := r.Address["house_number"]; h != "" {
				addr += ", " + h
			}
		}
		// Nominatim возвращает здание, вход и участок по одному адресу — оставляем первый.
		if seen[addr] {
			continue
		}
		seen[addr] = true
		hits = append(hits, GeoHit{Address: addr, Center: [2]float64{lon, lat}})
	}
	g.mu.Lock()
	g.cache[key] = geoEntry{at: time.Now(), hits: hits}
	g.mu.Unlock()
	return hits, nil
}

var streetShort = strings.NewReplacer("улица", "ул.", "проспект", "пр.", "переулок", "пер.", "набережная", "наб.", "шоссе", "ш.", "площадь", "пл.", "бульвар", "бул.", "дорога", "дор.")

func shortStreet(s string) string { return streetShort.Replace(s) }
