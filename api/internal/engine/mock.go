package engine

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

// MockEngine stands in for the real assessment model. It scores a catalogue of
// renovation functions with simple rules on ten inputs (original function,
// area, floors, transit, commercial density, business activity, social
// infrastructure, heritage status, zone and documents) and derives TEP and
// economics from explicit per-function assumptions. Results are deterministic
// for a given building and accuracy level.
type MockEngine struct {
	// Delay returns the simulated run time; nil means 3–8 seconds by building id.
	Delay func(in EngineInput) time.Duration
}

func (MockEngine) Version() string { return "mock-1.0" }

func (m MockEngine) Run(ctx context.Context, in EngineInput) (EngineOutput, error) {
	d := m.delay(in)
	select {
	case <-ctx.Done():
		return EngineOutput{}, ctx.Err()
	case <-time.After(d):
	}
	return Assess(in), nil
}

func (m MockEngine) delay(in EngineInput) time.Duration {
	if m.Delay != nil {
		return m.Delay(in)
	}
	return time.Duration(3000+int(unit(in.Building.ID, "delay")*5000)) * time.Millisecond
}

// profile is one renovation function with its scoring rule and assumptions.
type profile struct {
	code, title  string
	scale        Scale
	description  string
	score        func(in EngineInput) float64
	capexPerM2   float64 // ₽ на м² общей площади после реновации
	rent         float64 // ₽ за м² арендопригодной площади в месяц
	occupancy    float64
	noi          float64 // доля чистого дохода в выручке
	termMonths   float64
	rentable     float64 // доля арендопригодной площади
	areaChange   float64 // изменение общей площади (надстройка, антресоли)
	addsFloor    bool
	parkingPer1k float64 // машино-мест на 1 000 м² арендопригодной площади
	zoning       []ZoneShare
	risks        []string
}

func z(pairs ...any) []ZoneShare {
	out := make([]ZoneShare, 0, len(pairs)/2)
	for i := 0; i < len(pairs); i += 2 {
		out = append(out, ZoneShare{Function: pairs[i].(string), Share: pairs[i+1].(float64)})
	}
	return out
}

func is(in EngineInput, fns ...string) bool {
	for _, f := range fns {
		if in.Building.OriginalFunction == f {
			return true
		}
	}
	return false
}

func industrialZone(in EngineInput) bool { return strings.HasPrefix(in.Building.PZZZone, "ТП") }

func between(v, lo, hi float64) float64 {
	if v >= lo && v <= hi {
		return 1
	}
	return 0
}

var catalogue = []profile{
	{
		code: "creative_cluster", title: "Креативный кластер с коворкингом", scale: ScaleCity,
		description: "Этажи делятся на мастерские, студии и офисы от 30 до 400 м², первый этаж открывается на улицу кафе и шоурумами. Высокие потолки и крупный шаг колонн сохраняются как часть образа.",
		score: func(in EngineInput) float64 {
			c := in.Context
			return 0.35*float64(c.TransitIndex) + 0.3*float64(c.CommercialDensity) + 0.15*float64(c.BusinessActivity) +
				15*b2f(is(in, "industrial", "research", "warehouse")) + 10*between(in.Building.AreaTotalM2, 3000, 30000)
		},
		capexPerM2: 98000, rent: 1900, occupancy: 0.86, noi: 0.66, termMonths: 30, rentable: 0.74, areaChange: 0.06,
		parkingPer1k: 4,
		zoning:       z("Мастерские и студии", 0.30, "Офисы и коворкинг", 0.28, "Шоурумы и магазины", 0.14, "Кафе и общепит", 0.10, "Общие зоны", 0.18),
		risks: []string{
			"Заполнение креативными арендаторами занимает 2–3 года; первые годы выручка ниже расчётной.",
			"Ставка выше районной снизит заполнение: креативные арендаторы чувствительны к цене.",
			"Без собственной программы событий кластер конкурирует только ценой.",
		},
	},
	{
		code: "light_industrial", title: "Light industrial + шоурумы", scale: ScaleLocal,
		description: "Здание сохраняет производственную функцию: чистое мелкое производство и мастерские на этажах, шоурумы и пункты выдачи на первом. Перепланировка минимальная, основная статья — инженерия и грузовые лифты.",
		score: func(in EngineInput) float64 {
			c := in.Context
			return 40*b2f(is(in, "industrial", "warehouse")) + 0.25*float64(100-c.TransitIndex) + 15*b2f(industrialZone(in)) +
				0.1*float64(c.CommercialDensity) + 10*between(in.Building.AreaTotalM2, 1500, 40000)
		},
		capexPerM2: 64000, rent: 1250, occupancy: 0.9, noi: 0.72, termMonths: 16, rentable: 0.82, areaChange: 0,
		parkingPer1k: 3,
		zoning:       z("Производство и мастерские", 0.50, "Шоурумы", 0.18, "Склад", 0.17, "Офисы", 0.10, "Общие зоны", 0.05),
		risks: []string{
			"Ставка light industrial растёт медленнее офисной: рост выше рынка не закладывается.",
			"Грузовой транспорт ограничен соседней застройкой и графиком заезда.",
			"Функция почти не повышает стоимость объекта при продаже.",
		},
	},
	{
		code: "warehouse_office", title: "Склад с офисами и пунктом выдачи", scale: ScaleLocal,
		description: "Нижний этаж — склад малых форматов от 50 м² и пункты выдачи интернет-заказов, верхние — офисы арендаторов склада. Подходит зданиям с подъездом для грузового транспорта.",
		score: func(in EngineInput) float64 {
			c := in.Context
			return 45*b2f(is(in, "warehouse")) + 20*b2f(is(in, "industrial")) + 0.35*float64(100-c.TransitIndex) +
				12*b2f(industrialZone(in)) - 0.15*float64(c.CommercialDensity) + 8*b2f(in.Building.Floors <= 2)
		},
		capexPerM2: 60000, rent: 950, occupancy: 0.93, noi: 0.75, termMonths: 12, rentable: 0.86, areaChange: 0,
		parkingPer1k: 2,
		zoning:       z("Склад малых форматов", 0.55, "Пункты выдачи", 0.12, "Офисы", 0.18, "Погрузочные зоны", 0.10, "Общие зоны", 0.05),
		risks: []string{
			"Рынок складов малых форматов насыщается: ставки ниже 900 ₽/м² возможны уже через 2 года.",
			"Нужна площадка для разворота грузовиков — её размер зависит от границ участка.",
			"Высокая нагрузка на перекрытия ограничивает склад верхних этажей.",
		},
	},
	{
		code: "business_center", title: "Деловой центр класса B", scale: ScaleCity,
		description: "Офисы от 50 до 1 500 м² с общими переговорными и конференц-залом, кафе на первом этаже. Требует полной замены инженерных систем под офисную нагрузку.",
		score: func(in EngineInput) float64 {
			c := in.Context
			return 0.45*float64(c.BusinessActivity) + 0.4*float64(c.TransitIndex) + 25*b2f(is(in, "administrative", "research")) +
				10*b2f(in.Building.Floors >= 4) - 10*b2f(industrialZone(in))
		},
		capexPerM2: 120000, rent: 2100, occupancy: 0.82, noi: 0.62, termMonths: 36, rentable: 0.72, areaChange: 0.03,
		parkingPer1k: 8,
		zoning:       z("Офисы", 0.62, "Конференц-зал и переговорные", 0.10, "Кафе и общепит", 0.06, "Общие и технические зоны", 0.22),
		risks: []string{
			"Офисный спрос вне центра чувствителен к ставке: заполнение 82% требует цены на уровне района.",
			"Замена инженерных систем — самая неопределённая статья бюджета.",
			"Новые бизнес-центры рядом удлиняют заполнение на 6–12 месяцев.",
		},
	},
	{
		code: "aparthotel", title: "Апарт-отель с сервисными офисами", scale: ScaleCity,
		description: "Верхние этажи и надстройка — апартаменты от 22 до 45 м² для командированных и туристов, нижние — сервисные офисы и ресторан. Требуется изменение вида разрешённого использования.",
		score: func(in EngineInput) float64 {
			c := in.Context
			if in.Building.IsOKN || industrialZone(in) {
				return -100 // надстройка и смена функции в ОКН и промзоне не рассматриваются
			}
			return 0.5*float64(c.TransitIndex) + 0.3*float64(c.CommercialDensity) + 0.1*float64(c.Social500m) +
				10*between(in.Building.AreaTotalM2, 3000, 20000)
		},
		capexPerM2: 150000, rent: 2600, occupancy: 0.76, noi: 0.55, termMonths: 36, rentable: 0.66, areaChange: 0.12, addsFloor: true,
		parkingPer1k: 6,
		zoning:       z("Апартаменты", 0.58, "Сервисные офисы", 0.16, "Ресторан и лобби", 0.10, "Общие и технические зоны", 0.16),
		risks: []string{
			"Смена ВРИ и надстройка удлиняют подготовку на 9–12 месяцев и могут не согласоваться.",
			"Заполняемость апарт-отелей в Петербурге сезонна: зимой падает до 55–60%.",
			"Самые высокие капвложения на метр среди сценариев.",
		},
	},
	{
		code: "culture_center", title: "Культурно-общественный центр", scale: ScaleCity,
		description: "Залы и фойе работают как площадка для концертов, лекций и выставок, вокруг — образовательные студии, коворкинг и общепит. Коммерческая часть покрывает часть операционных расходов.",
		score: func(in EngineInput) float64 {
			c := in.Context
			return 50*b2f(is(in, "culture")) + 0.35*float64(c.TransitIndex) + 0.4*float64(c.Social500m) + 10*b2f(in.Building.IsOKN)
		},
		capexPerM2: 95000, rent: 1650, occupancy: 0.85, noi: 0.56, termMonths: 42, rentable: 0.62, areaChange: 0.01,
		parkingPer1k: 2,
		zoning:       z("Залы и событийные пространства", 0.28, "Образовательные студии", 0.22, "Коворкинг и офисы", 0.18, "Кафе и общепит", 0.08, "Общие и технические зоны", 0.24),
		risks: []string{
			"Окупаемость длинная: сценарий реалистичен при участии города или операторском договоре.",
			"Выручка от событий зависит от программы и сезона, колебания по годам до 25%.",
			"Реставрация зала и сценического оборудования — наименее предсказуемая статья.",
		},
	},
	{
		code: "community_center", title: "Районный общественный центр: спорт, образование, услуги", scale: ScaleLocal,
		description: "Спортивные залы, кружки и курсы для детей и взрослых, услуги и магазины повседневного спроса на первом этаже. Арендаторы — районные операторы и городские программы.",
		score: func(in EngineInput) float64 {
			c := in.Context
			return 1.4*float64(c.Social500m) + 25*b2f(is(in, "culture", "sport")) + 0.15*float64(c.TransitIndex) -
				20*b2f(industrialZone(in)) + 8*between(in.Building.AreaTotalM2, 1500, 25000)
		},
		capexPerM2: 72000, rent: 1250, occupancy: 0.92, noi: 0.64, termMonths: 26, rentable: 0.76, areaChange: 0,
		parkingPer1k: 3,
		zoning:       z("Спорт", 0.30, "Образование и кружки", 0.26, "Услуги и магазины", 0.16, "Зал", 0.10, "Общие и технические зоны", 0.18),
		risks: []string{
			"Ставки для социальных арендаторов ниже рыночных; выручка зависит от городских программ.",
			"Спортивные залы требуют высоты от 6 м — подходят не все этажи.",
			"Район должен обеспечить спрос: при оттоке жителей заполнение падает первым.",
		},
	},
	{
		code: "campus", title: "Образовательный кампус", scale: ScaleCity,
		description: "Здание целиком сдаётся образовательному оператору — колледжу, частному вузу или школе — на 10–15 лет. Аудитории занимают существующие помещения почти без перепланировки.",
		score: func(in EngineInput) float64 {
			c := in.Context
			return 30*b2f(is(in, "research", "administrative", "culture")) + 0.3*float64(c.TransitIndex) + 0.5*float64(c.Social500m) +
				12*b2f(in.Building.AreaTotalM2 >= 6000) - 15*b2f(industrialZone(in))
		},
		capexPerM2: 74000, rent: 1150, occupancy: 0.97, noi: 0.8, termMonths: 24, rentable: 0.75, areaChange: 0,
		parkingPer1k: 3,
		zoning:       z("Аудитории и мастерские", 0.48, "Залы и конференц-зоны", 0.14, "Библиотека и коворкинг", 0.12, "Столовая", 0.06, "Общие и технические зоны", 0.20),
		risks: []string{
			"Вся выручка держится на одном договоре: при выходе арендатора здание простаивает.",
			"Образовательная лицензия ограничивает перепланировку санитарными нормами.",
			"Ставка ниже рыночной для офисов и фиксируется на срок договора.",
		},
	},
	{
		code: "retail_services", title: "Торгово-сервисный центр районного значения", scale: ScaleLocal,
		description: "Магазины, сервисы и общепит повседневного спроса на нижних этажах, офисы и медицинские кабинеты — на верхних. Якорный арендатор — продуктовый супермаркет.",
		score: func(in EngineInput) float64 {
			c := in.Context
			return 35*b2f(is(in, "retail")) + 0.35*float64(c.CommercialDensity) + 0.6*float64(c.Social500m) +
				0.2*float64(c.TransitIndex) - 15*b2f(industrialZone(in))
		},
		capexPerM2: 82000, rent: 1700, occupancy: 0.88, noi: 0.64, termMonths: 20, rentable: 0.78, areaChange: 0,
		parkingPer1k: 10,
		zoning:       z("Магазины и сервисы", 0.46, "Супермаркет", 0.18, "Медицина и офисы", 0.14, "Кафе", 0.07, "Общие и технические зоны", 0.15),
		risks: []string{
			"Онлайн-торговля снижает спрос на непродовольственную розницу: якорь должен быть продуктовым.",
			"Парковка — обязательное условие арендаторов, участок может её не вместить.",
			"Конкуренция с торговыми центрами района за тех же арендаторов.",
		},
	},
	{
		code: "sport_center", title: "Спортивный комплекс", scale: ScaleLocal,
		description: "Игровые залы, фитнес и секции для детей, при возможности — бассейн. Высокие пролёты и свободная планировка используются без дробления на мелкие помещения.",
		score: func(in EngineInput) float64 {
			c := in.Context
			return 45*b2f(is(in, "sport")) + 15*b2f(is(in, "industrial", "warehouse") && in.Building.Floors <= 2) +
				0.9*float64(c.Social500m) + 0.15*float64(c.TransitIndex)
		},
		capexPerM2: 88000, rent: 1100, occupancy: 0.9, noi: 0.6, termMonths: 22, rentable: 0.8, areaChange: 0,
		parkingPer1k: 6,
		zoning:       z("Игровые залы", 0.40, "Фитнес и секции", 0.30, "Раздевалки и душевые", 0.12, "Кафе", 0.04, "Общие и технические зоны", 0.14),
		risks: []string{
			"Бассейн в существующих конструкциях может оказаться невозможным.",
			"Выручка сезонна: летом посещаемость падает на 30–40%.",
			"Спортивные операторы просят арендные каникулы на время запуска.",
		},
	},
}

