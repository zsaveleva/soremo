// Package access sells packages (mock payment) and enforces object quotas (ТЗ 8.4).
package access

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/soremo/city/api/internal/store"
)

var (
	ErrPackageNotFound = errors.New("package not found")
	ErrPaymentNotFound = errors.New("payment not found")
	ErrPaymentDone     = errors.New("payment already processed")
	ErrCardDeclined    = errors.New("card declined")
	ErrNoAccess        = errors.New("no active access")
	ErrQuotaExceeded   = errors.New("quota exceeded")
)

// DeclinedCard is the test card number that the mock provider always declines.
const DeclinedCard = "4000000000000002"

type Service struct {
	pool *pgxpool.Pool
	q    *store.Queries
	now  func() time.Time
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, q: store.New(pool), now: time.Now}
}

type Package struct {
	ID           int32  `json:"id"`
	ObjectsLimit *int32 `json:"objects_limit"`
	Months       int32  `json:"months"`
	PriceRub     int64  `json:"price_rub"`
}

func (s *Service) Packages(ctx context.Context) ([]Package, error) {
	rows, err := s.q.ListPackages(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Package, 0, len(rows))
	for _, p := range rows {
		out = append(out, toPackage(p))
	}
	return out, nil
}

func toPackage(p store.Package) Package {
	pk := Package{ID: p.ID, Months: p.Months, PriceRub: p.PriceRub}
	if p.ObjectsLimit.Valid {
		v := p.ObjectsLimit.Int32
		pk.ObjectsLimit = &v
	}
	return pk
}

// Checkout creates a pending payment; the price always comes from the database.
func (s *Service) Checkout(ctx context.Context, user uuid.UUID, packageID int32) (store.Payment, Package, error) {
	p, err := s.q.GetPackage(ctx, packageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return store.Payment{}, Package{}, ErrPackageNotFound
	}
	if err != nil {
		return store.Payment{}, Package{}, err
	}
	pay, err := s.q.CreatePayment(ctx, store.CreatePaymentParams{UserID: user, PackageID: p.ID, AmountRub: p.PriceRub})
	return pay, toPackage(p), err
}

// Card is the mock card form; ValidateCard checks it field by field.
type Card struct {
	Number string `json:"number"`
	Expiry string `json:"expiry"`
	CVC    string `json:"cvc"`
	Holder string `json:"holder"`
}

var expiryRe = regexp.MustCompile(`^(0[1-9]|1[0-2])\s*/\s*(\d{2})$`)

// ValidateCard returns field → message for the mock card form.
func ValidateCard(c Card, now time.Time) map[string]string {
	f := map[string]string{}
	num := strings.ReplaceAll(c.Number, " ", "")
	if len(num) < 16 || len(num) > 19 || !luhn(num) {
		f["number"] = "Проверьте номер карты: 16 цифр без ошибок"
	}
	m := expiryRe.FindStringSubmatch(strings.TrimSpace(c.Expiry))
	if m == nil {
		f["expiry"] = "Укажите срок в формате ММ/ГГ"
	} else {
		mm, _ := strconv.Atoi(m[1])
		yy, _ := strconv.Atoi(m[2])
		end := time.Date(2000+yy, time.Month(mm)+1, 1, 0, 0, 0, 0, time.UTC)
		if !end.After(now) {
			f["expiry"] = "Срок действия карты истёк — укажите другую карту"
		}
	}
	if ok, _ := regexp.MatchString(`^\d{3}$`, c.CVC); !ok {
		f["cvc"] = "Три цифры с обратной стороны карты"
	}
	if h := strings.TrimSpace(c.Holder); h == "" || len(h) > 100 {
		f["holder"] = "Укажите имя латиницей, как на карте"
	}
	return f
}

func luhn(s string) bool {
	sum, alt := 0, false
	for i := len(s) - 1; i >= 0; i-- {
		d := int(s[i] - '0')
		if d < 0 || d > 9 {
			return false
		}
		if alt {
			if d *= 2; d > 9 {
				d -= 9
			}
		}
		sum += d
		alt = !alt
	}
	return sum%10 == 0
}

