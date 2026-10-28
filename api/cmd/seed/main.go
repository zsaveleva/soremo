// Command seed loads cities, buildings, packages and the dev admin into the database.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	"golang.org/x/crypto/bcrypt"

	"github.com/soremo/city/api/internal/config"
	"github.com/soremo/city/api/internal/engine"
	"github.com/soremo/city/api/internal/store"
)

type seedFeature struct {
	Geometry   json.RawMessage `json:"geometry"`
	Properties struct {
		OSMID             int64   `json:"osm_id"`
		Address           string  `json:"address"`
		Name              string  `json:"name"`
		YearBuilt         int32   `json:"year_built"`
		OriginalFunction  string  `json:"original_function"`
		Floors            int32   `json:"floors"`
		AreaTotal         float64 `json:"area_total_m2"`
		AreaSite          float64 `json:"area_site_m2"`
		AreaFootprint     float64 `json:"area_footprint_m2"`
		VRI               string  `json:"vri"`
		PZZZone           string  `json:"pzz_zone"`
		IsOKN             bool    `json:"is_okn"`
		LegalStatus       string  `json:"legal_status"`
		IsDemo            bool    `json:"is_demo"`
		DemoSlug          string  `json:"demo_slug"`
		MetroName         string  `json:"metro_name"`
		MetroDist         int32   `json:"metro_dist_m"`
		TransitIndex      int32   `json:"transit_index"`
		Social500         int32   `json:"social_500m"`
		CommercialDensity int32   `json:"commercial_density"`
		BusinessActivity  int32   `json:"business_activity"`
	} `json:"properties"`
}

// Цены пакетов, ₽ (ТЗ, раздел 7.5). nil — пакет «Все объекты».
var packages = []struct {
	limit  *int32
	months int32
	price  int64
}{
	{ptr(1), 1, 25_000},
	{ptr(5), 1, 90_000}, {ptr(5), 3, 120_000},
	{ptr(25), 1, 250_000}, {ptr(25), 3, 320_000}, {ptr(25), 6, 420_000},
	{ptr(100), 3, 700_000}, {ptr(100), 6, 900_000}, {ptr(100), 12, 1_200_000},
	{nil, 6, 1_800_000}, {nil, 12, 2_800_000},
}

func main() {
	cfg := config.Load()
	log := zerolog.New(zerolog.ConsoleWriter{Out: os.Stdout}).With().Timestamp().Logger()
	if err := run(context.Background(), cfg); err != nil {
		log.Fatal().Err(err).Msg("seed failed")
	}
	log.Info().Msg("seed complete")
}