// Assess runs the rules without the simulated delay.
func Assess(in EngineInput) EngineOutput {
	type cand struct {
		p     profile
		score float64
	}
	cs := make([]cand, 0, len(catalogue))
	for _, p := range catalogue {
		// Небольшой детерминированный разброс, чтобы похожие здания не получали одинаковый порядок.
		jitter := (unit(in.Building.ID, p.code) - 0.5) * 6
		cs = append(cs, cand{p, p.score(in) + jitter})
	}
	sort.SliceStable(cs, func(i, j int) bool { return cs[i].score > cs[j].score })

	n := ScenarioCount(in.AccuracyLevel)
	out := EngineOutput{AccuracyLevel: in.AccuracyLevel, Methodology: Methodology, Warnings: []string{}}
	for _, c := range cs[:n] {
		out.Scenarios = append(out.Scenarios, build(in, c.p))
	}
	out.Summary = summary(in, out.Scenarios)
	if in.Building.IsOKN {
		out.Warnings = append(out.Warnings, "Здание — объект культурного наследия. Работы на фасадах и в предмете охраны требуют задания и согласования КГИОП; сроки и капвложения в отчёте это учитывают.")
	}
	switch in.AccuracyLevel {
	case AccuracyLow:
		out.Warnings = append(out.Warnings, "Низкая точность: техническое состояние здания не известно, капвложения оценены по аналогам. Загрузите техническое обследование, чтобы получить четыре сценария и точечные значения.")
	case AccuracyMid:
		out.Warnings = append(out.Warnings, "Средняя точность: принят документ общего характера. Техническое обследование сузит диапазоны и может изменить порядок сценариев.")
	}
	return out
}

