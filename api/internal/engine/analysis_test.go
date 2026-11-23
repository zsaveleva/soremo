package engine

import (
	"strings"
	"testing"
)

func scenarioByCode(out EngineOutput, code string) *Scenario {
	for i := range out.Scenarios {
		if out.Scenarios[i].FunctionCode == code {
			return &out.Scenarios[i]
		}
	}
	return nil
}

func TestEveryScenarioIsExplained(t *testing.T) {
	for _, in := range []EngineInput{dkNearMetro(), plantOnOutskirts()} {
		for _, l := range []AccuracyLevel{AccuracyLow, AccuracyMid, AccuracyHigh} {
			in.AccuracyLevel = l
			out := Assess(in)
			for _, sc := range out.Scenarios {
				if sc.Feasibility == nil || len(sc.Feasibility.Checks) < 2 {
					t.Errorf("%s/%s: у вердикта нет оснований", sc.FunctionCode, l)
				}
				if len(sc.Pros) == 0 || len(sc.Cons) == 0 {
					t.Errorf("%s/%s: нужны и «за», и «против»: %v / %v", sc.FunctionCode, l, sc.Pros, sc.Cons)
				}
				if sc.Evidence == nil || len(sc.Evidence.Confirmed) == 0 || len(sc.Evidence.Missing) == 0 {
					t.Errorf("%s/%s: не перечислены подтверждённые и недостающие данные", sc.FunctionCode, l)
				}
			}
			if len(out.TechRisks) == 0 || len(out.NextSteps) == 0 {
				t.Errorf("%s: нет рисков техсостояния или следующих шагов", l)
			}
		}
	}
}

func TestFeasibilityStatusIsWorstCheck(t *testing.T) {
	in := plantOnOutskirts()
	in.Zones = []Zone{{Code: "szz", Title: "Санитарно-защитная зона предприятия", Effect: "restriction"}}
	v := feasibility(in, "campus")
	if v.Status != Restricted {
		t.Fatalf("кампус в промзоне и СЗЗ: ожидалось ограничение, получено %s", v.Status)
	}
	v = feasibility(in, "light_industrial")
	if v.Status == Restricted {
		t.Fatalf("light industrial в промзоне не должен быть ограничен: %+v", v.Checks)
	}
	for _, c := range v.Checks {
		if c.Status == Restricted {
			t.Fatalf("основание с ограничением у реализуемого сценария: %s", c.Text)
		}
	}
}

func TestHeritageBlocksSuperstructure(t *testing.T) {
	in := dkNearMetro()
	in.Building.IsOKN = true
	in.Zones = []Zone{}
	if v := feasibility(in, "aparthotel"); v.Status != Restricted {
		t.Fatalf("надстройка ОКН: ожидалось ограничение, получено %s", v.Status)
	}
	if v := feasibility(in, "culture_center"); v.Status != NeedsCheck {
		t.Fatalf("ДК-ОКН под культурный центр: ожидалась проверка КГИОП, получено %s", v.Status)
	}
}

func TestUncheckedZonesAreFlagged(t *testing.T) {
	in := dkNearMetro()
	in.Zones = nil
	v := feasibility(in, "culture_center")
	found := false
	for _, c := range v.Checks {
		found = found || strings.Contains(c.Text, "РГИС")
	}
	if !found || v.Status == Feasible {
		t.Fatalf("непроверенные зоны должны давать «нужна проверка»: %+v", v)
	}
}

func TestAccuracyNarrowsTechReserveAndDropsSurveyStep(t *testing.T) {
	in := plantOnOutskirts()
	in.AccuracyLevel = AccuracyLow
	low := Assess(in)
	in.AccuracyLevel = AccuracyHigh
	high := Assess(in)
	if high.TechRisks[0].Reserve.Max >= low.TechRisks[0].Reserve.Max {
		t.Errorf("резерв не сузился: %v → %v", low.TechRisks[0].Reserve, high.TechRisks[0].Reserve)
	}
	if !strings.Contains(low.NextSteps[0], "техническое обследование") {
		t.Errorf("при низкой точности первый шаг — обследование: %q", low.NextSteps[0])
	}
	for _, s := range high.NextSteps {
		if strings.Contains(s, "Заказать техническое обследование") {
			t.Errorf("при высокой точности обследование уже есть: %q", s)
		}
	}
}

func TestAnnotateKeepsExistingParts(t *testing.T) {
	in := dkNearMetro()
	out := Assess(in)
	out.NextSteps = []string{"свой шаг"}
	custom := &FeasibilityVerdict{Status: Feasible, Checks: []Check{{Status: Feasible, Text: "вручную"}}}
	out.Scenarios[0].Feasibility = custom
	Annotate(in, &out)
	if out.NextSteps[0] != "свой шаг" || out.Scenarios[0].Feasibility != custom {
		t.Fatal("Annotate перезаписал готовые блоки")
	}
	if scenarioByCode(out, out.Scenarios[0].FunctionCode) == nil {
		t.Fatal("сценарий потерялся")
	}
}

func TestDemoZonesAreNotConfirmedEvidence(t *testing.T) {
	in := dkNearMetro()
	in.Zones = []Zone{}
	in.ZonesDemo = true
	out := Assess(in)
	for _, sc := range out.Scenarios {
		if sc.Feasibility.Status == Feasible {
			t.Fatalf("demo zones must require a check: %s", sc.FunctionCode)
		}
		for _, text := range sc.Evidence.Confirmed {
			if strings.Contains(text, "Зоны") {
				t.Fatalf("demo zones presented as confirmed: %s", text)
			}
		}
	}
}
