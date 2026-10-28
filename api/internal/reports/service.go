package reports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/soremo/city/api/internal/access"
	"github.com/soremo/city/api/internal/auth"
	"github.com/soremo/city/api/internal/buildings"
	"github.com/soremo/city/api/internal/engine"
	"github.com/soremo/city/api/internal/jobs"
	"github.com/soremo/city/api/internal/store"
)

const JobRun = "report.run"

var ErrForbidden = errors.New("report belongs to another user")

type Service struct {
	pool      *pgxpool.Pool
	q         *store.Queries
	engine    engine.ScenarioEngine
	buildings *buildings.Service
}

func NewService(pool *pgxpool.Pool, e engine.ScenarioEngine, b *buildings.Service) *Service {
	return &Service{pool: pool, q: store.New(pool), engine: e, buildings: b}
}

// Start queues a modelling run. The quota is charged in the same transaction
// as the report is created (ТЗ 8.4); a run already in progress is reused.
func (s *Service) Start(ctx context.Context, user uuid.UUID, buildingID int64) (uuid.UUID, error) {
	card, err := s.buildings.Get(ctx, buildingID)
	if err != nil {
		return uuid.Nil, err
	}
	if active, err := s.q.ActiveReportForBuilding(ctx, store.ActiveReportForBuildingParams{UserID: user, BuildingID: buildingID}); err == nil {
		return active, nil
	}
	docs, err := s.q.AcceptedDocuments(ctx, buildingID)
	if err != nil {
		return uuid.Nil, err
	}
	in := engine.EngineInput{
		Building: engine.Building{
			ID: card.ID, Address: card.Address, YearBuilt: int(card.YearBuilt), OriginalFunction: card.OriginalFunction,
			Floors: int(card.Floors), AreaTotalM2: card.AreaTotalM2, AreaSiteM2: card.AreaSiteM2,
			AreaFootprintM2: card.AreaFootprintM2, VRI: card.VRI, PZZZone: card.PZZZone, IsOKN: card.IsOKN,
		},
		Context: engine.Context{
			MetroName: card.Context.MetroName, MetroDistM: int(card.Context.MetroDistM), TransitIndex: int(card.Context.TransitIndex),
			Social500m: int(card.Context.Social500m), CommercialDensity: int(card.Context.CommercialDensity),
			BusinessActivity: int(card.Context.BusinessActivity),
		},
		Documents: []engine.Document{},
	}
	kinds := make([]string, 0, len(docs))
	for _, d := range docs {
		kinds = append(kinds, d.Kind)
		in.Documents = append(in.Documents, engine.Document{Kind: d.Kind, IssuedOn: d.IssuedOn.Time})
	}
	in.AccuracyLevel = engine.AccuracyFor(kinds)
	snapshot, err := json.Marshal(in)
	if err != nil {
		return uuid.Nil, err
	}

	var id uuid.UUID
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		accessID, err := access.Consume(ctx, q, user, buildingID)
		if err != nil {
			return err
		}
		r, err := q.CreateReport(ctx, store.CreateReportParams{
			BuildingID: buildingID, UserID: user, AccessID: uuid.NullUUID{UUID: accessID, Valid: true},
			AccuracyLevel: string(in.AccuracyLevel), EngineVersion: s.engine.Version(), InputSnapshot: snapshot,
		})
		if err != nil {
			return err
		}
		id = r.ID
		return jobs.Enqueue(ctx, q, JobRun, map[string]string{"report_id": r.ID.String()})
	})
	return id, err
}

// RunJob is the worker handler: it runs the engine on the stored input snapshot.
func (s *Service) RunJob(ctx context.Context, payload json.RawMessage) error {
	var p struct {
		ReportID uuid.UUID `json:"report_id"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	r, err := s.q.GetReport(ctx, p.ReportID)
	if err != nil {
		return err
	}
	if r.Status == "ready" {
		return nil
	}
	if err := s.q.SetReportRunning(ctx, r.ID); err != nil {
		return err
	}
	var in engine.EngineInput
	if err := json.Unmarshal(r.InputSnapshot, &in); err != nil {
		return err
	}
	out, err := s.engine.Run(ctx, in)
	if err != nil {
		_ = s.q.FailReport(ctx, r.ID)
		return fmt.Errorf("engine: %w", err)
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return err
	}
	return s.q.FinishReport(ctx, store.FinishReportParams{ID: r.ID, Result: raw})
}

// Get returns the report for its owner, an admin or a print token for this report.
func (s *Service) Get(ctx context.Context, id uuid.UUID, p auth.Principal) (View, error) {
	r, err := s.q.GetReport(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return View{}, ErrNotFound
	}
	if err != nil {
		return View{}, err
	}
	isPrint := p.Role == auth.RolePrint && p.ReportID == r.ID
	if r.UserID != p.UserID && !p.IsAdmin() && !isPrint {
		return View{}, ErrForbidden
	}
	card, err := s.buildings.Get(ctx, r.BuildingID)
	if err != nil {
		return View{}, err
	}
	v := View{
		ID: r.ID.String(), Kind: "user", Status: r.Status, AccuracyLevel: engine.AccuracyLevel(r.AccuracyLevel),
		EngineVersion: r.EngineVersion, CreatedAt: r.CreatedAt.Time,
		Refined: r.AccuracyLevel != string(engine.AccuracyLow), Building: card,
	}
	if r.FinishedAt.Valid {
		t := r.FinishedAt.Time
		v.FinishedAt = &t
	}
	if r.Status == "ready" && r.Result != nil {
		var out engine.EngineOutput
		if err := json.Unmarshal(r.Result, &out); err != nil {
			return View{}, err
		}
		v.Result = &out
	}
	return v, nil
}

type MyReport struct {
	ID               uuid.UUID  `json:"id"`
	BuildingID       int64      `json:"building_id"`
	Address          string     `json:"address"`
	Name             *string    `json:"name"`
	OriginalFunction string     `json:"original_function"`
	YearBuilt        int32      `json:"year_built"`
	Status           string     `json:"status"`
	AccuracyLevel    string     `json:"accuracy_level"`
	CreatedAt        time.Time  `json:"created_at"`
	FinishedAt       *time.Time `json:"finished_at"`
	Versions         int32      `json:"versions"`
}

func (s *Service) Mine(ctx context.Context, user uuid.UUID) ([]MyReport, error) {
	rows, err := s.q.ListMyReports(ctx, user)
	if err != nil {
		return nil, err
	}
	out := make([]MyReport, 0, len(rows))
	for _, r := range rows {
		m := MyReport{ID: r.ID, BuildingID: r.BuildingID, Address: r.Address, OriginalFunction: r.OriginalFunction,
			YearBuilt: r.YearBuilt, Status: r.Status, AccuracyLevel: r.AccuracyLevel, CreatedAt: r.CreatedAt.Time, Versions: r.Versions}
		if r.Name.Valid {
			m.Name = &r.Name.String
		}
		if r.FinishedAt.Valid {
			t := r.FinishedAt.Time
			m.FinishedAt = &t
		}
		out = append(out, m)
	}
	return out, nil
}

// LatestFor returns the newest report id of the user for a building, if any.
func (s *Service) LatestFor(ctx context.Context, user uuid.UUID, buildingID int64) *string {
	r, err := s.q.LatestReportForBuilding(ctx, store.LatestReportForBuildingParams{UserID: user, BuildingID: buildingID})
	if err != nil {
		return nil
	}
	id := r.ID.String()
	return &id
}
