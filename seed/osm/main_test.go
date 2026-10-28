package main

import (
	"math"
	"testing"
)

func TestShortAddress(t *testing.T) {
	cases := map[[2]string]string{
		{"Заставская улица", "33 литП"}:    "Заставская ул., 33 лит.П",
		{"Большой проспект В.О.", "83"}:    "Большой пр. В.О., 83",
		{"проспект Стачек", "72"}:          "пр. Стачек, 72",
		{"Цветочная улица", "6 литА"}:      "Цветочная ул., 6 лит.А",
		{"Светлановский проспект", "48к4"}: "Светлановский пр., 48 к4",
	}
	for in, want := range cases {
		if got := shortAddress(in[0], in[1]); got != want {
			t.Errorf("shortAddress(%q, %q) = %q, want %q", in[0], in[1], got, want)
		}
	}
}

func TestFootprintArea(t *testing.T) {
	// Квадрат 100 × 100 м на широте Петербурга.
	lat := 59.9
	dLat := 100 / earthR * 180 / math.Pi
	dLon := dLat / math.Cos(lat*math.Pi/180)
	ring := []latLon{{lat, 30}, {lat, 30 + dLon}, {lat + dLat, 30 + dLon}, {lat + dLat, 30}, {lat, 30}}
	if a := footprintArea(ring); math.Abs(a-10000) > 50 {
		t.Fatalf("area = %.1f m², want ≈10000", a)
	}
}

func TestCleanNameKeepsOnlyBuildingNames(t *testing.T) {
	if got := cleanName(`Завод "Электросила"`); got != "Завод «Электросила»" {
		t.Errorf("got %q", got)
	}
	for _, tenant := range []string{"Стройудача", "NorthSilver", "Пресс-центр"} {
		if got := cleanName(tenant); got != "" {
			t.Errorf("tenant name %q kept as %q", tenant, got)
		}
	}
}

func TestModernFilter(t *testing.T) {
	for _, n := range []string{"Бизнес-центр «Арка»", "ТЦ Флагман", "NorthSilver", "БЦ Максель"} {
		if !modernRe.MatchString(n) {
			t.Errorf("%q should be filtered as modern", n)
		}
	}
	for _, n := range []string{"Мотодепо", "Дворец культуры имени Газа", "Тканевая фабрика"} {
		if modernRe.MatchString(n) {
			t.Errorf("%q should not be filtered", n)
		}
	}
}
