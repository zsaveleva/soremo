// Package buildings serves building geometry, search and cards.
package buildings

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/soremo/city/api/internal/engine"
	"github.com/soremo/city/api/internal/store"
)

var ErrNotFound = errors.New("building not found")

// ClusterZoom is the zoom level below which buildings are returned as clusters.
const ClusterZoom = 13

type Service struct {
	q *store.Queries
}

func NewService(q *store.Queries) *Service { return &Service{q: q} }

type BBox struct{ MinLon, MinLat, MaxLon, MaxLat float64 }

type Filter struct {
	CityID    int32
	BBox      BBox
	Zoom      float64
	YearFrom  *int32
	YearTo    *int32
	AreaFrom  *float64
	AreaTo    *float64
	Functions []string
	HasDocs   *bool
	MineUser  *uuid.UUID
}

type FeatureCollection struct {
	Type     string    `json:"type"`
	Features []Feature `json:"features"`
}

type Feature struct {
	Type       string          `json:"type"`
	ID         int64           `json:"id"`
	Geometry   json.RawMessage `json:"geometry"`
	Properties map[string]any  `json:"properties"`
}

// List returns building footprints, or clusters of centroids at low zoom.
func (s *Service) List(ctx context.Context, f Filter) (FeatureCollection, error) {
	fc := FeatureCollection{Type: "FeatureCollection", Features: []Feature{}}
	mine := uuid.NullUUID{}
	if f.MineUser != nil {
		mine = uuid.NullUUID{UUID: *f.MineUser, Valid: true}
	}

	if f.Zoom < ClusterZoom {
		rows, err := s.q.ListBuildingClusters(ctx, store.ListBuildingClustersParams{
			CityID: f.CityID, MinLon: f.BBox.MinLon, MinLat: f.BBox.MinLat, MaxLon: f.BBox.MaxLon, MaxLat: f.BBox.MaxLat,
			YearFrom: i4(f.YearFrom), YearTo: i4(f.YearTo), AreaFrom: f8(f.AreaFrom), AreaTo: f8(f.AreaTo),
			Functions: f.Functions, HasDocs: b(f.HasDocs), Mine: mine,
			CellDeg: clusterCell(f.Zoom),
		})
		if err != nil {
			return fc, err
		}
		for _, r := range rows {
			geom, _ := json.Marshal(map[string]any{"type": "Point", "coordinates": []float64{r.Lon, r.Lat}})
			fc.Features = append(fc.Features, Feature{
				Type: "Feature", ID: r.SampleID, Geometry: geom,
				Properties: map[string]any{"cluster": true, "count": r.N},
			})
		}
		return fc, nil
	}

	rows, err := s.q.ListBuildingFeatures(ctx, store.ListBuildingFeaturesParams{
		CityID: f.CityID, MinLon: f.BBox.MinLon, MinLat: f.BBox.MinLat, MaxLon: f.BBox.MaxLon, MaxLat: f.BBox.MaxLat,
		YearFrom: i4(f.YearFrom), YearTo: i4(f.YearTo), AreaFrom: f8(f.AreaFrom), AreaTo: f8(f.AreaTo),
		Functions: f.Functions, HasDocs: b(f.HasDocs), Mine: mine,
	})
	if err != nil {
		return fc, err
	}
	for _, r := range rows {
		fc.Features = append(fc.Features, Feature{
			Type: "Feature", ID: r.ID, Geometry: json.RawMessage(r.Geometry),
			Properties: map[string]any{
				"address":           r.Address,
				"year_built":        r.YearBuilt,
				"original_function": r.OriginalFunction,
				"area_total_m2":     r.AreaTotalM2,
				"source":            r.Source,
				"is_demo":           r.IsDemo,
			},
		})
	}
	return fc, nil
}

// clusterCell picks a grid step of roughly 64 screen pixels at the given zoom.
func clusterCell(zoom float64) float64 {
	return 360 / math.Pow(2, zoom) * 64 / 256
}

type Card struct {
	ID               int64           `json:"id"`
	Address          string          `json:"address"`
	Name             *string         `json:"name"`
	YearBuilt        int32           `json:"year_built"`
	OriginalFunction string          `json:"original_function"`
	Floors           int32           `json:"floors"`
	AreaTotalM2      float64         `json:"area_total_m2"`
	AreaSiteM2       float64         `json:"area_site_m2"`
	AreaFootprintM2  float64         `json:"area_footprint_m2"`
	VRI              string          `json:"vri"`
	PZZZone          string          `json:"pzz_zone"`
	IsOKN            bool            `json:"is_okn"`
	LegalStatus      string          `json:"legal_status"`
	Source           string          `json:"source"`
	IsDemo           bool            `json:"is_demo"`
	Geometry         json.RawMessage `json:"geometry"`
	Center           [2]float64      `json:"center"`
	Context          Context         `json:"context"`
	Accuracy         Accuracy        `json:"accuracy"`
	// MyReportID is filled by the HTTP layer for signed-in users.
	MyReportID *string `json:"my_report_id"`
}

