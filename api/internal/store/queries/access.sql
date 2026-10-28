-- name: ListPackages :many
SELECT * FROM packages WHERE is_active ORDER BY objects_limit NULLS LAST, months;

-- name: GetPackage :one
SELECT * FROM packages WHERE id = $1 AND is_active;

-- name: CreatePayment :one
INSERT INTO payments (user_id, package_id, amount_rub, status, provider)
VALUES ($1, $2, $3, 'pending', 'mock')
RETURNING *;

-- name: GetPaymentForUpdate :one
SELECT * FROM payments WHERE id = $1 AND user_id = $2 FOR UPDATE;

-- name: CompletePayment :exec
UPDATE payments SET status = 'succeeded', access_id = $2 WHERE id = $1;

-- name: ExpireAccesses :exec
UPDATE accesses SET status = 'expired' WHERE user_id = $1 AND status = 'active';

-- name: ExpireOverdueAccesses :exec
UPDATE accesses SET status = 'expired' WHERE status = 'active' AND ends_at <= now();

-- name: CreateAccess :one
INSERT INTO accesses (user_id, package_id, objects_limit, objects_used, starts_at, ends_at, status)
VALUES ($1, $2, $3, $4, $5, $6, 'active')
RETURNING *;

-- name: GetCurrentAccess :one
SELECT a.*, p.months
FROM accesses a JOIN packages p ON p.id = a.package_id
WHERE a.user_id = $1 AND a.status = 'active' AND a.ends_at > now()
ORDER BY a.starts_at DESC LIMIT 1;

-- name: GetAccessForUpdate :one
SELECT * FROM accesses WHERE user_id = $1 AND status = 'active' AND ends_at > now()
ORDER BY starts_at DESC LIMIT 1 FOR UPDATE;

-- name: HasAccessObject :one
SELECT EXISTS (SELECT 1 FROM access_objects WHERE access_id = $1 AND building_id = $2);

-- name: AddAccessObject :exec
INSERT INTO access_objects (access_id, building_id) VALUES ($1, $2);

-- name: IncrementObjectsUsed :exec
UPDATE accesses SET objects_used = objects_used + 1 WHERE id = $1;

-- name: CopyAccessObjects :exec
INSERT INTO access_objects (access_id, building_id, first_used_at)
SELECT @new_access::uuid, building_id, first_used_at FROM access_objects WHERE access_id = @old_access::uuid
ON CONFLICT DO NOTHING;

-- name: ListPayments :many
SELECT p.id, p.amount_rub, p.status, p.provider, p.created_at, u.email, u.company_name,
       pk.objects_limit, pk.months
FROM payments p JOIN users u ON u.id = p.user_id JOIN packages pk ON pk.id = p.package_id
ORDER BY p.created_at DESC LIMIT 500;