// Confirm marks the mock payment as succeeded and opens access.
// A new purchase replaces the active access; buildings already modelled stay
// free to recalculate under the new access.
func (s *Service) Confirm(ctx context.Context, user, paymentID uuid.UUID, card Card) (store.Access, error) {
	var acc store.Access
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		pay, err := q.GetPaymentForUpdate(ctx, store.GetPaymentForUpdateParams{ID: paymentID, UserID: user})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPaymentNotFound
		}
		if err != nil {
			return err
		}
		if pay.Status != "pending" {
			return ErrPaymentDone
		}
		if strings.ReplaceAll(card.Number, " ", "") == DeclinedCard {
			return ErrCardDeclined
		}
		pk, err := q.GetPackage(ctx, pay.PackageID)
		if err != nil {
			return err
		}
		prev, err := q.GetAccessForUpdate(ctx, user)
		hasPrev := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if err := q.ExpireAccesses(ctx, user); err != nil {
			return err
		}
		now := s.now()
		acc, err = q.CreateAccess(ctx, store.CreateAccessParams{
			UserID: user, PackageID: pk.ID, ObjectsLimit: pk.ObjectsLimit, ObjectsUsed: 0,
			StartsAt: ts(now), EndsAt: ts(now.AddDate(0, int(pk.Months), 0)),
		})
		if err != nil {
			return err
		}
		if hasPrev {
			if err := q.CopyAccessObjects(ctx, store.CopyAccessObjectsParams{NewAccess: acc.ID, OldAccess: prev.ID}); err != nil {
				return err
			}
		}
		return q.CompletePayment(ctx, store.CompletePaymentParams{ID: pay.ID, AccessID: uuid.NullUUID{UUID: acc.ID, Valid: true}})
	})
	return acc, err
}

type Current struct {
	ID           uuid.UUID `json:"id"`
	ObjectsLimit *int32    `json:"objects_limit"`
	ObjectsUsed  int32     `json:"objects_used"`
	StartsAt     time.Time `json:"starts_at"`
	EndsAt       time.Time `json:"ends_at"`
	Status       string    `json:"status"`
	Months       int32     `json:"months"`
}

func (s *Service) Current(ctx context.Context, user uuid.UUID) (*Current, error) {
	a, err := s.q.GetCurrentAccess(ctx, user)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c := &Current{ID: a.ID, ObjectsUsed: a.ObjectsUsed, StartsAt: a.StartsAt.Time, EndsAt: a.EndsAt.Time, Status: a.Status, Months: a.Months}
	if a.ObjectsLimit.Valid {
		v := a.ObjectsLimit.Int32
		c.ObjectsLimit = &v
	}
	return c, nil
}

// Consume applies the quota rule from ТЗ 8.4 inside the caller's transaction:
// a building already in the access is free; otherwise one object is used up.
// Returns the access id the report is charged to.
func Consume(ctx context.Context, q *store.Queries, user uuid.UUID, buildingID int64) (uuid.UUID, error) {
	a, err := q.GetAccessForUpdate(ctx, user)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNoAccess
	}
	if err != nil {
		return uuid.Nil, err
	}
	seen, err := q.HasAccessObject(ctx, store.HasAccessObjectParams{AccessID: a.ID, BuildingID: buildingID})
	if err != nil {
		return uuid.Nil, err
	}
	if seen {
		return a.ID, nil
	}
	if a.ObjectsLimit.Valid && a.ObjectsUsed >= a.ObjectsLimit.Int32 {
		return uuid.Nil, ErrQuotaExceeded
	}
	if err := q.AddAccessObject(ctx, store.AddAccessObjectParams{AccessID: a.ID, BuildingID: buildingID}); err != nil {
		return uuid.Nil, err
	}
	// Пакет «Все» не ограничен, но счётчик ведётся: кабинет показывает число объектов.
	if err := q.IncrementObjectsUsed(ctx, a.ID); err != nil {
		return uuid.Nil, err
	}
	return a.ID, nil
}

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }
