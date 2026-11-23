// Command zones builds seed/zones.json: zones with special conditions that
// intersect each building (the РГИС Санкт-Петербурга layer in the product).
//
// The real layers are not imported yet, so the result is a deterministic
// demo: the zones follow simple rules on real inputs (distance to the
// historic centre, heritage status, ПЗЗ zone) plus a hash of the OSM id.
// Every zone carries demo=true and the UI asks to check it in РГИС.
//
//	go run ./zones -in ../buildings.geojson -out ../zones.json
package main

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"strings"
)

// CheckedOn is the date of the layer snapshot shown next to every zone.
const CheckedOn = "2026-11-23"

type Zone struct {
	Code   string `json:"code"`
	Title  string `json:"title"`
	Effect string `json:"effect"` // restriction | check | info
	Note   string `json:"note"`
}

// Output keeps each zone text once: catalogue by code, then codes by OSM id.
type Output struct {
	Source    string              `json:"source"`
	CheckedOn string              `json:"checked_on"`
	Demo      bool                `json:"demo"`
	Catalogue map[string]Zone     `json:"catalogue"`
	Buildings map[string][]string `json:"buildings"`
}

type feature struct {
	Geometry struct {
		Coordinates [][][2]float64 `json:"coordinates"`
	} `json:"geometry"`
	Properties struct {
		OSMID            int64  `json:"osm_id"`
		IsOKN            bool   `json:"is_okn"`
		PZZZone          string `json:"pzz_zone"`
		OriginalFunction string `json:"original_function"`
	} `json:"properties"`
}

func main() {
	in := flag.String("in", "../buildings.geojson", "buildings GeoJSON")
	out := flag.String("out", "../zones.json", "output file")
	flag.Parse()

	raw, err := os.ReadFile(*in)
	if err != nil {
		fail(err)
	}
	var fc struct {
		Features []feature `json:"features"`
	}
	if err := json.Unmarshal(raw, &fc); err != nil {
		fail(err)
	}
	res := Output{Source: "РГИС Санкт-Петербурга", CheckedOn: CheckedOn, Demo: true,
		Catalogue: map[string]Zone{}, Buildings: map[string][]string{}}
	for _, f := range fc.Features {
		codes := []string{}
		for _, z := range zonesFor(f) {
			res.Catalogue[z.Code] = z
			codes = append(codes, z.Code)
		}
		res.Buildings[fmt.Sprint(f.Properties.OSMID)] = codes
	}
	b, err := json.Marshal(res)
	if err != nil {
		fail(err)
	}
	if err := os.WriteFile(*out, append(b, '\n'), 0o644); err != nil {
		fail(err)
	}
}

// Дворцовая площадь — та же точка, что в генераторе зданий.
var centre = [2]float64{30.3158, 59.9390}

func zonesFor(f feature) []Zone {
	p := f.Properties
	h := func(key string) float64 { return unit(p.OSMID, key) }
	d := distKm(centroid(f.Geometry.Coordinates[0]), centre)
	var zs []Zone

	if p.IsOKN {
		zs = append(zs, Zone{"okn_territory", "Территория объекта культурного наследия", "restriction",
			"Работы на фасадах и в предмете охраны — по заданию и согласованию КГИОП; надстройка исключена."})
	}
	switch {
	case d <= 3.6:
		zs = append(zs, Zone{"okn_zone_1", "Зона регулирования застройки ЗРЗ1", "restriction",
			"Режим зоны охраны ОКН сохраняет высоту и силуэт: надстройка и изменение уличных фасадов ограничены (Закон СПб № 820-7)."})
	case d <= 5.5 && h("zrz2") < 0.5:
		zs = append(zs, Zone{"okn_zone_2", "Зона регулирования застройки ЗРЗ2", "check",
			"Предельная высота зданий регламентирована режимом зоны: надстройку нужно проверить по режиму (Закон СПб № 820-7)."})
	}
	if (strings.HasPrefix(p.PZZZone, "ТП") && h("szz") < 0.6) || (p.OriginalFunction == "industrial" && h("szz") < 0.25) {
		zs = append(zs, Zone{"szz", "Санитарно-защитная зона предприятия", "restriction",
			"В СЗЗ нельзя размещать жильё, образовательные и детские учреждения, открытые спортивные сооружения (СанПиН 2.2.1/2.1.1.1200-03)."})
	}
	if v := h("utility"); v < 0.3 {
		code, title := "utility_heat", "Охранная зона тепловых сетей"
		if v < 0.12 {
			code, title = "utility_power", "Охранная зона кабельной линии электропередачи"
		}
		zs = append(zs, Zone{code, title, "check",
			"Земляные работы, пристройки и расширение здания в полосе зоны — по согласованию с сетевой организацией."})
	}
	if h("water") < 0.1 {
		zs = append(zs, Zone{"water", "Водоохранная зона", "info",
			"Ограничивает склады ГСМ, мойки и стоянки без ливневой канализации; на реконструкцию без расширения не влияет."})
	}
	zs = append(zs, Zone{"airfield", "Приаэродромная территория аэродрома Пулково", "info",
		"Высота новых частей здания согласуется с Росавиацией; на смену функции не влияет."})
	return zs
}

func centroid(ring [][2]float64) [2]float64 {
	n := len(ring) - 1
	var x, y float64
	for _, p := range ring[:n] {
		x += p[0] / float64(n)
		y += p[1] / float64(n)
	}
	return [2]float64{x, y}
}

func distKm(a, b [2]float64) float64 {
	const r = 6371.0
	la1, la2 := a[1]*math.Pi/180, b[1]*math.Pi/180
	dla, dlo := la2-la1, (b[0]-a[0])*math.Pi/180
	s := math.Sin(dla/2)*math.Sin(dla/2) + math.Cos(la1)*math.Cos(la2)*math.Sin(dlo/2)*math.Sin(dlo/2)
	return 2 * r * math.Asin(math.Sqrt(s))
}

func unit(id int64, key string) float64 {
	b := make([]byte, 8)
	binary.LittleEndian.PutUint64(b, uint64(id))
	h := sha256.Sum256(append(b, []byte("zones:"+key)...))
	return float64(binary.LittleEndian.Uint64(h[:8])>>11) / float64(1<<53)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