func build(in EngineInput, p profile) Scenario {
	b := in.Building
	id := b.ID
	okn := b.IsOKN

	// Поправки к допущениям профиля: возраст здания, ОКН, масштаб.
	capex := p.capexPerM2 * (1 + 0.004*float64(max(0, 1960-b.YearBuilt))) * (0.94 + 0.12*unit(id, p.code+"capex"))
	term := p.termMonths
	if okn {
		capex *= 1.25
		term *= 1.4
	}
	if b.AreaTotalM2 > 20000 {
		capex *= 0.95 // эффект масштаба
		term *= 1.15
	}
	rent := p.rent * (0.85 + 0.003*float64(in.Context.TransitIndex)) * (0.95 + 0.1*unit(id, p.code+"rent"))
	areaChange := p.areaChange
	addsFloor := p.addsFloor && !okn
	if okn {
		areaChange = math.Min(areaChange, 0.01)
	}

	after := TEPValues{
		AreaTotalM2: round10(b.AreaTotalM2 * (1 + areaChange)),
		Floors:      b.Floors + b2i(addsFloor),
	}
	after.AreaRentableM2 = round10(after.AreaTotalM2 * p.rentable)
	after.Parking = int(math.Round(after.AreaRentableM2 / 1000 * p.parkingPer1k))
	before := TEPValues{
		AreaTotalM2:    round10(b.AreaTotalM2),
		AreaRentableM2: round10(b.AreaTotalM2 * 0.35 * unit(id, "occupied")),
		Floors:         b.Floors,
	}

	capexTotal := after.AreaTotalM2 * capex
	revenue := after.AreaRentableM2 * rent * 12 * p.occupancy
	payback := capexTotal / (revenue * p.noi)

	risks := append([]string{}, p.risks...)
	desc := p.description
	if okn {
		desc += " Фасады и предмет охраны сохраняются, новые элементы — только внутри здания."
		risks[len(risks)-1] = "Согласование работ в объекте культурного наследия с КГИОП удлиняет подготовку на 6–12 месяцев."
	}
	if in.AccuracyLevel == AccuracyLow {
		risks[0] = "Техническое состояние неизвестно: капвложения могут отличаться от расчёта на четверть в обе стороны."
	}

	return Scenario{
		Title: p.title, FunctionCode: p.code, Scale: p.scale, Description: desc,
		TEP:    TEP{Before: before, After: after},
		Zoning: p.zoning,
		Economics: Economics{
			CapexRub:       spread(capexTotal, in.AccuracyLevel, roundRub),
			TermMonths:     spread(term, in.AccuracyLevel, round3),
			RevenueYearRub: spread(revenue, in.AccuracyLevel, roundRub),
			PaybackYears:   spread(payback, in.AccuracyLevel, round01),
		},
		Risks: risks,
		Assumptions: &Assumptions{
			CapexPerM2Rub: math.Round(capex/1000) * 1000, RentRubM2Month: math.Round(rent/10) * 10,
			Occupancy: p.occupancy, NOIShare: p.noi,
		},
	}
}

