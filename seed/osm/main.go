// Command osm builds seed/buildings.geojson from OpenStreetMap data.
//
// It downloads non-residential buildings, metro stations and points of
// interest inside Saint Petersburg via Overpass, selects ~500 buildings
// spread across the city and computes areas and context metrics.
// Missing attributes are filled deterministically from the OSM id, so the
// output does not change between runs on the same OSM snapshot.
//
//	go run . -out ../buildings.geojson
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const area = `area["name"="Санкт-Петербург"]["admin_level"="4"]->.spb;`

var queries = map[string]string{
	"buildings": `[out:json][timeout:300];` + area + `
(
  way["building"~"^(industrial|warehouse|commercial|office|public|civic|manufacture|retail|service|sports_hall|sports_centre)$"]["addr:street"]["addr:housenumber"](area.spb);
  way["building"]["amenity"~"^(community_centre|theatre|cinema|arts_centre)$"]["addr:street"]["addr:housenumber"](area.spb);
);
out tags geom;`,
	"metro": `[out:json][timeout:120];` + area + `
node["railway"="station"]["station"="subway"](area.spb);
out body;`,
	"social": `[out:json][timeout:300];` + area + `
nwr["amenity"~"^(school|kindergarten|clinic|hospital|doctors|library|pharmacy|community_centre)$"](area.spb);
out center tags;`,
	"commercial": `[out:json][timeout:300];` + area + `
(
  nwr["shop"](area.spb);
  nwr["amenity"~"^(cafe|restaurant|fast_food|bar)$"](area.spb);
);
out center;`,
	"business": `[out:json][timeout:300];` + area + `
(
  nwr["office"](area.spb);
  nwr["amenity"~"^(bank|coworking_space)$"](area.spb);
);
out center;`,
	"demo": `[out:json][timeout:120];` + area + `
(
  way["building"]["name"~"(Дворец культуры|ДК).*(Кирова|Газа)"](area.spb);
  way["building"]["addr:street"="Заставская улица"](area.spb);
);
out tags geom;`,
}

type element struct {
	Type   string            `json:"type"`
	ID     int64             `json:"id"`
	Lat    float64           `json:"lat"`
	Lon    float64           `json:"lon"`
	Center *latLon           `json:"center"`
	Tags   map[string]string `json:"tags"`
	Geom   []latLon          `json:"geometry"`
}

type latLon struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

func (e element) point() latLon {
	if e.Center != nil {
		return *e.Center
	}
	return latLon{e.Lat, e.Lon}
}

func main() {
	out := flag.String("out", "../buildings.geojson", "output GeoJSON path")
	cache := flag.String("cache", ".cache", "directory for raw Overpass responses")
	endpoint := flag.String("endpoint", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "Overpass endpoint")
	target := flag.Int("n", 500, "number of buildings to select")
	flag.Parse()

	data := map[string][]element{}
	for name, q := range queries {
		els, err := fetch(*endpoint, *cache, name, q)
		if err != nil {
			log.Fatalf("%s: %v", name, err)
		}
		data[name] = els
		log.Printf("%s: %d elements", name, len(els))
	}

	idx := newPOIIndex(data["social"], data["commercial"], data["business"])
	metro := data["metro"]

	var picked []feature
	seen := map[int64]bool{}
	for _, d := range pickDemo(data["demo"]) {
		f, ok := buildFeature(d.el, metro, idx, true)
		if !ok {
			log.Fatalf("demo building %d is not usable", d.el.ID)
		}
		d.apply(&f)
		picked = append(picked, f)
		seen[d.el.ID] = true
	}

	var cands []feature
	for _, el := range data["buildings"] {
		if seen[el.ID] {
			continue
		}
		if f, ok := buildFeature(el, metro, idx, false); ok {
			cands = append(cands, f)
		}
	}
	log.Printf("usable candidates: %d", len(cands))
	picked = append(picked, spreadSelect(cands, *target-len(picked))...)

	fc := map[string]any{"type": "FeatureCollection", "features": picked}
	buf, err := json.MarshalIndent(fc, "", " ")
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(*out, buf, 0o644); err != nil {
		log.Fatal(err)
	}
	log.Printf("wrote %d buildings to %s", len(picked), *out)
}

