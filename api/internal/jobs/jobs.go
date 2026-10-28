// Package jobs is a small Postgres-backed queue (table jobs) with a worker
// running inside the API binary. Jobs are claimed with FOR UPDATE SKIP LOCKED,
// so several API instances can share the queue.
package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/rs/zerolog"

	"github.com/soremo/city/api/internal/store"
)

type Handler func(ctx context.Context, payload json.RawMessage) error

// Enqueue adds a job; use the caller's transaction so the job appears together with its data.
func Enqueue(ctx context.Context, q *store.Queries, kind string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return q.EnqueueJob(ctx, store.EnqueueJobParams{Kind: kind, Payload: raw, RunAt: pgtype.Timestamptz{Time: time.Now(), Valid: true}})
}

type Worker struct {
	Q        *store.Queries
	Log      zerolog.Logger
	Handlers map[string]Handler
	// Concurrency — число одновременно выполняемых задач.
	Concurrency int
}

func (w *Worker) Run(ctx context.Context) {
	n := max(1, w.Concurrency)
	for i := 0; i < n; i++ {
		go w.loop(ctx)
	}
	<-ctx.Done()
}

func (w *Worker) loop(ctx context.Context) {
	for ctx.Err() == nil {
		job, err := w.Q.ClaimJob(ctx)
		if errors.Is(err, pgx.ErrNoRows) {
			sleep(ctx, 400*time.Millisecond)
			continue
		}
		if err != nil {
			if ctx.Err() == nil {
				w.Log.Error().Err(err).Msg("claim job")
			}
			sleep(ctx, 2*time.Second)
			continue
		}
		w.process(ctx, job)
	}
}

func (w *Worker) process(ctx context.Context, job store.Job) {
	log := w.Log.With().Int64("job", job.ID).Str("kind", job.Kind).Logger()
	h, ok := w.Handlers[job.Kind]
	if !ok {
		log.Error().Msg("no handler")
		_ = w.Q.RetryJob(ctx, store.RetryJobParams{ID: job.ID, LastError: pgtype.Text{String: "no handler", Valid: true}})
		return
	}
	start := time.Now()
	jctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	if err := h(jctx, job.Payload); err != nil {
		log.Error().Err(err).Int32("attempt", job.Attempts).Msg("job failed")
		_ = w.Q.RetryJob(ctx, store.RetryJobParams{ID: job.ID, LastError: pgtype.Text{String: err.Error(), Valid: true}})
		return
	}
	if err := w.Q.CompleteJob(ctx, job.ID); err != nil {
		log.Error().Err(err).Msg("complete job")
	}
	log.Info().Dur("dur", time.Since(start)).Msg("job done")
}

func sleep(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}