// spread widens a point estimate into a range that narrows as accuracy grows.
func spread(v float64, l AccuracyLevel, round func(float64) float64) Range {
	lo, hi := 1.0, 1.0
	switch l {
	case AccuracyLow:
		lo, hi = 0.8, 1.25
	case AccuracyMid:
		lo, hi = 0.9, 1.12
	}
	return Range{Min: round(v * lo), Max: round(v * hi)}
}

var functionNames = map[string]string{
	"industrial": "производственного корпуса", "warehouse": "склада", "culture": "дома культуры",
	"administrative": "административного здания", "research": "здания НИИ", "retail": "торгового здания",
	"sport": "спортивного здания", "other": "здания",
}

func summary(in EngineInput, sc []Scenario) string {
	c := in.Context
	best, second := sc[0], sc[1]
	var why []string
	switch {
	case c.MetroDistM <= 600:
		why = append(why, fmt.Sprintf("здание в %d м от станции «%s»", round50(c.MetroDistM), c.MetroName))
	case c.TransitIndex < 35:
		why = append(why, "метро далеко, и функции не нужен поток посетителей")
	}
	if c.CommercialDensity >= 60 {
		why = append(why, "вокруг плотная торговля и общепит")
	} else if c.CommercialDensity < 20 {
		why = append(why, "торговли рядом почти нет")
	}
	if c.BusinessActivity >= 50 {
		why = append(why, "в районе много офисов")
	}
	if c.Social500m >= 20 {
		why = append(why, fmt.Sprintf("в 500 м — %d социальных объектов", c.Social500m))
	}
	if len(why) == 0 {
		why = append(why, "планировка "+functionNames[in.Building.OriginalFunction]+" подходит этой функции без крупной перестройки")
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Рекомендуемый сценарий — %s: %s. ", lowerFirst(best.Title), strings.Join(why, ", "))
	fmt.Fprintf(&b, "Капвложения %s, простая окупаемость %s. ", rubRange(best.Economics.CapexRub), yearsRange(best.Economics.PaybackYears))
	if second.Economics.PaybackYears.Min < best.Economics.PaybackYears.Min {
		fmt.Fprintf(&b, "Сценарий «%s» окупается быстрее, но слабее использует положение здания. ", second.Title)
	} else {
		fmt.Fprintf(&b, "Второй по оценке сценарий — «%s»: окупаемость %s. ", second.Title, yearsRange(second.Economics.PaybackYears))
	}
	if in.Building.IsOKN {
		b.WriteString("Статус объекта культурного наследия удлиняет сроки и исключает надстройку. ")
	}
	switch in.AccuracyLevel {
	case AccuracyLow:
		b.WriteString("Без технического обследования расчёт приблизительный, порядок сценариев может измениться.")
	case AccuracyMid:
		b.WriteString("Техническое обследование сузит диапазоны капвложений.")
	default:
		b.WriteString("Расчёт учитывает принятое техническое обследование.")
	}
	return strings.TrimSpace(b.String())
}

const Methodology = "Модель оценивает 137 характеристик здания и его окружения, сгруппированных в восемь блоков: " +
	"конструкция и объёмно-планировочные решения, техническое состояние, участок и градостроительные ограничения, " +
	"правовой режим и охранные обязательства, транспорт, социальная инфраструктура, коммерческое окружение, " +
	"рыночные ставки по функциям. Исходные данные — OpenStreetMap, Правила землепользования и застройки " +
	"Санкт-Петербурга, перечень объектов культурного наследия, открытые данные о ставках аренды и стоимости " +
	"строительства, а также документы, загруженные пользователем и принятые после проверки. Экономика — " +
	"укрупнённая оценка в ценах 2026 года без НДС; срок окупаемости простой, без дисконтирования."

// ---- helpers ----

func unit(id int64, key string) float64 {
	b := make([]byte, 8)
	binary.LittleEndian.PutUint64(b, uint64(id))
	h := sha256.Sum256(append(b, key...))
	return float64(binary.LittleEndian.Uint64(h[:8])>>11) / float64(1<<53)
}

func b2f(v bool) float64 {
	if v {
		return 1
	}
	return 0
}

func b2i(v bool) int {
	if v {
		return 1
	}
	return 0
}

func round10(v float64) float64 { return math.Round(v/10) * 10 }
func round3(v float64) float64  { return math.Max(3, math.Round(v/3)*3) }
func round01(v float64) float64 { return math.Round(v*10) / 10 }
func round50(v int) int         { return int(math.Round(float64(v)/50) * 50) }

func roundRub(v float64) float64 {
	switch {
	case v >= 1e9:
		return math.Round(v/1e7) * 1e7
	case v >= 1e8:
		return math.Round(v/1e6) * 1e6
	}
	return math.Round(v/1e5) * 1e5
}

func lowerFirst(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return s
	}
	// «Light industrial» остаётся с заглавной: это термин.
	if r[0] >= 'A' && r[0] <= 'Z' {
		return s
	}
	return strings.ToLower(string(r[0])) + string(r[1:])
}

func rubRange(r Range) string {
	scale, unitName := 1e6, "млн"
	if r.Max >= 1e9 {
		scale, unitName = 1e9, "млрд"
	}
	f := func(v float64) string {
		v /= scale
		if v >= 100 {
			return fmt.Sprintf("%.0f", v)
		}
		return strings.Replace(fmt.Sprintf("%.1f", v), ".", ",", 1)
	}
	if r.Min == r.Max {
		return "≈" + f(r.Max) + " " + unitName + " ₽"
	}
	return f(r.Min) + "–" + f(r.Max) + " " + unitName + " ₽"
}

func yearsRange(r Range) string {
	f := func(v float64) string { return strings.Replace(fmt.Sprintf("%.1f", v), ".", ",", 1) }
	if r.Min == r.Max {
		return "≈" + f(r.Max) + " года"
	}
	return f(r.Min) + "–" + f(r.Max) + " года"
}
