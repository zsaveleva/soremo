-- name: CreateReport :one
INSERT INTO reports (building_id, user_id, access_id, accuracy_level, engine_version, input_snapshot, status)
VALUES ($1, $2, $3, $4, $5, $6, 'queued')
RETURNING *;

-- name: GetReport :one
SELECT * FROM reports WHERE id = $1;

-- name: SetReportRunning :exec
UPDATE reports SET status = 'running' WHERE id = $1 AND status = 'queued';

-- name: FinishReport :exec
UPDATE reports SET status = 'ready', result = $2, finished_at = now() WHERE id = $1;

-- name: FailReport :exec
UPDATE reports SET status = 'failed', finished_at = now() WHERE id = $1;

-- name: SetReportPDF :exec
UPDATE reports SET pdf_key = $2 WHERE id = $1;

-- name: LatestReportForBuilding :one
SELECT id, status, accuracy_level, created_at FROM reports
WHERE user_id = $1 AND building_id = $2 AND status IN ('queued', 'running', 'ready')
ORDER BY created_at DESC LIMIT 1;

-- name: ActiveReportForBuilding :one
SELECT id FROM reports
WHERE user_id = $1 AND building_id = $2 AND status IN ('queued', 'running')
ORDER BY created_at DESC LIMIT 1;

-- name: ListMyReports :many
SELECT DISTINCT ON (r.building_id)
       r.id, r.building_id, r.status, r.accuracy_level, r.created_at, r.finished_at,
       b.address, b.name, b.original_function, b.year_built,
       (SELECT count(*) FROM reports r2 WHERE r2.user_id = r.user_id AND r2.building_id = r.building_id AND r2.status = 'ready')::int AS versions
FROM reports r JOIN buildings b ON b.id = r.building_id
WHERE r.user_id = $1 AND r.status <> 'failed'
ORDER BY r.building_id, r.created_at DESC;

-- name: AcceptedDocuments :many
SELECT kind, issued_on FROM documents WHERE building_id = $1 AND status = 'accepted' ORDER BY issued_on DESC;

-- name: EnqueueJob :exec
INSERT INTO jobs (kind, payload, run_at) VALUES ($1, $2, $3);

-- name: ClaimJob :one
UPDATE jobs SET locked_at = now(), attempts = attempts + 1
WHERE id = (
    SELECT id FROM jobs
    WHERE done_at IS NULL AND run_at <= now() AND attempts < 3
      AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes')
    ORDER BY run_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1)
RETURNING *;

-- name: CompleteJob :exec
UPDATE jobs SET done_at = now(), last_error = NULL WHERE id = $1;

-- name: RetryJob :exec
UPDATE jobs SET locked_at = NULL, last_error = $2, run_at = now() + interval '10 seconds' WHERE id = $1;
