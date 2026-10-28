package buildings

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/soremo/city/api/internal/store"
)

var ErrRequestReviewed = errors.New("request already reviewed")

type NewObject struct {
	Address          string  `json:"address" validate:"required,min=5,max=200"`
	Lon              float64 `json:"lon" validate:"required,longitude"`
	Lat              float64 `json:"lat" validate:"required,latitude"`
	YearBuilt        int32   `json:"year_built" validate:"required,min=1900,max=1995"`
	AreaTotalM2      float64 `json:"area_total_m2" validate:"required,min=100,max=500000"`
	Floors           int32   `json:"floors" validate:"required,min=1,max=40"`
	OriginalFunction string  `json:"original_function" validate:"required,oneof=industrial warehouse culture administrative research retail sport other"`
	Comment          string  `json:"comment" validate:"max=2000"`
}

type Requests struct {
	pool *pgxpool.Pool
	q    *store.Queries
}

func NewRequests(pool *pgxpool.Pool) *Requests { return &Requests{pool: pool, q: store.New(pool)} }

// Create adds a pending building and a moderation request in one transaction (ТЗ 4.5).
func (r *Requests) Create(ctx context.Context, user uuid.UUID, cityID int32, in NewObject) (store.ObjectRequest, error) {
	var req store.ObjectRequest
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		q := r.q.WithTx(tx)
		footprint := in.AreaTotalM2 / float64(in.Floors)
		id, err := q.CreatePendingBuilding(ctx, store.CreatePendingBuildingParams{
			CityID: cityID, Address: in.Address, Lon: in.Lon, Lat: in.Lat, YearBuilt: in.YearBuilt,
			OriginalFunction: in.OriginalFunction, Floors: in.Floors, AreaTotal: in.AreaTotalM2, Footprint: footprint,
			AreaSite:  footprint * 2, // оценка до уточнения модератором
			CreatedBy: uuid.NullUUID{UUID: user, Valid: true},
		})
		if err != nil {
			return err
		}
		if err := q.UpsertEstimatedContext(ctx, id); err != nil {
			return err
		}
		req, err = q.CreateObjectRequest(ctx, store.CreateObjectRequestParams{
			UserID: user, BuildingID: id, Comment: pgtype.Text{String: in.Comment, Valid: in.Comment != ""},
		})
		return err
	})
	return req, err
}

func (r *Requests) Review(ctx context.Context, id uuid.UUID, accepted bool, comment string) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		q := r.q.WithTx(tx)
		status, bstatus := "rejected", "rejected"
		if accepted {
			status, bstatus = "accepted", "active"
		}
		req, err := q.ReviewObjectRequest(ctx, store.ReviewObjectRequestParams{
			ID: id, Status: status, ReviewComment: pgtype.Text{String: comment, Valid: comment != ""},
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrRequestReviewed
		}
		if err != nil {
			return err
		}
		if err := q.SetBuildingStatus(ctx, store.SetBuildingStatusParams{ID: req.BuildingID, Status: bstatus}); err != nil {
			return err
		}
		b, err := q.GetBuilding(ctx, req.BuildingID)
		if err != nil {
			return err
		}
		text := fmt.Sprintf("Объект %s добавлен в базу. Его можно моделировать.", b.Address)
		if !accepted {
			text = fmt.Sprintf("Заявка на объект %s отклонена: %s", b.Address, comment)
		}
		return q.CreateNotification(ctx, store.CreateNotificationParams{
			UserID: req.UserID, Kind: "object_" + status, Text: text,
			Link: pgtype.Text{String: fmt.Sprintf("/map?b=%d", req.BuildingID), Valid: accepted},
		})
	})
}
