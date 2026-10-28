// Command api runs the SOREMO CITY HTTP API and background worker.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/soremo/city/api/internal/access"
	"github.com/soremo/city/api/internal/auth"
	"github.com/soremo/city/api/internal/blob"
	"github.com/soremo/city/api/internal/buildings"
	"github.com/soremo/city/api/internal/config"
	"github.com/soremo/city/api/internal/documents"
	"github.com/soremo/city/api/internal/engine"
	httpapi "github.com/soremo/city/api/internal/http"
	"github.com/soremo/city/api/internal/jobs"
	"github.com/soremo/city/api/internal/mail"
	"github.com/soremo/city/api/internal/reports"
	"github.com/soremo/city/api/internal/store"
)

func main() {
	cfg := config.Load()
	logger := zerolog.New(os.Stdout).With().Timestamp().Logger()
	if cfg.IsDev() {
		logger = logger.Output(zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.TimeOnly})
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Fatal().Err(err).Msg("connect database")
	}
	defer pool.Close()
	if err := store.Migrate(ctx, pool); err != nil {
		logger.Fatal().Err(err).Msg("migrate")
	}

	q := store.New(pool)
	bsvc := buildings.NewService(q)
	var mailer mail.Mailer = mail.LogMailer{Log: logger}
	if cfg.SMTPAddr != "" {
		mailer = mail.SMTPMailer{Addr: cfg.SMTPAddr, User: cfg.SMTPUser, Password: cfg.SMTPPass, From: cfg.MailFrom}
	}
	if !cfg.IsDev() && cfg.JWTSecret == "dev-only-secret-change-me" {
		logger.Fatal().Msg("set JWT_SECRET outside dev")
	}
	blobs, err := newBlobStore(ctx, cfg)
	if err != nil {
		logger.Fatal().Err(err).Msg("blob store")
	}
	authSvc := auth.NewService(q, mailer, cfg.JWTSecret, cfg.AppURL)
	// Замена движка: передайте сюда другую реализацию engine.ScenarioEngine.
	reportSvc := reports.NewService(pool, engine.MockEngine{}, bsvc)
	pdf := &reports.PDFRenderer{
		BaseURL: cfg.PrintBaseURL, ChromeURL: cfg.ChromeURL, Blobs: blobs,
		Token: authSvc.PrintToken,
	}

	worker := &jobs.Worker{Q: q, Log: logger, Concurrency: 4, Handlers: map[string]jobs.Handler{reports.JobRun: reportSvc.RunJob}}
	go worker.Run(ctx)

	srv := &http.Server{
		Addr: cfg.HTTPAddr,
		Handler: httpapi.NewRouter(httpapi.Deps{
			Log:         logger,
			Queries:     q,
			Buildings:   bsvc,
			Demo:        reports.NewDemo(q, bsvc),
			Auth:        authSvc,
			Reports:     reportSvc,
			PDF:         pdf,
			Documents:   documents.NewService(pool, blobs),
			Requests:    buildings.NewRequests(pool),
			Geocoder:    buildings.NewGeocoder(),
			Access:      access.NewService(pool),
			Dev:         cfg.IsDev(),
			CORSOrigins: cfg.CORSOrigins,
		}),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()

	logger.Info().Str("addr", cfg.HTTPAddr).Msg("listening")
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Fatal().Err(err).Msg("serve")
	}
}

func newBlobStore(ctx context.Context, cfg config.Config) (blob.Store, error) {
	if cfg.S3Endpoint == "" {
		return blob.FS{Dir: cfg.FilesDir}, nil
	}
	return blob.NewS3(ctx, cfg.S3Endpoint, cfg.S3Bucket, cfg.S3Key, cfg.S3Secret)
}
