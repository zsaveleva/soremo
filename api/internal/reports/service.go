package reports

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/soremo/city/api/internal/access"
	"github.com/soremo/city/api/internal/auth"
	"github.com/soremo/city/api/internal/buildings"
	"github.com/soremo/city/api/internal/engine"
	"github.com/soremo/city/api/internal/jobs"
	"github.com/soremo/city/api/internal/store"
)

const JobRun = "report.run"

var (
	ErrForbidden = errors.New("report belongs to another user")
	ErrNotReady  = errors.New("report is not ready")
)

// Share is an open link to a report for an investor or a bank.
type Share struct {
	Token    string    `json:"token"`
	SharedAt time.Time `json:"shared_at"`
}

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
	kinds := make([]string, 0, len(docs))
	engineDocs := make([]engine.Document, 0, len(docs))
	for _, d := range docs {
		kinds = append(kinds, d.Kind)
		engineDocs = append(engineDocs, engine.Document{Kind: d.Kind, IssuedOn: d.IssuedOn.Time})
	}
	in := InputFor(card, engineDocs, engine.AccuracyFor(kinds))
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

// InputFor builds the engine input from a building card. The same input is
// used to run the engine and to annotate demo and older reports.
func InputFor(card buildings.Card, docs []engine.Document, level engine.AccuracyLevel) engine.EngineInput {
	if docs == nil {
		docs = []engine.Document{}
	}
	return engine.EngineInput{
		Building: engine.Building{
			ID: card.ID, Address: card.Address, YearBuilt: int(card.YearBuilt), OriginalFunction: card.OriginalFunction,
			Floors: int(card.Floors), AreaTotalM2: card.AreaTotalM2, AreaSiteM2: card.AreaSiteM2,
			AreaFootprintM2: card.AreaFootprintM2, VRI: card.VRI, PZZZone: card.PZZZone, IsOKN: card.IsOKN,
			YearSource: card.YearSource, Source: card.Source,
		},
		Context: engine.Context{
			MetroName: card.Context.MetroName, MetroDistM: int(card.Context.MetroDistM), TransitIndex: int(card.Context.TransitIndex),
			Social500m: int(card.Context.Social500m), CommercialDensity: int(card.Context.CommercialDensity),
			BusinessActivity: int(card.Context.BusinessActivity),
		},
		Documents:     docs,
		AccuracyLevel: level,
		Zones:         card.EngineZones(),
		ZonesDemo:     card.Zones != nil && card.Zones.Demo,
	}
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
	v, err := s.view(ctx, r)
	if err != nil {
		return View{}, err
	}
	v.CanShare = r.UserID == p.UserID && r.Status == "ready"
	if r.UserID == p.UserID && r.ShareToken.Valid {
		v.Share = &Share{Token: r.ShareToken.String, SharedAt: r.SharedAt.Time}
	}
	return v, nil
}

// GetShared returns a report opened by its share link, without the owner's data.
func (s *Service) GetShared(ctx context.Context, token string) (View, error) {
	if len(token) < 16 {
		return View{}, ErrNotFound
	}
	r, err := s.q.GetReportByShareToken(ctx, pgtype.Text{String: token, Valid: true})
	if errors.Is(err, pgx.ErrNoRows) {
		return View{}, ErrNotFound
	}
	if err != nil {
		return View{}, err
	}
	if r.Status != "ready" {
		return View{}, ErrNotFound
	}
	v, err := s.view(ctx, r)
	if err != nil {
		return View{}, err
	}
	v.Kind = "shared"
	return v, nil
}

// Share opens the link to a ready report and returns it; an open link is reused.
func (s *Service) Share(ctx context.Context, id, user uuid.UUID) (Share, error) {
	r, err := s.owned(ctx, id, user)
	if err != nil {
		return Share{}, err
	}
	if r.Status != "ready" {
		return Share{}, ErrNotReady
	}
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return Share{}, err
	}
	row, err := s.q.ShareReport(ctx, store.ShareReportParams{ID: id, Token: pgtype.Text{String: base64.RawURLEncoding.EncodeToString(buf), Valid: true}})
	if err != nil {
		return Share{}, err
	}
	return Share{Token: row.ShareToken, SharedAt: row.SharedAt.Time}, nil
}

// Unshare closes the link: it stops opening at once.
func (s *Service) Unshare(ctx context.Context, id, user uuid.UUID) error {
	if _, err := s.owned(ctx, id, user); err != nil {
		return err
	}
	return s.q.UnshareReport(ctx, id)
}

func (s *Service) owned(ctx context.Context, id, user uuid.UUID) (store.Report, error) {
	r, err := s.q.GetReport(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return store.Report{}, ErrNotFound
	}
	if err != nil {
		return store.Report{}, err
	}
	if r.UserID != user {
		return store.Report{}, ErrForbidden
	}
	return r, nil
}

func (s *Service) view(ctx context.Context, r store.Report) (View, error) {
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
		// Отчёты прежних версий модели получают пояснения по тем же входным данным.
		var in engine.EngineInput
		if err := json.Unmarshal(r.InputSnapshot, &in); err != nil {
			return View{}, err
		}
		if in.Zones == nil {
			in.Zones = card.EngineZones()
			in.ZonesDemo = card.Zones != nil && card.Zones.Demo
		}
		engine.Annotate(in, &out)
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