func fetch(endpoint, cacheDir, name, q string) ([]element, error) {
	path := filepath.Join(cacheDir, name+".json")
	raw, err := os.ReadFile(path)
	if err != nil {
		for attempt, wait := 0, 10*time.Second; ; attempt, wait = attempt+1, wait*2 {
			raw, err = post(endpoint, q)
			if err == nil || attempt == 4 {
				break
			}
			log.Printf("%s: %v, retry in %s", name, err, wait)
			time.Sleep(wait)
		}
		if err != nil {
			return nil, err
		}
		_ = os.MkdirAll(cacheDir, 0o755)
		_ = os.WriteFile(path, raw, 0o644)
	}
	var resp struct {
		Elements []element `json:"elements"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, err
	}
	return resp.Elements, nil
}

func post(endpoint, q string) ([]byte, error) {
	req, _ := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(url.Values{"data": {q}}.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "soremo-city-seed/1.0")
	resp, err := (&http.Client{Timeout: 6 * time.Minute}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK || !bytes.HasPrefix(bytes.TrimSpace(body), []byte("{")) {
		return nil, fmt.Errorf("overpass status %d", resp.StatusCode)
	}
	return body, nil
}

// ---- geometry ----

const earthR = 6371008.8

// footprintArea returns the polygon area in m² using a local equirectangular
// projection, which is accurate to well under 1% at building scale.
func footprintArea(ring []latLon) float64 {
	if len(ring) < 4 {
		return 0
	}
	lat0 := ring[0].Lat * math.Pi / 180
	var s float64
	for i := 0; i < len(ring)-1; i++ {
		x1 := ring[i].Lon * math.Pi / 180 * math.Cos(lat0) * earthR
		y1 := ring[i].Lat * math.Pi / 180 * earthR
		x2 := ring[i+1].Lon * math.Pi / 180 * math.Cos(lat0) * earthR
		y2 := ring[i+1].Lat * math.Pi / 180 * earthR
		s += x1*y2 - x2*y1
	}
	return math.Abs(s) / 2
}

func centroid(ring []latLon) latLon {
	var c latLon
	n := len(ring) - 1
	for _, p := range ring[:n] {
		c.Lat += p.Lat
		c.Lon += p.Lon
	}
	c.Lat /= float64(n)
	c.Lon /= float64(n)
	return c
}

func dist(a, b latLon) float64 {
	dLat := (b.Lat - a.Lat) * math.Pi / 180
	dLon := (b.Lon - a.Lon) * math.Pi / 180
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(a.Lat*math.Pi/180)*math.Cos(b.Lat*math.Pi/180)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * earthR * math.Asin(math.Sqrt(h))
}

// ---- POI index: coarse grid for 500 m radius counts ----

type poiIndex struct {
	cells map[[2]int][3]int // social, commercial, business
	pts   map[[2]int][]poi
}

type poi struct {
	p    latLon
	kind int
}

const cellDeg = 0.005

func cellOf(p latLon) [2]int {
	return [2]int{int(math.Floor(p.Lat / cellDeg)), int(math.Floor(p.Lon / (cellDeg * 2)))}
}

func newPOIIndex(groups ...[]element) *poiIndex {
	idx := &poiIndex{pts: map[[2]int][]poi{}}
	for kind, g := range groups {
		for _, e := range g {
			p := e.point()
			if p.Lat == 0 {
				continue
			}
			c := cellOf(p)
			idx.pts[c] = append(idx.pts[c], poi{p, kind})
		}
	}
	return idx
}

func (idx *poiIndex) count(p latLon, r float64) [3]int {
	var res [3]int
	c := cellOf(p)
	for dy := -2; dy <= 2; dy++ {
		for dx := -2; dx <= 2; dx++ {
			for _, q := range idx.pts[[2]int{c[0] + dy, c[1] + dx}] {
				if dist(p, q.p) <= r {
					res[q.kind]++
				}
			}
		}
	}
	return res
}

// ---- deterministic pseudo-randomness ----

type rng struct{ seed []byte }

func newRNG(id int64) rng {
	b := make([]byte, 8)
	binary.LittleEndian.PutUint64(b, uint64(id))
	return rng{b}
}

// f returns a stable value in [0,1) for the given key.
func (r rng) f(key string) float64 {
	h := sha256.Sum256(append(append([]byte{}, r.seed...), key...))
	return float64(binary.LittleEndian.Uint64(h[:8])>>11) / float64(1<<53)
}

func (r rng) between(key string, lo, hi float64) float64 { return lo + r.f(key)*(hi-lo) }

func (r rng) pick(key string, opts ...string) string {
	return opts[int(r.f(key)*float64(len(opts)))]
}

// ---- feature building ----

type feature struct {
	Type       string         `json:"type"`
	Geometry   map[string]any `json:"geometry"`
	Properties props          `json:"properties"`
}

type props struct {
	OSMID            int64   `json:"osm_id"`
	Address          string  `json:"address"`
	Name             string  `json:"name,omitempty"`
	YearBuilt        int     `json:"year_built"`
	YearSource       string  `json:"year_source"`
	OriginalFunction string  `json:"original_function"`
	Floors           int     `json:"floors"`
	AreaTotal        float64 `json:"area_total_m2"`
	AreaSite         float64 `json:"area_site_m2"`
	AreaFootprint    float64 `json:"area_footprint_m2"`
	VRI              string  `json:"vri"`
	PZZZone          string  `json:"pzz_zone"`
	IsOKN            bool    `json:"is_okn"`
	LegalStatus      string  `json:"legal_status"`
	IsDemo           bool    `json:"is_demo"`
	DemoSlug         string  `json:"demo_slug,omitempty"`

	MetroName         string `json:"metro_name"`
	MetroDist         int    `json:"metro_dist_m"`
	TransitIndex      int    `json:"transit_index"`
	Social500         int    `json:"social_500m"`
	CommercialDensity int    `json:"commercial_density"`
	BusinessActivity  int    `json:"business_activity"`

	lat, lon float64
}

var center = latLon{59.9390, 30.3158} // Дворцовая площадь

var yearRe = regexp.MustCompile(`(1[89]\d\d|20\d\d)`)

// modernRe matches post-Soviet retail and office developments that OSM often
// tags as commercial buildings without a construction date.
var modernRe = regexp.MustCompile(`(?i)(бизнес-центр|бизнес центр|(^|[^а-яё])(бц|тц|трк|трц|тк|тд)([^а-яё]|$)|торгов|молл|плаза|аутлет|гипермаркет|супермаркет|лента|окей|леруа|икеа|автосалон|автоцентр|дилер|[a-z]{3,})`)

var modernShop = map[string]bool{"mall": true, "supermarket": true, "car": true, "department_store": true, "doityourself": true, "furniture": true}

// buildingNameRe keeps names that describe the building itself, not a tenant.
var buildingNameRe = regexp.MustCompile(`(?i)(завод|фабрик|комбинат|дворец|дом культуры|^дк |кинотеатр|нии|институт|депо|склад|корпус|типография|мастерск|цех|баня|стадион|манеж|универмаг|фабрика-кухня|котельн|гараж|автобаза|трест)`)

func buildFeature(el element, metro []element, idx *poiIndex, demo bool) (feature, bool) {
	ring := el.Geom
	if len(ring) < 4 || ring[0] != ring[len(ring)-1] {
		return feature{}, false
	}
	fp := footprintArea(ring)
	if !demo && (fp < 350 || fp > 20000) {
		return feature{}, false
	}
	t := el.Tags
	if !demo && (modernRe.MatchString(t["name"]+" "+t["brand"]) || modernShop[t["shop"]]) {
		return feature{}, false
	}
	r := newRNG(el.ID)
	c := centroid(ring)

	year, yearSrc := 0, "generated"
	if m := yearRe.FindString(t["start_date"]); m != "" {
		year, _ = strconv.Atoi(m)
		yearSrc = "osm"
		if !demo && (year < 1920 || year > 1991) {
			return feature{}, false
		}
	}
	if year == 0 {
		// Without a known date, the historic centre is mostly pre-1917.
		if !demo && dist(c, center) < 3200 {
			return feature{}, false
		}
		// Weighted towards the 1955–1985 industrial build-out.
		u := r.f("year")
		switch {
		case u < 0.12:
			year = 1925 + int(r.f("y2")*16)
		case u < 0.22:
			year = 1946 + int(r.f("y2")*10)
		default:
			year = 1956 + int(r.f("y2")*36)
		}
	}

	fn := classify(t)
	floors := 0
	if lv, err := strconv.Atoi(strings.TrimSpace(t["building:levels"])); err == nil && lv > 0 && lv < 30 {
		floors = lv
	}
	if floors == 0 {
		switch fn {
		case "warehouse":
			floors = 1 + int(r.f("fl")*2)
		case "industrial":
			floors = 1 + int(r.f("fl")*5)
		case "administrative", "research":
			floors = 3 + int(r.f("fl")*7)
		default:
			floors = 2 + int(r.f("fl")*3)
		}
	}

	addr := shortAddress(t["addr:street"], t["addr:housenumber"])
	p := props{
		OSMID:            el.ID,
		Address:          addr,
		Name:             cleanName(t["name"]),
		YearBuilt:        year,
		YearSource:       yearSrc,
		OriginalFunction: fn,
		Floors:           floors,
		AreaFootprint:    round1(fp),
		AreaTotal:        round1(fp * float64(floors) * r.between("ka", 0.86, 0.94)),
		AreaSite:         round1(fp * r.between("ks", 1.6, 3.4)),
		VRI:              vri[fn],
		PZZZone:          pzz(fn, r),
		IsOKN:            r.f("okn") < oknChance(fn, year),
		LegalStatus:      r.pick("legal", "Собственность Санкт-Петербурга", "Частная собственность", "Частная собственность", "Частная собственность", "Федеральная собственность", "Нет данных в открытых источниках"),
		IsDemo:           demo,
		lat:              c.Lat,
		lon:              c.Lon,
	}

	best, bestD := "", math.MaxFloat64
	for _, m := range metro {
		if d := dist(c, m.point()); d < bestD {
			best, bestD = m.Tags["name"], d
		}
	}
	p.MetroName = strings.TrimPrefix(best, "метро ")
	p.MetroDist = int(math.Round(bestD/10) * 10)
	p.TransitIndex = clamp(int(100*math.Exp(-bestD/1800)+r.between("ti", -4, 4)), 3, 98)

	cnt := idx.count(c, 500)
	p.Social500 = cnt[0]
	p.CommercialDensity = clamp(int(100*(1-math.Exp(-float64(cnt[1])/90))), 1, 99)
	p.BusinessActivity = clamp(int(100*(1-math.Exp(-float64(cnt[2])/45))), 1, 99)

	coords := make([][2]float64, len(ring))
	for i, q := range ring {
		coords[i] = [2]float64{round6(q.Lon), round6(q.Lat)}
	}
	return feature{
		Type:       "Feature",
		Geometry:   map[string]any{"type": "Polygon", "coordinates": [][][2]float64{coords}},
		Properties: p,
	}, true
}

func classify(t map[string]string) string {
	name := strings.ToLower(t["name"])
	switch {
	case t["amenity"] == "community_centre" || t["amenity"] == "theatre" || t["amenity"] == "cinema" ||
		t["amenity"] == "arts_centre" || strings.Contains(name, "дворец культуры") || strings.HasPrefix(name, "дк "):
		return "culture"
	case strings.Contains(name, "нии") || strings.Contains(name, "научно-исследовательский") || strings.Contains(name, "конструкторское бюро"):
		return "research"
	}
	switch t["building"] {
	case "industrial", "manufacture":
		return "industrial"
	case "warehouse":
		return "warehouse"
	case "office", "civic", "public":
		return "administrative"
	case "commercial", "retail", "service":
		return "retail"
	case "sports_hall", "sports_centre":
		return "sport"
	}
	return "other"
}

var vri = map[string]string{
	"industrial":     "Производственная деятельность (6.0)",
	"warehouse":      "Склад (6.9)",
	"culture":        "Объекты культурно-досуговой деятельности (3.6.1)",
	"administrative": "Деловое управление (4.1)",
	"research":       "Обеспечение научной деятельности (3.9)",
	"retail":         "Магазины (4.4)",
	"sport":          "Спорт (5.1)",
	"other":          "Общественное использование объектов капитального строительства (3.0)",
}

func pzz(fn string, r rng) string {
	switch fn {
	case "industrial", "warehouse":
		return r.pick("pzz", "ТП1", "ТП2", "ТП3", "ТД1-2_2")
	case "research":
		return r.pick("pzz", "ТД1-2_2", "ТД2_2", "ТП2")
	default:
		return r.pick("pzz", "ТД1-1_2", "ТД1-2_2", "ТД2_2", "ТР5-2")
	}
}

func oknChance(fn string, year int) float64 {
	switch {
	case year < 1941 && fn == "culture":
		return 0.6
	case year < 1941:
		return 0.2
	case year < 1960:
		return 0.06
	}
	return 0.015
}

var streetAbbr = []struct{ full, short string }{
	{"проспект", "пр."}, {"улица", "ул."}, {"переулок", "пер."}, {"набережная", "наб."},
	{"шоссе", "ш."}, {"площадь", "пл."}, {"бульвар", "бул."}, {"линия", "лин."},
	{"дорога", "дор."}, {"проезд", "пр-д"}, {"аллея", "ал."},
}

func shortAddress(street, house string) string {
	words := strings.Fields(street)
	for i, w := range words {
		for _, a := range streetAbbr {
			if strings.EqualFold(w, a.full) {
				words[i] = a.short
			}
		}
	}
	h := strings.ReplaceAll(house, " ", "")
	h = strings.ReplaceAll(h, "к", " к")
	h = strings.ReplaceAll(h, "с", " с")
	h = strings.ReplaceAll(h, "лит", " лит.")
	return strings.Join(words, " ") + ", " + strings.TrimSpace(h)
}

func cleanName(n string) string {
	n = strings.TrimSpace(n)
	if !buildingNameRe.MatchString(n) {
		return ""
	}
	n = strings.ReplaceAll(n, "''", `"`)
	if strings.Count(n, `"`) == 2 {
		n = strings.Replace(n, `"`, "«", 1)
		n = strings.Replace(n, `"`, "»", 1)
	}
	if strings.Count(n, "«") != strings.Count(n, "»") {
		return ""
	}
	return n
}

// spreadSelect takes up to n features, limiting how many come from each
// ~1.1 km grid cell so that the map is covered evenly. Buildings with a
// known year or a name go first.
func spreadSelect(c []feature, n int) []feature {
	sort.Slice(c, func(i, j int) bool {
		ki, kj := rank(c[i]), rank(c[j])
		if ki != kj {
			return ki > kj
		}
		return newRNG(c[i].Properties.OSMID).f("order") < newRNG(c[j].Properties.OSMID).f("order")
	})
	// Доли функций в выборке: советский нежилой фонд — в основном
	// промышленность, склады и административные здания.
	quota := map[string]int{}
	for fn, share := range map[string]float64{
		"industrial": 0.40, "warehouse": 0.12, "administrative": 0.20, "research": 0.04,
		"culture": 0.07, "retail": 0.12, "sport": 0.05,
	} {
		quota[fn] = int(math.Ceil(share * float64(n)))
	}
	var out []feature
	perCell := map[[2]int]int{}
	for limit := 2; len(out) < n && limit <= 12; limit += 2 {
		if limit > 8 {
			quota = nil // добираем остаток без ограничений по функциям
		}
		for i := range c {
			if len(out) >= n {
				break
			}
			if c[i].Type == "" {
				continue
			}
			p := c[i].Properties
			if quota != nil && quota[p.OriginalFunction] <= 0 {
				continue
			}
			cell := [2]int{int(p.lat / 0.01), int(p.lon / 0.02)}
			if perCell[cell] >= limit {
				continue
			}
			perCell[cell]++
			if quota != nil {
				quota[p.OriginalFunction]--
			}
			out = append(out, c[i])
			c[i].Type = ""
		}
	}
	return out
}

func rank(f feature) int {
	k := 0
	if f.Properties.YearSource == "osm" {
		k += 2
	}
	if f.Properties.Name != "" {
		k++
	}
	return k
}

// ---- demo objects ----

type demo struct {
	el    element
	apply func(*feature)
}

func pickDemo(els []element) []demo {
	find := func(match func(element) bool) element {
		var best element
		for _, e := range els {
			if match(e) && footprintArea(e.Geom) > footprintArea(best.Geom) {
				best = e
			}
		}
		if best.ID == 0 {
			log.Fatal("demo building not found in OSM response")
		}
		return best
	}
	nameHas := func(s string) func(element) bool {
		return func(e element) bool { return strings.Contains(e.Tags["name"], s) }
	}
	kirov := find(nameHas("Кирова"))
	gaza := find(nameHas("Газа"))
	skorokhod := find(func(e element) bool {
		// Фабрика занимает квартал по Заставской, 33 (несколько литер).
		return e.Tags["addr:street"] == "Заставская улица" && strings.HasPrefix(e.Tags["addr:housenumber"], "33")
	})
	return []demo{
		{kirov, func(f *feature) {
			p := &f.Properties
			p.DemoSlug, p.Name, p.Address = "dk-kirova", "ДК имени С. М. Кирова", "Большой пр. В.О., 83"
			p.YearBuilt, p.YearSource, p.OriginalFunction = 1937, "manual", "culture"
			p.Floors, p.IsOKN, p.LegalStatus = 5, true, "Собственность Санкт-Петербурга"
			p.AreaTotal = round1(p.AreaFootprint * 4.1)
			p.PZZZone, p.VRI = "ТД1-1_2", vri["culture"]
		}},
		{skorokhod, func(f *feature) {
			p := &f.Properties
			p.DemoSlug, p.Name, p.Address = "skorokhod", "Производственный корпус фабрики «Скороход»", "Заставская ул., 33"
			p.YearBuilt, p.YearSource, p.OriginalFunction = 1932, "manual", "industrial"
			p.IsOKN, p.LegalStatus = false, "Частная собственность"
			if p.Floors < 4 {
				p.Floors = 5
			}
			p.AreaTotal = round1(p.AreaFootprint * float64(p.Floors) * 0.9)
			p.PZZZone, p.VRI = "ТД1-2_2", vri["industrial"]
		}},
		{gaza, func(f *feature) {
			p := &f.Properties
			p.DemoSlug, p.Name, p.Address = "dk-gaza", "ДК имени И. И. Газа", "пр. Стачек, 72"
			p.YearBuilt, p.YearSource, p.OriginalFunction = 1935, "manual", "culture"
			p.Floors, p.IsOKN, p.LegalStatus = 4, true, "Собственность Санкт-Петербурга"
			p.AreaTotal = round1(p.AreaFootprint * 3.4)
			p.PZZZone, p.VRI = "ТД1-1_2", vri["culture"]
		}},
	}
}

func clamp(v, lo, hi int) int  { return max(lo, min(hi, v)) }
func round1(v float64) float64 { return math.Round(v*10) / 10 }
func round6(v float64) float64 { return math.Round(v*1e6) / 1e6 }
