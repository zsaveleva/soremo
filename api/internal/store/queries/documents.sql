-- name: CreateDocument :one
INSERT INTO documents (building_id, user_id, kind, issued_on, file_key, file_name, mime, size)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: ListBuildingDocuments :many
SELECT d.*, b.address FROM documents d JOIN buildings b ON b.id = d.building_id
WHERE d.building_id = $1 AND (d.user_id = $2 OR d.status = 'accepted')
ORDER BY d.created_at DESC;

-- name: ListMyDocuments :many
SELECT d.*, b.address FROM documents d JOIN buildings b ON b.id = d.building_id
WHERE d.user_id = $1 ORDER BY d.created_at DESC;

-- name: ListDocumentsForReview :many
SELECT d.*, b.address, u.email, u.company_name
FROM documents d JOIN buildings b ON b.id = d.building_id JOIN users u ON u.id = d.user_id
WHERE (sqlc.narg(status)::text IS NULL OR d.status = sqlc.narg(status)::text)
ORDER BY (d.status = 'pending') DESC, d.created_at DESC
LIMIT 500;

-- name: GetDocument :one
SELECT d.*, b.address FROM documents d JOIN buildings b ON b.id = d.building_id WHERE d.id = $1;

-- name: ReviewDocument :one
UPDATE documents SET status = $2, review_comment = $3, reviewed_by = $4, reviewed_at = now()
WHERE id = $1 AND status = 'pending'
RETURNING *;
