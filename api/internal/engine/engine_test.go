package engine

import (
	"reflect"
	"strings"
	"testing"
)

func dkNearMetro() EngineInput {
	return EngineInput{
		Building: Building{ID: 1, Address: "Большой пр. В.О., 83", YearBuilt: 1937, OriginalFunction: "culture",
			Floors: 4, AreaTotalM2: 18000, PZZZone: "ТД1-1_2"},
		Context:       Context{MetroName: "Приморская", MetroDistM: 400, TransitIndex: 82, Social500m: 24, CommercialDensity: 60, BusinessActivity: 30},
		AccuracyLevel: AccuracyLow,
	}
}

func plantOnOutskirts() EngineInput {
	return EngineInput{
		Building: Building{ID: 2, Address: "Нефтяная дор., 3", YearBuilt: 1979, OriginalFunction: "industrial",
			Floors: 2, AreaTotalM2: 12000, PZZZone: "ТП1"},
		Context:       Context{MetroName: "Обводный канал", MetroDistM: 2900, TransitIndex: 18, Social500m: 1, CommercialDensity: 8, BusinessActivity: 3},
		AccuracyLevel: AccuracyLow,
	}
}

func codes(out EngineOutput) []string {
	var c []string
	for _, s := range out.Scenarios {
		c = append(c, s.FunctionCode)
	}
	return c
}

func TestDifferentBuildingsGetDifferentScenarios(t *testing.T) {
	dk := Assess(dkNearMetro())
	plant := Assess(plantOnOutskirts())

	if got := dk.Scenarios[0].FunctionCode; got != "culture_center" && got != "community_center" && got != "creative_cluster" {
		t.Errorf("ДК у метро: ожидался общественный или культурный сценарий, получен %s", got)
	}
	if got := plant.Scenarios[0].FunctionCode; got != "light_industrial" && got != "warehouse_office" {
		t.Errorf("промкорпус на окраине: ожидался light industrial или склад, получен %s", got)
	}
	if reflect.DeepEqual(codes(dk), codes(plant)) {
		t.Errorf("одинаковые сценарии для разных объектов: %v", codes(dk))
	}
}

func TestAccuracyControlsCountAndRanges(t *testing.T) {
	in := plantOnOutskirts()
	var widths []float64
	for _, l := range []AccuracyLevel{AccuracyLow, AccuracyMid, AccuracyHigh} {
		in.AccuracyLevel = l
		out := Assess(in)
		if len(out.Scenarios) != ScenarioCount(l) {
			t.Fatalf("%s: %d сценариев, ожидалось %d", l, len(out.Scenarios), ScenarioCount(l))
		}
		c := out.Scenarios[0].Economics.CapexRub
		widths = append(widths, (c.Max-c.Min)/c.Max)
	}
	if !(widths[0] > widths[1] && widths[1] > widths[2]) {
		t.Errorf("диапазоны должны сужаться с ростом точности: %v", widths)
	}
	if widths[2] != 0 {
		t.Errorf("при высокой точности ожидалось точечное значение, ширина %v", widths[2])
	}
}

func TestHeritageKeepsFacadesAndTakesLonger(t *testing.T) {
	in := dkNearMetro()
	in.AccuracyLevel = AccuracyHigh
	plain := Assess(in)
	in.Building.IsOKN = true
	okn := Assess(in)

	for _, s := range okn.Scenarios {
		if s.FunctionCode == "aparthotel" {
			t.Error("апарт-отель с надстройкой не должен предлагаться для ОКН")
		}
		if s.TEP.After.Floors != in.Building.Floors {
			t.Errorf("%s: этажность ОКН изменилась", s.Title)
		}
		if !strings.Contains(s.Description, "Фасады") {
			t.Errorf("%s: в описании нет условия сохранения фасадов", s.Title)
		}
	}
	find := func(out EngineOutput, code string) *Scenario {
		for i := range out.Scenarios {
			if out.Scenarios[i].FunctionCode == code {
				return &out.Scenarios[i]
			}
		}
		return nil
	}
	a, b := find(plain, "culture_center"), find(okn, "culture_center")
	if a == nil || b == nil {
		t.Fatal("культурный центр должен быть в обоих отчётах")
	}
	if b.Economics.TermMonths.Max <= a.Economics.TermMonths.Max || b.Economics.CapexRub.Max <= a.Economics.CapexRub.Max {
		t.Error("для ОКН срок и капвложения должны быть больше")
	}
	if len(okn.Warnings) == 0 || !strings.Contains(okn.Warnings[0], "КГИОП") {
		t.Error("нет предупреждения о согласовании КГИОП")
	}
}

func TestDeterministicAndPlausible(t *testing.T) {
	a, b := Assess(dkNearMetro()), Assess(dkNearMetro())
	if !reflect.DeepEqual(a, b) {
		t.Fatal("результат должен быть детерминированным")
	}
	for _, in := range []EngineInput{dkNearMetro(), plantOnOutskirts()} {
		in.AccuracyLevel = AccuracyHigh
		for _, s := range Assess(in).Scenarios {
			perM2 := s.Economics.CapexRub.Max / s.TEP.After.AreaTotalM2
			if perM2 < 55_000 || perM2 > 230_000 {
				t.Errorf("%s: капвложения %.0f ₽/м² вне правдоподобного диапазона", s.Title, perM2)
			}
			var share float64
			for _, z := range s.Zoning {
				share += z.Share
			}
			if share < 0.999 || share > 1.001 {
				t.Errorf("%s: доли зонирования в сумме %.3f", s.Title, share)
			}
			if p := s.Economics.PaybackYears.Max; p < 2 || p > 30 {
				t.Errorf("%s: окупаемость %.1f лет неправдоподобна", s.Title, p)
			}
			if len(s.Risks) != 3 {
				t.Errorf("%s: ожидалось 3 риска", s.Title)
			}
		}
	}
}

func TestWarningsNeverNil(t *testing.T) {
	in := plantOnOutskirts()
	in.AccuracyLevel = AccuracyHigh
	if out := Assess(in); out.Warnings == nil {
		t.Fatal("warnings must be an empty slice, not nil: the frontend reads .length")
	}
}

func TestAccuracyRule(t *testing.T) {
	cases := []struct {
		kinds []string
		want  AccuracyLevel
	}{
		{nil, AccuracyLow},
		{[]string{"other"}, AccuracyMid},
		{[]string{"other", "survey"}, AccuracyHigh},
		{[]string{"expertise"}, AccuracyHigh},
	}
	for _, c := range cases {
		if got := AccuracyFor(c.kinds); got != c.want {
			t.Errorf("AccuracyFor(%v) = %s, want %s", c.kinds, got, c.want)
		}
	}
}