func run(ctx context.Context, cfg config.Config) error {
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := store.Migrate(ctx, pool); err != nil {
		return err
	}

	raw, err := os.ReadFile(filepath.Join(cfg.SeedDir, "buildings.geojson"))
	if err != nil {
		return err
	}
	var fc struct {
		Features []seedFeature `json:"features"`
	}
	if err := json.Unmarshal(raw, &fc); err != nil {
		return fmt.Errorf("parse buildings.geojson: %w", err)
	}

	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		cityID, err := q.UpsertCity(ctx, store.UpsertCityParams{
			Slug: "spb", Name: "Санкт-Петербург",
			MinLon: 29.42, MinLat: 59.63, MaxLon: 30.76, MaxLat: 60.25,
		})
		if err != nil {
			return err
		}
		for _, f := range fc.Features {
			p := f.Properties
			id, err := q.UpsertSeedBuilding(ctx, store.UpsertSeedBuildingParams{
				CityID: cityID, OsmID: pgtype.Int8{Int64: p.OSMID, Valid: true},
				Address: p.Address, Name: pgtype.Text{String: p.Name, Valid: p.Name != ""},
				Geometry: string(f.Geometry), YearBuilt: p.YearBuilt, OriginalFunction: p.OriginalFunction,
				Floors: p.Floors, AreaTotalM2: p.AreaTotal, AreaSiteM2: p.AreaSite, AreaFootprintM2: p.AreaFootprint,
				Vri: p.VRI, PzzZone: p.PZZZone, IsOkn: p.IsOKN, LegalStatus: p.LegalStatus, IsDemo: p.IsDemo,
			})
			if err != nil {
				return fmt.Errorf("building osm %d: %w", p.OSMID, err)
			}
			if p.DemoSlug != "" {
				if err := q.SetDemoSlug(ctx, store.SetDemoSlugParams{ID: id, DemoSlug: pgtype.Text{String: p.DemoSlug, Valid: true}}); err != nil {
					return err
				}
			}
			if err := q.UpsertContextMetrics(ctx, store.UpsertContextMetricsParams{
				BuildingID: id, MetroName: p.MetroName, MetroDistM: p.MetroDist, TransitIndex: p.TransitIndex,
				Social500m: p.Social500, CommercialDensity: p.CommercialDensity, BusinessActivity: p.BusinessActivity,
			}); err != nil {
				return err
			}
		}
		if err := seedDemoReports(ctx, q, filepath.Join(cfg.SeedDir, "demo_reports")); err != nil {
			return err
		}
		for _, pk := range packages {
			lim := pgtype.Int4{}
			if pk.limit != nil {
				lim = pgtype.Int4{Int32: *pk.limit, Valid: true}
			}
			if err := q.UpsertPackage(ctx, store.UpsertPackageParams{ObjectsLimit: lim, Months: pk.months, PriceRub: pk.price}); err != nil {
				return err
			}
		}
		if cfg.IsDev() {
			hash, err := bcrypt.GenerateFromPassword([]byte("admin1234"), bcrypt.DefaultCost)
			if err != nil {
				return err
			}
			if err := q.UpsertAdmin(ctx, store.UpsertAdminParams{Email: "admin@soremo.local", PasswordHash: string(hash)}); err != nil {
				return err
			}
			// Пользователь для показа без регистрации: email подтверждён, пакет на 25 объектов на 6 месяцев.
			dh, err := bcrypt.GenerateFromPassword([]byte("demo1234"), bcrypt.DefaultCost)
			if err != nil {
				return err
			}
			uid, err := q.UpsertDemoUser(ctx, store.UpsertDemoUserParams{Email: "demo@soremo.local", PasswordHash: string(dh)})
			if err != nil {
				return err
			}
			if err := q.EnsureDemoAccess(ctx, uid); err != nil {
				return err
			}
		}
		return nil
	})
}

// seedDemoReports loads hand-written reports. Each file is validated against the
// engine contract so the demo renders exactly like a generated report.
func seedDemoReports(ctx context.Context, q *store.Queries, dir string) error {
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		return err
	}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			return err
		}
		var meta struct {
			BuildingSlug  string `json:"building_slug"`
			EngineVersion string `json:"engine_version"`
		}
		if err := json.Unmarshal(raw, &meta); err != nil {
			return fmt.Errorf("%s: %w", f, err)
		}
		dec := json.NewDecoder(bytes.NewReader(raw))
		var out struct {
			engine.EngineOutput
			BuildingSlug  string `json:"building_slug"`
			EngineVersion string `json:"engine_version"`
		}
		dec.DisallowUnknownFields()
		if err := dec.Decode(&out); err != nil {
			return fmt.Errorf("%s does not match the engine contract: %w", f, err)
		}
		if want := engine.ScenarioCount(out.AccuracyLevel); len(out.Scenarios) != want {
			return fmt.Errorf("%s: %s accuracy needs %d scenarios, got %d", f, out.AccuracyLevel, want, len(out.Scenarios))
		}
		id, err := q.GetBuildingIDByDemoSlug(ctx, pgtype.Text{String: meta.BuildingSlug, Valid: true})
		if err != nil {
			return fmt.Errorf("%s: building %q: %w", f, meta.BuildingSlug, err)
		}
		result, err := json.Marshal(out.EngineOutput)
		if err != nil {
			return err
		}
		if err := q.UpsertDemoReport(ctx, store.UpsertDemoReportParams{
			BuildingID: id, AccuracyLevel: string(out.AccuracyLevel), EngineVersion: meta.EngineVersion, Result: result,
		}); err != nil {
			return err
		}
	}
	return nil
}

func ptr(v int32) *int32 { return &v }
