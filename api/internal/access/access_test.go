package access

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/soremo/city/api/internal/store"
	"github.com/soremo/city/api/internal/testdb"
)

var goodCard = Card{Number: "4242 4242 4242 4242", Expiry: "12/29", CVC: "123", Holder: "ANNA K"}

type fixture struct {
	pool      *pgxpool.Pool
	svc       *Service
	user      uuid.UUID
	buildings []int64
	pkg       map[string]int32
}

func setup(t *testing.T) fixture {
	t.Helper()
	pool := testdb.New(t)
	ctx := context.Background()
	f := fixture{pool: pool, svc: NewService(pool), pkg: map[string]int32{}}
	mustExec(t, pool, `INSERT INTO cities (slug, name, bbox) VALUES ('spb', 'СПб', ST_MakeEnvelope(29, 59, 31, 61, 4326))`)
	for i := 0; i < 3; i++ {
		var id int64
		err := pool.QueryRow(ctx, `INSERT INTO buildings (city_id, address, geom, centroid, year_built, original_function, floors,
			area_total_m2, area_site_m2, area_footprint_m2, vri, pzz_zone, legal_status)
			VALUES (1, 'Тестовая ул., '||$1::text, ST_MakeEnvelope(30, 59.9, 30.001, 59.901, 4326),
			ST_SetSRID(ST_MakePoint(30.0005, 59.9005), 4326), 1960, 'industrial', 2, 1000, 2000, 500, 'x', 'ТП1', 'x')
			RETURNING id`, strconv.Itoa(i+1)).Scan(&id)
		if err != nil {
			t.Fatal(err)
		}
		f.buildings = append(f.buildings, id)
	}
	for _, p := range []struct {
		key    string
		limit  *int32
		months int32
	}{{"one", ptr(1), 1}, {"five", ptr(5), 3}, {"all", nil, 6}} {
		var id int32
		if err := pool.QueryRow(ctx, `INSERT INTO packages (objects_limit, months, price_rub) VALUES ($1, $2, 1000) RETURNING id`,
			p.limit, p.months).Scan(&id); err != nil {
			t.Fatal(err)
		}
		f.pkg[p.key] = id
	}
	if err := pool.QueryRow(ctx, `INSERT INTO users (email, password_hash, type, segment, email_verified_at)
		VALUES ('a@b.ru', 'x', 'company', 'investor', now()) RETURNING id`).Scan(&f.user); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f fixture) buy(t *testing.T, key string) store.Access {
	t.Helper()
	ctx := context.Background()
	pay, _, err := f.svc.Checkout(ctx, f.user, f.pkg[key])
	if err != nil {
		t.Fatal(err)
	}
	acc, err := f.svc.Confirm(ctx, f.user, pay.ID, goodCard)
	if err != nil {
		t.Fatal(err)
	}
	return acc
}

func (f fixture) consume(t *testing.T, building int64) error {
	t.Helper()
	return pgx.BeginFunc(context.Background(), f.pool, func(tx pgx.Tx) error {
		_, err := Consume(context.Background(), store.New(tx), f.user, building)
		return err
	})
}

func (f fixture) used(t *testing.T) int32 {
	t.Helper()
	cur, err := f.svc.Current(context.Background(), f.user)
	if err != nil || cur == nil {
		t.Fatalf("no current access: %v", err)
	}
	return cur.ObjectsUsed
}

func TestQuotaRequiresActiveAccess(t *testing.T) {
	f := setup(t)
	if err := f.consume(t, f.buildings[0]); !errors.Is(err, ErrNoAccess) {
		t.Fatalf("без пакета: ожидалось ErrNoAccess, получено %v", err)
	}
	f.buy(t, "five")
	mustExec(t, f.pool, `UPDATE accesses SET ends_at = now() - interval '1 minute'`)
	if err := f.consume(t, f.buildings[0]); !errors.Is(err, ErrNoAccess) {
		t.Fatalf("истёкший доступ: ожидалось ErrNoAccess, получено %v", err)
	}
}

func TestRepeatModellingIsFree(t *testing.T) {
	f := setup(t)
	f.buy(t, "five")
	for i := 0; i < 3; i++ {
		if err := f.consume(t, f.buildings[0]); err != nil {
			t.Fatal(err)
		}
	}
	if u := f.used(t); u != 1 {
		t.Fatalf("повторное моделирование не должно тратить лимит: использовано %d", u)
	}
	if err := f.consume(t, f.buildings[1]); err != nil {
		t.Fatal(err)
	}
	if u := f.used(t); u != 2 {
		t.Fatalf("второй объект: использовано %d, ожидалось 2", u)
	}
}

func TestQuotaExceeded(t *testing.T) {
	f := setup(t)
	f.buy(t, "one")
	if err := f.consume(t, f.buildings[0]); err != nil {
		t.Fatal(err)
	}
	if err := f.consume(t, f.buildings[1]); !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("ожидалось ErrQuotaExceeded, получено %v", err)
	}
	if err := f.consume(t, f.buildings[0]); err != nil {
		t.Fatalf("уже списанный объект должен оставаться доступным: %v", err)
	}
	if u := f.used(t); u != 1 {
		t.Fatalf("неудачная попытка не должна менять счётчик: %d", u)
	}
}

func TestUnlimitedPackage(t *testing.T) {
	f := setup(t)
	f.buy(t, "all")
	for _, b := range f.buildings {
		if err := f.consume(t, b); err != nil {
			t.Fatalf("пакет «Все» не должен ограничивать: %v", err)
		}
	}
}

func TestNewPackageKeepsModelledObjectsFree(t *testing.T) {
	f := setup(t)
	f.buy(t, "one")
	if err := f.consume(t, f.buildings[0]); err != nil {
		t.Fatal(err)
	}
	f.buy(t, "one")
	if err := f.consume(t, f.buildings[0]); err != nil {
		t.Fatal(err)
	}
	if u := f.used(t); u != 0 {
		t.Fatalf("пересчёт объекта из прошлого пакета не должен тратить новый лимит: %d", u)
	}
	if err := f.consume(t, f.buildings[1]); err != nil {
		t.Fatal(err)
	}
}

func TestPaymentConfirmedOnce(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	pay, _, err := f.svc.Checkout(ctx, f.user, f.pkg["five"])
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Confirm(ctx, f.user, pay.ID, Card{Number: DeclinedCard, Expiry: "12/29", CVC: "123", Holder: "X"}); !errors.Is(err, ErrCardDeclined) {
		t.Fatalf("ожидался отказ банка, получено %v", err)
	}
	if _, err := f.svc.Confirm(ctx, f.user, pay.ID, goodCard); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Confirm(ctx, f.user, pay.ID, goodCard); !errors.Is(err, ErrPaymentDone) {
		t.Fatalf("повторное подтверждение: ожидалось ErrPaymentDone, получено %v", err)
	}
}

func TestValidateCard(t *testing.T) {
	now := time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC)
	if f := ValidateCard(goodCard, now); len(f) != 0 {
		t.Fatalf("корректная карта отклонена: %v", f)
	}
	f := ValidateCard(Card{Number: "4242 4242 4242 4241", Expiry: "09/26", CVC: "12"}, now)
	for _, k := range []string{"number", "expiry", "cvc", "holder"} {
		if f[k] == "" {
			t.Errorf("нет ошибки для поля %s", k)
		}
	}
}

func mustExec(t *testing.T, pool *pgxpool.Pool, sql string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql); err != nil {
		t.Fatal(err)
	}
}

func ptr(v int32) *int32 { return &v }
