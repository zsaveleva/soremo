package engine

import (
	"fmt"
	"math"
	"strings"
)

// Annotate fills the parts of the report that explain the numbers: per-scenario
// feasibility with grounds, pros and cons, confirmed and missing data, and
// report-level technical risks and next steps. Parts already present are kept,
// so hand-written demo reports and reports from older engine versions get the
// same blocks without changing their numbers.
func Annotate(in EngineInput, out *EngineOutput) {
	for i := range out.Scenarios {
		sc := &out.Scenarios[i]
		if sc.Feasibility == nil {
			v := feasibility(in, sc.FunctionCode)
			sc.Feasibility = &v
		}
		if sc.Pros == nil && sc.Cons == nil {
			sc.Pros, sc.Cons = prosCons(in, out.Scenarios, i)
		}
		if sc.Evidence == nil {
			e := evidence(in, sc.FunctionCode)
			sc.Evidence = &e
		}
	}
	if out.TechRisks == nil {
		out.TechRisks = techRisks(in)
	}
	if out.NextSteps == nil {
		out.NextSteps = nextSteps(in, out.Scenarios)
	}
}

// rule — правовые и технические условия функции.
type rule struct {
	// vriFrom — исходные назначения, чей ВРИ уже допускает функцию.
	vriFrom []string
	vriName string
	// pzz — статус функции в зонах ПЗЗ по префиксу: ТД, ТП, ТР.
	pzz map[string]Feasibility
	// szz — статус функции в санитарно-защитной зоне.
	szz Feasibility
	// structural — без техобследования неизвестно, выдержат ли конструкции.
	structural string
	missing    []string
}

var rules = map[string]rule{
	"creative_cluster": {
		vriFrom: []string{"administrative", "culture", "research"}, vriName: "«Деловое управление» (4.1) и «Культурное развитие» (3.6)",
		pzz:     map[string]Feasibility{"ТД": Feasible, "ТП": NeedsCheck, "ТР": NeedsCheck},
		szz:     NeedsCheck,
		missing: []string{"Шаг колонн и высота этажей: от них зависит нарезка студий", "Эвакуационные пути под поток посетителей"},
	},
	"light_industrial": {
		vriFrom: []string{"industrial", "warehouse"}, vriName: "«Производственная деятельность» (6.0)",
		pzz:        map[string]Feasibility{"ТД": NeedsCheck, "ТП": Feasible, "ТР": Restricted},
		szz:        Feasible,
		structural: "грузоподъёмность перекрытий под оборудование",
		missing:    []string{"Грузоподъёмность перекрытий и грузовых лифтов", "Свободная мощность электросетей"},
	},
	"warehouse_office": {
		vriFrom: []string{"warehouse", "industrial"}, vriName: "«Склад» (6.9)",
		pzz:        map[string]Feasibility{"ТД": NeedsCheck, "ТП": Feasible, "ТР": Restricted},
		szz:        Feasible,
		structural: "несущая способность перекрытий под складскую нагрузку",
		missing:    []string{"Несущая способность перекрытий под складскую нагрузку", "Подъезд и разворот грузовиков на участке"},
	},
	"business_center": {
		vriFrom: []string{"administrative", "research"}, vriName: "«Деловое управление» (4.1)",
		pzz:     map[string]Feasibility{"ТД": Feasible, "ТП": Feasible, "ТР": NeedsCheck},
		szz:     Feasible,
		missing: []string{"Мощность электросетей и вентиляции под офисную плотность", "Сколько машино-мест помещается на участке"},
	},
	"aparthotel": {
		vriName:    "«Гостиничное обслуживание» (4.7)",
		pzz:        map[string]Feasibility{"ТД": Feasible, "ТП": Restricted, "ТР": Restricted},
		szz:        Restricted,
		structural: "возможность надстройки по несущим конструкциям",
		missing:    []string{"Инсоляция и шумовой режим для номеров", "Возможность надстройки по несущим конструкциям"},
	},
	"culture_center": {
		vriFrom: []string{"culture"}, vriName: "«Культурное развитие» (3.6)",
		pzz:     map[string]Feasibility{"ТД": Feasible, "ТП": NeedsCheck, "ТР": Feasible},
		szz:     NeedsCheck,
		missing: []string{"Состояние зала, сцены и сценического оборудования", "Операторская модель и участие города"},
	},
	"community_center": {
		vriFrom: []string{"culture", "sport"}, vriName: "«Общественное использование объектов капитального строительства» (3.0)",
		pzz:        map[string]Feasibility{"ТД": Feasible, "ТП": NeedsCheck, "ТР": Feasible},
		szz:        Restricted,
		structural: "высота залов под спорт (от 6 м)",
		missing:    []string{"Высота залов для спорта (от 6 м)", "Спрос районных операторов и городских программ"},
	},
	"campus": {
		vriName: "«Образование и просвещение» (3.5)",
		pzz:     map[string]Feasibility{"ТД": Feasible, "ТП": Restricted, "ТР": NeedsCheck},
		szz:     Restricted,
		missing: []string{"Освещённость и высота аудиторий по санитарным нормам для образования", "Якорный образовательный оператор"},
	},
	"retail_services": {
		vriFrom: []string{"retail"}, vriName: "«Магазины» (4.4)",
		pzz:     map[string]Feasibility{"ТД": Feasible, "ТП": NeedsCheck, "ТР": NeedsCheck},
		szz:     Feasible,
		missing: []string{"Место для парковки на участке", "Якорный продуктовый арендатор"},
	},
	"sport_center": {
		vriFrom: []string{"sport"}, vriName: "«Спорт» (5.1)",
		pzz:        map[string]Feasibility{"ТД": Feasible, "ТП": NeedsCheck, "ТР": Feasible},
		szz:        NeedsCheck,
		structural: "высота залов и пролёты без колонн",
		missing:    []string{"Высота залов (от 6 м) и пролёты без колонн", "Возможность бассейна в существующих конструкциях"},
	},
}

