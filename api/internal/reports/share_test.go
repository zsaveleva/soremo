package reports

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/soremo/city/api/internal/auth"
	"github.com/soremo/city/api/internal/buildings"
	"github.com/soremo/city/api/internal/engine"
	"github.com/soremo/city/api/internal/store"
	"github.com/soremo/city/api/internal/testdb"
)

func mustExec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

// setupReport creates a building with zones, an owner and a ready report whose
// result has no explanations, as reports of engine mock-1.0 had.
func setupReport(t *testing.T, status string) (*Service, uuid.UUID, uuid.UUID) {
	t.Helper()
	pool := testdb.New(t)
	ctx := context.Background()
	mustExec(t, pool, `INSERT INTO cities (slug, name, bbox) VALUES ('spb', 'СПб', ST_MakeEnvelope(29, 59, 31, 61, 4326))`)
	mustExec(t, pool, `INSERT INTO buildings (city_id, address, geom, centroid, year_built, original_function, floors,
		area_total_m2, area_site_m2, area_footprint_m2, vri, pzz_zone, legal_status, year_source, zones, zones_source, zones_checked_on, zones_demo)
		VALUES (1, 'Тестовая ул., 1', ST_MakeEnvelope(30, 59.9, 30.001, 59.901, 4326),
		ST_SetSRID(ST_MakePoint(30.0005, 59.9005), 4326), 1960, 'industrial', 2, 6000, 9000, 3000,
		'Производственная деятельность (6.0)', 'ТП1', 'x', 'generated',
		'[{"code":"szz","title":"Санитарно-защитная зона предприятия","effect":"restriction","note":"x"}]',
		'РГИС Санкт-Петербурга', '2026-11-23', true)`)
	mustExec(t, pool, `INSERT INTO context_metrics (building_id, metro_name, metro_dist_m, transit_index, social_500m,
		commercial_density, business_activity) VALUES (1, 'Нарвская', 2500, 20, 2, 10, 5)`)

	var owner, other uuid.UUID
	for i, id := range []*uuid.UUID{&owner, &other} {
		if err := pool.QueryRow(ctx, `INSERT INTO users (email, password_hash, type, segment, email_verified_at)
			VALUES ($1, 'x', 'company', 'investor', now()) RETURNING id`, []string{"a@b.ru", "c@d.ru"}[i]).Scan(id); err != nil {
			t.Fatal(err)
		}
	}

	bsvc := buildings.NewService(store.New(pool))
	card, err := bsvc.Get(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	in := InputFor(card, nil, engine.AccuracyLow)
	in.Zones = nil // снимок старой версии: зон в нём не было
	out := engine.Assess(in)
	for i := range out.Scenarios {
		out.Scenarios[i].Feasibility, out.Scenarios[i].Pros, out.Scenarios[i].Cons, out.Scenarios[i].Evidence = nil, nil, nil, nil
	}
	out.TechRisks, out.NextSteps = nil, nil
	snap, _ := json.Marshal(in)
	res, _ := json.Marshal(out)

	var id uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO reports (building_id, user_id, accuracy_level, engine_version, input_snapshot, result, status)
		VALUES (1, $1, 'low', 'mock-1.0', $2, $3, $4) RETURNING id`, owner, snap, res, status).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return NewService(pool, engine.MockEngine{}, bsvc), id, owner
}

func TestShareLinkOpensAndCloses(t *testing.T) {
	svc, id, owner := setupReport(t, "ready")
	ctx := context.Background()

	sh, err := svc.Share(ctx, id, owner)
	if err != nil {
		t.Fatal(err)
	}
	if len(sh.Token) < 20 {
		t.Fatalf("короткий токен: %q", sh.Token)
	}
	again, err := svc.Share(ctx, id, owner)
	if err != nil || again.Token != sh.Token {
		t.Fatalf("повторное «Поделиться» должно вернуть ту же ссылку: %v %q", err, again.Token)
	}

	v, err := svc.GetShared(ctx, sh.Token)
	if err != nil {
		t.Fatal(err)
	}
	if v.Kind != "shared" || v.Share != nil || v.CanShare || v.Building.MyReportID != nil {
		t.Fatalf("по ссылке не должно быть данных владельца: kind=%s share=%v", v.Kind, v.Share)
	}

	mine, err := svc.Get(ctx, id, auth.Principal{UserID: owner})
	if err != nil || mine.Share == nil || mine.Share.Token != sh.Token || !mine.CanShare {
		t.Fatalf("владелец должен видеть открытую ссылку: %v %+v", err, mine.Share)
	}

	if err := svc.Unshare(ctx, id, owner); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.GetShared(ctx, sh.Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("закрытая ссылка должна перестать открываться, получено %v", err)
	}
	if _, err := svc.GetShared(ctx, "short"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("короткий токен: %v", err)
	}
}

func TestOnlyOwnerSharesReadyReport(t *testing.T) {
	svc, id, _ := setupReport(t, "ready")
	if _, err := svc.Share(context.Background(), id, uuid.New()); !errors.Is(err, ErrForbidden) {
		t.Fatalf("чужой отчёт: ожидалось ErrForbidden, получено %v", err)
	}

	svc, id, owner := setupReport(t, "queued")
	if _, err := svc.Share(context.Background(), id, owner); !errors.Is(err, ErrNotReady) {
		t.Fatalf("отчёт в очереди: ожидалось ErrNotReady, получено %v", err)
	}
}

func TestOlderReportGetsExplanationsWithCurrentZones(t *testing.T) {
	svc, id, owner := setupReport(t, "ready")
	v, err := svc.Get(context.Background(), id, auth.Principal{UserID: owner})
	if err != nil {
		t.Fatal(err)
	}
	if v.Result == nil || len(v.Result.NextSteps) == 0 || len(v.Result.TechRisks) == 0 {
		t.Fatal("старый отчёт без шагов и рисков техсостояния")
	}
	for _, sc := range v.Result.Scenarios {
		if sc.Feasibility == nil || sc.Evidence == nil {
			t.Fatalf("%s без проверки реализуемости", sc.FunctionCode)
		}
		for _, c := range sc.Feasibility.Checks {
			if c.Text == "Пересечения с зонами для объекта не проверены: сверьте участок в РГИС и НСПД." {
				t.Fatalf("%s: зоны карточки должны подставиться в старый снимок", sc.FunctionCode)
			}
		}
	}
	if v.Building.Zones == nil || !v.Building.Zones.Demo || v.Building.Zones.CheckedOn != "2026-11-23" {
		t.Fatalf("зоны в карточке: %+v", v.Building.Zones)
	}
	if v.Building.YearSource != "generated" {
		t.Fatalf("year_source: %q", v.Building.YearSource)
	}
}

func TestReopeningShareInvalidatesOldLink(t *testing.T) {
	svc, id, owner := setupReport(t, "ready")
	ctx := context.Background()
	old, err := svc.Share(ctx, id, owner)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Unshare(ctx, id, owner); err != nil {
		t.Fatal(err)
	}
	fresh, err := svc.Share(ctx, id, owner)
	if err != nil {
		t.Fatal(err)
	}
	if old.Token == fresh.Token {
		t.Fatal("reopening reused a revoked token")
	}
	if _, err := svc.GetShared(ctx, old.Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("old token works: %v", err)
	}
	if _, err := svc.GetShared(ctx, fresh.Token); err != nil {
		t.Fatal(err)
	}
}
