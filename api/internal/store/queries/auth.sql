-- name: CreateUser :one
INSERT INTO users (email, password_hash, type, segment, company_name, phone)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: GetUser :one
SELECT * FROM users WHERE id = $1;

-- name: MarkEmailVerified :exec
UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1;

-- name: CreateEmailToken :exec
INSERT INTO email_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3);

-- name: UseEmailToken :one
UPDATE email_tokens SET used_at = now()
WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
RETURNING user_id;

-- name: CreateRefreshToken :exec
INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3);

-- name: GetRefreshToken :one
SELECT * FROM refresh_tokens WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now();

-- name: RevokeRefreshToken :exec
UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1;

-- name: ListUsers :many
SELECT u.id, u.email, u.type, u.segment, u.company_name, u.phone, u.role, u.email_verified_at, u.created_at,
       (SELECT count(*) FROM reports r WHERE r.user_id = u.id)::int AS reports,
       (SELECT coalesce(sum(p.amount_rub), 0) FROM payments p WHERE p.user_id = u.id AND p.status = 'succeeded')::bigint AS paid_rub
FROM users u ORDER BY u.created_at DESC LIMIT 500;

-- name: CreateNotification :exec
INSERT INTO notifications (user_id, kind, text, link) VALUES ($1, $2, $3, $4);

-- name: ListNotifications :many
SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20;

-- name: MarkNotificationsRead :exec
UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL;