func profileOf(code string) (profile, bool) {
	for _, p := range catalogue {
		if p.code == code {
			return p, true
		}
	}
	return profile{}, false
}

func pzzPrefix(zone string) string {
	r := []rune(zone)
	if len(r) < 2 {
		return ""
	}
	return string(r[:2])
}

func worse(a, b Feasibility) Feasibility {
	rank := map[Feasibility]int{Feasible: 0, NeedsCheck: 1, Restricted: 2}
	if rank[b] > rank[a] {
		return b
	}
	return a
}

func hasZone(in EngineInput, codes ...string) *Zone {
	for i, z := range in.Zones {
		for _, c := range codes {
			if z.Code == c {
				return &in.Zones[i]
			}
		}
	}
	return nil
}

func feasibility(in EngineInput, code string) FeasibilityVerdict {
	b := in.Building
	r, ok := rules[code]
	p, _ := profileOf(code)
	v := FeasibilityVerdict{Status: Feasible}
	add := func(s Feasibility, text string) {
		v.Checks = append(v.Checks, Check{Status: s, Text: text})
		v.Status = worse(v.Status, s)
	}
	if !ok {
		add(NeedsCheck, "Для этой функции нет правил проверки: оцените реализуемость с проектировщиком.")
		return v
	}

	// 1. Вид разрешённого использования.
	vri := strings.TrimSpace(b.VRI)
	if vri == "" {
		vri = "не указан"
	}
	if is(in, r.vriFrom...) {
		add(Feasible, fmt.Sprintf("Текущий ВРИ «%s» допускает функцию.", vri))
	} else {
		add(NeedsCheck, fmt.Sprintf("Нужен ВРИ %s, сейчас «%s». Изменение — через публичные слушания, несколько месяцев.", r.vriName, vri))
	}

	// 2. Зона по ПЗЗ.
	switch st, known := r.pzz[pzzPrefix(b.PZZZone)]; {
	case !known:
		add(NeedsCheck, fmt.Sprintf("Зона %s по ПЗЗ: проверьте градостроительный регламент вручную.", b.PZZZone))
	case st == Feasible:
		add(Feasible, fmt.Sprintf("Зона %s по ПЗЗ допускает функцию как основной вид.", b.PZZZone))
	case st == NeedsCheck:
		add(NeedsCheck, fmt.Sprintf("В зоне %s функция — условно разрешённый вид: нужно разрешение после публичных слушаний.", b.PZZZone))
	default:
		add(Restricted, fmt.Sprintf("Зона %s по ПЗЗ не допускает функцию: понадобится изменение зоны.", b.PZZZone))
	}

	// 3. Охрана наследия и зоны с особыми условиями.
	addsArea := p.areaChange > 0
	if b.IsOKN {
		if p.addsFloor {
			add(Restricted, "Объект культурного наследия: надстройка исключена, сценарий возможен только без неё.")
		} else {
			add(NeedsCheck, "Объект культурного наследия: работы — по заданию КГИОП, фасады и предмет охраны сохраняются.")
		}
	}
	if z := hasZone(in, "okn_zone_1"); z != nil && (p.addsFloor || addsArea) {
		st := NeedsCheck
		if p.addsFloor {
			st = Restricted
		}
		add(st, fmt.Sprintf("%s: функция требует надстройки или новых объёмов, а режим зоны их ограничивает.", z.Title))
	}
	if z := hasZone(in, "okn_zone_2", "airfield"); z != nil && p.addsFloor {
		add(NeedsCheck, fmt.Sprintf("%s: высоту надстройки нужно согласовать.", z.Title))
	}
	if z := hasZone(in, "szz"); z != nil && r.szz != Feasible {
		if r.szz == Restricted {
			add(Restricted, fmt.Sprintf("%s: функция не допускается — в СЗЗ запрещены жильё, образование и детские учреждения.", z.Title))
		} else {
			add(NeedsCheck, fmt.Sprintf("%s: размещение посетителей нужно согласовать с Роспотребнадзором.", z.Title))
		}
	}
	if z := hasZone(in, "utility_heat", "utility_power"); z != nil && addsArea {
		add(NeedsCheck, fmt.Sprintf("%s: новые объёмы и пристройки — по согласованию с сетевой организацией.", z.Title))
	}
	if in.Zones == nil {
		add(NeedsCheck, "Пересечения с зонами для объекта не проверены: сверьте участок в РГИС и НСПД.")
	}
	if in.ZonesDemo {
		add(NeedsCheck, "Зоны размечены для демонстрации: подтвердите пересечения в РГИС и НСПД.")
	}

	// 4. Конструкции.
	if r.structural != "" && in.AccuracyLevel != AccuracyHigh {
		add(NeedsCheck, "Без техобследования неизвестна "+r.structural+".")
	}
	return v
}

