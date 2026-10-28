// Package httpapi wires HTTP routes, middleware and handlers.
package httpapi

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/rs/zerolog"

	"github.com/soremo/city/api/internal/access"
	"github.com/soremo/city/api/internal/auth"
	"github.com/soremo/city/api/internal/buildings"
	"github.com/soremo/city/api/internal/documents"
	"github.com/soremo/city/api/internal/reports"
	"github.com/soremo/city/api/internal/store"
)

type Deps struct {
	Log         zerolog.Logger
	Queries     *store.Queries
	Buildings   *buildings.Service
	Demo        *reports.Demo
	Reports     *reports.Service
	PDF         *reports.PDFRenderer
	Documents   *documents.Service
	Requests    *buildings.Requests
	Geocoder    *buildings.Geocoder
	Auth        *auth.Service
	Access      *access.Service
	Dev         bool
	ShowLinks   bool
	CORSOrigins []string
}

func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, clientIP, requestLogger(d.Log), middleware.Recoverer)
	r.Use(authenticate(d.Auth))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   d.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           600,
	}))

	cities := &citiesHandler{q: d.Queries}
	bh := &buildingsHandler{svc: d.Buildings, q: d.Queries, reports: d.Reports}
	rh := &reportsHandler{svc: d.Reports, demo: d.Demo, pdf: d.PDF, q: d.Queries}
	demo := &demoHandler{demo: d.Demo, q: d.Queries}
	ah := &authHandler{auth: d.Auth, access: d.Access, q: d.Queries, dev: d.Dev, showLinks: d.ShowLinks}
	acc := &accessHandler{svc: d.Access}
	dh := &documentsHandler{svc: d.Documents, buildings: d.Buildings, q: d.Queries}
	oh := &objectsHandler{requests: d.Requests, geo: d.Geocoder, q: d.Queries}
	adm := &adminHandler{q: d.Queries, docs: d.Documents, requests: d.Requests}

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		})
		r.Get("/cities", cities.list)
		r.Get("/buildings", bh.list)
		r.Get("/buildings/search", bh.search)
		r.Get("/buildings/{id}", bh.get)
		r.Get("/demo/buildings", demo.buildings)
		r.Get("/demo/reports/{buildingID}", demo.report)
		r.Get("/demo/reports/{buildingID}/pdf", rh.demoPDF)

		r.Route("/auth", func(r chi.Router) {
			// Подбор пароля и массовая регистрация — строгий лимит; refresh вызывается
			// при каждой загрузке страницы, ему нужен запас.
			strict := rateLimit(20, 10)
			r.With(strict).Post("/signup", ah.signup)
			r.With(strict).Post("/verify", ah.verify)
			r.With(strict).Post("/resend", ah.resend)
			r.With(strict).Post("/login", ah.login)
			r.With(rateLimit(120, 30)).Post("/refresh", ah.refresh)
			r.Post("/logout", ah.logout)
		})
		r.Get("/packages", acc.packages)

		// Отчёт читает владелец, админ или печатный токен этого отчёта.
		r.With(requireReader).Get("/reports/{id}", rh.get)

		r.Group(func(r chi.Router) {
			r.Use(requireUser)
			r.Get("/me", ah.me)
			r.Post("/me/notifications/read", ah.readNotifications)
			r.Post("/checkout", acc.checkout)
			r.Post("/payments/{id}/confirm", acc.confirm)
			r.Get("/access/current", acc.current)
			r.Post("/buildings/{id}/reports", rh.start)
			r.Get("/reports/{id}/pdf", rh.pdfFile)
			r.Get("/me/reports", rh.mine)

			r.Post("/buildings/{id}/documents", dh.upload)
			r.Get("/buildings/{id}/documents", dh.forBuilding)
			r.Get("/me/documents", dh.mine)
			r.Get("/documents/{id}/file", dh.file)

			r.Post("/buildings", oh.create)
			r.Get("/me/object-requests", oh.mine)
			r.With(rateLimit(30, 5)).Get("/geocode", oh.geocode)
		})

		r.Route("/admin", func(r chi.Router) {
			r.Use(requireAdmin)
			r.Get("/documents", adm.listDocuments)
			r.Post("/documents/{id}/review", adm.reviewDocument)
			r.Get("/object-requests", adm.listObjectRequests)
			r.Post("/object-requests/{id}/review", adm.reviewObjectRequest)
			r.Get("/users", adm.users)
			r.Get("/payments", adm.payments)
		})
	})
	return r
}

func requestLogger(base zerolog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			l := base.With().Str("req_id", middleware.GetReqID(r.Context())).Logger()
			next.ServeHTTP(ww, r.WithContext(l.WithContext(r.Context())))
			l.Info().Str("method", r.Method).Str("path", r.URL.Path).
				Int("status", ww.Status()).Dur("dur", time.Since(start)).Msg("http")
		})
	}
}
