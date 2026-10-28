// Package reports queues modelling runs, serves reports and renders PDFs.
package reports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/soremo/city/api/internal/buildings"
	"github.com/soremo/city/api/internal/engine"
	"github.com/soremo/city/api/internal/store"
)

var ErrNotFound = errors.New("report not found")

// View is the report as the frontend and the PDF template see it.
type View struct {
	ID            string               `json:"id"`
	Kind          string               `json:"kind"` // demo | user
	Status        string               `json:"status"`
	AccuracyLevel engine.AccuracyLevel `json:"accuracy_level"`
	EngineVersion string               `json:"engine_version"`
	CreatedAt     time.Time            `json:"created_at"`
	FinishedAt    *time.Time           `json:"finished_at"`
	// Refined — отчёт пересчитан после принятия документов (ТЗ 4.4).
	Refined  bool                 `json:"refined"`
	Building buildings.Card       `json:"building"`
	Result   *engine.EngineOutput `json:"result"`
}

type Demo struct {
	q         *store.Queries
	buildings *buildings.Service
}

func NewDemo(q *store.Queries, b *buildings.Service) *Demo { return &Demo{q: q, buildings: b} }

func (d *Demo) Get(ctx context.Context, buildingID int64) (View, error) {
	r, err := d.q.GetDemoReport(ctx, buildingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return View{}, ErrNotFound
	}
	if err != nil {
		return View{}, err
	}
	card, err := d.buildings.Get(ctx, buildingID)
	if err != nil {
		return View{}, err
	}
	var out engine.EngineOutput
	if err := json.Unmarshal(r.Result, &out); err != nil {
		return View{}, err
	}
	// Демо-отчёт показывает свой уровень точности, а не уровень по документам базы.
	card.Accuracy.Level = out.AccuracyLevel
	t := r.UpdatedAt.Time
	return View{
		ID: fmt.Sprintf("demo-%d", buildingID), Kind: "demo", Status: "ready",
		AccuracyLevel: out.AccuracyLevel, EngineVersion: r.EngineVersion,
		CreatedAt: t, FinishedAt: &t, Refined: out.AccuracyLevel != engine.AccuracyLow,
		Building: card, Result: &out,
	}, nil
}
