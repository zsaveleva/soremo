// Package engine defines the scenario engine contract (ТЗ 7.3).
//
// The real assessment algorithm is a trade secret and lives outside this
// repository. To plug it in, implement ScenarioEngine and pass it to the
// worker in cmd/api instead of MockEngine; Version() is stored with every
// report as engine_version.
package engine

import (
	"context"
	"time"
)

type ScenarioEngine interface {
	Run(ctx context.Context, in EngineInput) (EngineOutput, error)
	Version() string
}

type AccuracyLevel string

const (
	AccuracyLow  AccuracyLevel = "low"
	AccuracyMid  AccuracyLevel = "mid"
	AccuracyHigh AccuracyLevel = "high"
)

// AccuracyFor applies the rule from ТЗ 7.4 to the kinds of accepted documents.
func AccuracyFor(acceptedKinds []string) AccuracyLevel {
	level := AccuracyLow
	for _, k := range acceptedKinds {
		switch k {
		case "survey", "expertise":
			return AccuracyHigh
		case "other":
			level = AccuracyMid
		}
	}
	return level
}

// ScenarioCount is the number of scenarios a report has at each accuracy level.
func ScenarioCount(l AccuracyLevel) int {
	switch l {
	case AccuracyHigh:
		return 4
	case AccuracyMid:
		return 3
	}
	return 2
}

type Building struct {
	ID               int64   `json:"id"`
	Address          string  `json:"address"`
	YearBuilt        int     `json:"year_built"`
	OriginalFunction string  `json:"original_function"`
	Floors           int     `json:"floors"`
	AreaTotalM2      float64 `json:"area_total_m2"`
	AreaSiteM2       float64 `json:"area_site_m2"`
	AreaFootprintM2  float64 `json:"area_footprint_m2"`
	VRI              string  `json:"vri"`
	PZZZone          string  `json:"pzz_zone"`
	IsOKN            bool    `json:"is_okn"`
	// YearSource — откуда год постройки: osm, manual, generated (оценка) или user.
	YearSource string `json:"year_source,omitempty"`
	// Source — base (база сервиса) или user (добавлен пользователем).
	Source string `json:"source,omitempty"`
}

// Zone is a zone with special conditions intersecting the site (РГИС, НСПД).
type Zone struct {
	Code   string `json:"code"`
	Title  string `json:"title"`
	Effect string `json:"effect"` // restriction | check | info
	Note   string `json:"note"`
}

type Context struct {
	MetroName         string `json:"metro_name"`
	MetroDistM        int    `json:"metro_dist_m"`
	TransitIndex      int    `json:"transit_index"`
	Social500m        int    `json:"social_500m"`
	CommercialDensity int    `json:"commercial_density"`
	BusinessActivity  int    `json:"business_activity"`
}

// Document is metadata only: the engine never sees file contents.
type Document struct {
	Kind     string    `json:"kind"`
	IssuedOn time.Time `json:"issued_on"`
}

type EngineInput struct {
	Building      Building      `json:"building"`
	Context       Context       `json:"context"`
	Documents     []Document    `json:"documents"`
	AccuracyLevel AccuracyLevel `json:"accuracy_level"`
	// Zones — nil, если пересечения с зонами для объекта не проверены.
	Zones     []Zone `json:"zones"`
	ZonesDemo bool   `json:"zones_demo,omitempty"`
}

type EngineOutput struct {
	Summary       string        `json:"summary"`
	Scenarios     []Scenario    `json:"scenarios"`
	Methodology   string        `json:"methodology"`
	AccuracyLevel AccuracyLevel `json:"accuracy_level"`
	Warnings      []string      `json:"warnings"`
	// TechRisks — что в техническом состоянии может сдвинуть бюджет.
	TechRisks []TechRisk `json:"tech_risks,omitempty"`
	// NextSteps — что сделать собственнику после отчёта, по порядку.
	NextSteps []string `json:"next_steps,omitempty"`
}

// TechRisk is one building element whose condition may change the budget.
// Reserve is the percent of capex to keep for it, e.g. 5–15.
type TechRisk struct {
	Element string `json:"element"`
	Note    string `json:"note"`
	Reserve Range  `json:"reserve"`
}

type Feasibility string

const (
	Feasible   Feasibility = "feasible"   // реализуемо
	NeedsCheck Feasibility = "check"      // нужна проверка
	Restricted Feasibility = "restricted" // есть ограничение
)

// Check is one ground of the feasibility verdict.
type Check struct {
	Status Feasibility `json:"status"`
	Text   string      `json:"text"`
}

// FeasibilityVerdict — итог проверки реализуемости: худший из статусов оснований.
type FeasibilityVerdict struct {
	Status Feasibility `json:"status"`
	Checks []Check     `json:"checks"`
}

// Evidence lists which inputs behind a scenario are confirmed and which are missing.
type Evidence struct {
	Confirmed []string `json:"confirmed"`
	Missing   []string `json:"missing"`
}

type Scale string

const (
	ScaleLocal Scale = "local"
	ScaleCity  Scale = "city"
)

type Scenario struct {
	Title        string `json:"title"`
	FunctionCode string `json:"function_code"`
	Scale        Scale  `json:"scale"`
	// Description — one or two sentences on what the building becomes.
	// Not in the original contract; the report reads poorly without it.
	Description string      `json:"description"`
	TEP         TEP         `json:"tep"`
	Zoning      []ZoneShare `json:"zoning"`
	Economics   Economics   `json:"economics"`
	Risks       []string    `json:"risks"`
	// Assumptions behind Economics, shown under the numbers so they can be checked.
	Assumptions *Assumptions `json:"assumptions,omitempty"`

	Feasibility *FeasibilityVerdict `json:"feasibility,omitempty"`
	Pros        []string            `json:"pros,omitempty"`
	Cons        []string            `json:"cons,omitempty"`
	Evidence    *Evidence           `json:"evidence,omitempty"`
}

type Assumptions struct {
	CapexPerM2Rub  float64 `json:"capex_per_m2_rub"`
	RentRubM2Month float64 `json:"rent_rub_m2_month"`
	Occupancy      float64 `json:"occupancy"`
	NOIShare       float64 `json:"noi_share"`
}

type TEP struct {
	Before TEPValues `json:"before"`
	After  TEPValues `json:"after"`
}

type TEPValues struct {
	AreaTotalM2    float64 `json:"area_total_m2"`
	AreaRentableM2 float64 `json:"area_rentable_m2"`
	Floors         int     `json:"floors"`
	Parking        int     `json:"parking"`
}

type ZoneShare struct {
	Function string  `json:"function"`
	Share    float64 `json:"share"`
}

type Range struct {
	Min float64 `json:"min"`
	Max float64 `json:"max"`
}

type Economics struct {
	CapexRub       Range `json:"capex_rub"`
	TermMonths     Range `json:"term_months"`
	RevenueYearRub Range `json:"revenue_year_rub"`
	PaybackYears   Range `json:"payback_years"`
}