func prosCons(in EngineInput, all []Scenario, i int) (pros, cons []string) {
	sc := all[i]
	b, c := in.Building, in.Context
	r := rules[sc.FunctionCode]
	code := sc.FunctionCode

	if is(in, r.vriFrom...) {
		pros = append(pros, "Текущий вид разрешённого использования подходит: менять его не нужно.")
	} else {
		cons = append(cons, "Нужно менять вид разрешённого использования: это добавляет несколько месяцев к подготовке.")
	}

	switch {
	case sc.Scale == ScaleCity && c.TransitIndex >= 60:
		pros = append(pros, fmt.Sprintf("Метро «%s» в %d м: функция общегородского значения соберёт посетителей со всего города.", c.MetroName, round50(c.MetroDistM)))
	case sc.Scale == ScaleCity && c.TransitIndex < 40:
		cons = append(cons, "Метро далеко: городской функции нужен свой повод, чтобы к ней ехали.")
	case sc.Scale == ScaleLocal && c.TransitIndex < 40 && (code == "light_industrial" || code == "warehouse_office"):
		pros = append(pros, "Функции не нужен поток посетителей, удалённость от метро ей не мешает.")
	}
	if (code == "retail_services" || code == "creative_cluster") && c.CommercialDensity >= 60 {
		pros = append(pros, "Плотная торговля и общепит вокруг поддержат первые этажи.")
	}
	if code == "retail_services" && c.CommercialDensity < 25 {
		cons = append(cons, "Торговли рядом мало: первым этажам нужен собственный якорь.")
	}
	if code == "business_center" {
		if c.BusinessActivity >= 50 {
			pros = append(pros, "В районе сложился офисный спрос.")
		} else if c.BusinessActivity < 20 {
			cons = append(cons, "Офисов рядом почти нет: спрос придётся создавать.")
		}
	}
	if (code == "community_center" || code == "sport_center" || code == "campus") && c.Social500m >= 15 {
		pros = append(pros, fmt.Sprintf("%d социальных объектов в 500 м: район живой, есть спрос на услуги.", c.Social500m))
	}
	if b.IsOKN && (code == "culture_center" || code == "community_center" || code == "creative_cluster") {
		pros = append(pros, "Общественная функция упрощает согласование работ с КГИОП.")
	}

	if len(all) > 1 {
		pb, cx := sc.Economics.PaybackYears.Min, sc.Economics.CapexRub.Min
		minPB, maxPB, minCX, maxCX := math.Inf(1), math.Inf(-1), math.Inf(1), math.Inf(-1)
		for _, o := range all {
			minPB, maxPB = math.Min(minPB, o.Economics.PaybackYears.Min), math.Max(maxPB, o.Economics.PaybackYears.Min)
			minCX, maxCX = math.Min(minCX, o.Economics.CapexRub.Min), math.Max(maxCX, o.Economics.CapexRub.Min)
		}
		if pb == minPB {
			pros = append(pros, "Самая быстрая окупаемость среди сценариев отчёта.")
		} else if pb == maxPB {
			cons = append(cons, "Самая долгая окупаемость среди сценариев отчёта.")
		}
		if cx == minCX {
			pros = append(pros, "Самые низкие капвложения среди сценариев отчёта.")
		} else if cx == maxCX {
			cons = append(cons, "Самые высокие капвложения среди сценариев отчёта.")
		}
	}
	if b.IsOKN {
		cons = append(cons, "Статус ОКН удлиняет подготовку и удорожает работы.")
	}

	if len(pros) == 0 {
		pros = append(pros, "Входит в число лучших по оценке модели из десяти функций каталога.")
	}
	if len(cons) == 0 && len(sc.Risks) > 0 {
		cons = append(cons, sc.Risks[0])
	}
	return capN(pros, 4), capN(cons, 4)
}