type Accuracy struct {
	Level        engine.AccuracyLevel `json:"level"`
	DocsPending  int32                `json:"docs_pending"`
	DocsAccepted int32                `json:"docs_accepted"`
}

type Context struct {
	MetroName         string `json:"metro_name"`
	MetroDistM        int32  `json:"metro_dist_m"`
	TransitIndex      int32  `json:"transit_index"`
	Social500m        int32  `json:"social_500m"`
	CommercialDensity int32  `json:"commercial_density"`
	BusinessActivity  int32  `json:"business_activity"`
}

func (s *Service) Get(ctx context.Context, id int64) (Card, error) {
	r, err := s.q.GetBuilding(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && r.Status != "active") {
		return Card{}, ErrNotFound
	}
	if err != nil {
		return Card{}, err
	}
	c := Card{
		ID: r.ID, Address: r.Address, YearBuilt: r.YearBuilt, OriginalFunction: r.OriginalFunction,
		Floors: r.Floors, AreaTotalM2: r.AreaTotalM2, AreaSiteM2: r.AreaSiteM2, AreaFootprintM2: r.AreaFootprintM2,
		VRI: r.Vri, PZZZone: r.PzzZone, IsOKN: r.IsOkn, LegalStatus: r.LegalStatus, Source: r.Source,
		IsDemo: r.IsDemo, Geometry: json.RawMessage(r.Geometry), Center: [2]float64{r.Lon, r.Lat},
		Context: Context{
			MetroName: r.MetroName, MetroDistM: r.MetroDistM, TransitIndex: r.TransitIndex,
			Social500m: r.Social500m, CommercialDensity: r.CommercialDensity, BusinessActivity: r.BusinessActivity,
		},
	}
	if r.Name.Valid {
		c.Name = &r.Name.String
	}
	st, err := s.q.DocumentStatsForBuilding(ctx, id)
	if err != nil {
		return Card{}, err
	}
	c.Accuracy = Accuracy{Level: engine.AccuracyFor(st.AcceptedKinds), DocsPending: st.Pending, DocsAccepted: st.Accepted}
	return c, nil
}

type SearchHit struct {
	ID               int64      `json:"id"`
	Address          string     `json:"address"`
	Name             *string    `json:"name"`
	YearBuilt        int32      `json:"year_built"`
	OriginalFunction string     `json:"original_function"`
	IsDemo           bool       `json:"is_demo"`
	Source           string     `json:"source"`
	Center           [2]float64 `json:"center"`
}

// Search requires every query word to appear in the address or the building
// name and ranks the hits by trigram similarity.
func (s *Service) Search(ctx context.Context, cityID int32, q string) ([]SearchHit, error) {
	tokens := SearchTokens(q)
	if len(tokens) == 0 || len([]rune(strings.Join(tokens, ""))) < 2 {
		return []SearchHit{}, nil
	}
	rows, err := s.q.SearchBuildings(ctx, store.SearchBuildingsParams{CityID: cityID, Tokens: tokens, Q: q})
	if err != nil {
		return nil, err
	}
	out := make([]SearchHit, 0, len(rows))
	for _, r := range rows {
		h := SearchHit{ID: r.ID, Address: r.Address, YearBuilt: r.YearBuilt, OriginalFunction: r.OriginalFunction,
			IsDemo: r.IsDemo, Source: r.Source, Center: [2]float64{r.Lon, r.Lat}}
		if r.Name.Valid {
			h.Name = &r.Name.String
		}
		out = append(out, h)
	}
	return out, nil
}

func i4(v *int32) pgtype.Int4 {
	if v == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: *v, Valid: true}
}

func f8(v *float64) pgtype.Float8 {
	if v == nil {
		return pgtype.Float8{}
	}
	return pgtype.Float8{Float64: *v, Valid: true}
}

func b(v *bool) pgtype.Bool {
	if v == nil {
		return pgtype.Bool{}
	}
	return pgtype.Bool{Bool: *v, Valid: true}
}