var docNames = map[string]string{"survey": "Техническое обследование", "expertise": "Экспертиза", "other": "Документ по зданию"}

func evidence(in EngineInput, code string) Evidence {
	b := in.Building
	e := Evidence{Confirmed: []string{}, Missing: []string{}}
	if b.Source == "user" {
		e.Confirmed = append(e.Confirmed, "Адрес и контур здания — данные собственника, проверены модератором")
	} else {
		e.Confirmed = append(e.Confirmed, "Адрес, контур и площадь застройки — OpenStreetMap")
	}
	e.Confirmed = append(e.Confirmed, "Окружение: метро, социальные объекты, торговля и офисы — расчёт по OpenStreetMap")
	if in.Zones != nil {
		if in.ZonesDemo {
			e.Missing = append(e.Missing, "Зоны с особыми условиями: демо-разметку нужно подтвердить в РГИС и НСПД")
		} else {
			e.Confirmed = append(e.Confirmed, "Зоны с особыми условиями — сохранённые данные участка")
		}
	}
	for _, d := range in.Documents {
		e.Confirmed = append(e.Confirmed, fmt.Sprintf("%s от %s — принят после проверки", docNames[d.Kind], d.IssuedOn.Format("02.01.2006")))
	}
	if b.YearSource == "osm" || b.YearSource == "manual" {
		e.Confirmed = append(e.Confirmed, "Год постройки")
	}

	if in.AccuracyLevel != AccuracyHigh {
		e.Missing = append(e.Missing, "Техническое состояние каркаса, перекрытий, кровли и инженерии")
	}
	if b.YearSource == "generated" {
		e.Missing = append(e.Missing, "Год постройки: оценка по эпохе застройки района")
	}
	e.Missing = append(e.Missing, "Границы участка и ГПЗУ: выписка ЕГРН или НСПД")
	e.Missing = append(e.Missing, rules[code].missing...)
	return e
}

func techRisks(in EngineInput) []TechRisk {
	b := in.Building
	age := 2026 - b.YearBuilt
	// Резерв к капвложениям сужается с точностью.
	res := func(lo, hi float64) Range {
		switch in.AccuracyLevel {
		case AccuracyHigh:
			return Range{Min: round01(lo * 0.3 * 100), Max: round01(hi * 0.35 * 100)}
		case AccuracyMid:
			return Range{Min: round01(lo * 0.6 * 100), Max: round01(hi * 0.6 * 100)}
		}
		return Range{Min: round01(lo * 100), Max: round01(hi * 100)}
	}
	var out []TechRisk

	frame := fmt.Sprintf("Зданию %d лет: коррозия арматуры, трещины и прогибы перекрытий — частые находки обследования.", age)
	if b.YearBuilt < 1941 {
		frame = fmt.Sprintf("Довоенное здание, %d лет: возможны деревянные или смешанные перекрытия, их часто меняют целиком.", age)
	}
	out = append(out, TechRisk{Element: "Каркас и перекрытия", Note: frame, Reserve: res(0.05, 0.15)})

	facade := "Кровлю и фасады обычно ремонтируют целиком: протечки скрывают повреждения конструкций под ними."
	flo, fhi := 0.03, 0.08
	if b.IsOKN {
		facade = "Фасады — предмет охраны: реставрация по методике КГИОП дороже обычного ремонта."
		flo, fhi = 0.05, 0.12
	}
	out = append(out, TechRisk{Element: "Кровля и фасады", Note: facade, Reserve: res(flo, fhi)})

	out = append(out, TechRisk{Element: "Инженерные системы и сети",
		Note:    "Внутренние сети заменяются во всех сценариях; не входит в расчёт плата за техприсоединение, если мощности не хватит.",
		Reserve: res(0.04, 0.10)})

	if b.YearBuilt >= 1956 {
		out = append(out, TechRisk{Element: "Окна и теплоконтур",
			Note:    "Ленточное остекление и стеновые панели советского периода почти всегда требуют полной замены.",
			Reserve: res(0.02, 0.05)})
	}
	if b.OriginalFunction == "industrial" || b.OriginalFunction == "warehouse" {
		out = append(out, TechRisk{Element: "Загрязнение грунта и конструкций",
			Note:    "Производственное прошлое: до проектирования нужна экологическая экспертиза.",
			Reserve: res(0.01, 0.05)})
	}
	if in.AccuracyLevel == AccuracyHigh {
		for i := range out {
			out[i].Note += " Резерв уточнён по техобследованию."
		}
	}
	return out
}

func nextSteps(in EngineInput, sc []Scenario) []string {
	b := in.Building
	var s []string
	if in.AccuracyLevel != AccuracyHigh {
		s = append(s, "Заказать техническое обследование и загрузить заключение: точность вырастет до ≈85%, отчёт покажет четыре сценария, пересчёт бесплатный.")
	}
	s = append(s, "Получить выписку ЕГРН и ГПЗУ по участку — бесплатно в НСПД или на Госуслугах: они подтвердят границы участка и разрешённое использование.")

	if in.Zones == nil {
		s = append(s, "Проверить пересечения участка с зонами в РГИС Петербурга: для этого объекта их нет в базе.")
	} else {
		var titles []string
		for _, z := range in.Zones {
			if z.Effect == "restriction" && z.Code != "okn_territory" {
				titles = append(titles, lowerFirst(z.Title))
			}
		}
		if len(titles) > 0 {
			s = append(s, "Сверить режимы зон в РГИС Петербурга: "+strings.Join(titles, ", ")+".")
		}
	}
	if b.IsOKN || hasZone(in, "okn_zone_1", "okn_zone_2") != nil {
		s = append(s, "Запросить в КГИОП задание на проведение работ: без него проект не согласуют.")
	}
	if len(sc) > 0 {
		best := sc[0]
		if r := rules[best.FunctionCode]; !is(in, r.vriFrom...) {
			s = append(s, fmt.Sprintf("Подготовить заявление на ВРИ %s под сценарий «%s»: публичные слушания занимают несколько месяцев.", r.vriName, best.Title))
		}
	}
	s = append(s, "Обсудить рекомендуемый сценарий с инвестором или банком: отправьте им ссылку на этот отчёт.")
	return s
}

func capN(xs []string, n int) []string {
	if len(xs) > n {
		return xs[:n]
	}
	return xs
}
