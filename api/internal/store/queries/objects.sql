-- name: CreatePendingBuilding :one
INSERT INTO buildings (city_id, address, geom, centroid, year_built, original_function, floors,
                       area_total_m2, area_site_m2, area_footprint_m2, vri, pzz_zone, is_okn, legal_status,
                       source, status, created_by)
VALUES (@city_id, @address,
        -- Пользователь ставит точку; контур — квадрат по площади застройки до уточнения модератором.
        ST_Buffer(ST_SetSRID(ST_MakePoint(@lon::float8, @lat::float8), 4326)::geography, sqrt(@footprint::float8) / 2, 'quad_segs=1 endcap=square')::geometry,
        ST_SetSRID(ST_MakePoint(@lon::float8, @lat::float8), 4326),
        @year_built, @original_function, @floors, @area_total::float8, @area_site::float8, @footprint::float8,
        'Нет данных', 'Нет данных', false, 'Нет данных в открытых источниках', 'user', 'pending', @created_by)
RETURNING id;

-- name: CreateObjectRequest :one
INSERT INTO object_requests (user_id, building_id, comment) VALUES ($1, $2, $3) RETURNING *;

-- name: ListMyObjectRequests :many
SELECT o.*, b.address FROM object_requests o JOIN buildings b ON b.id = o.building_id
WHERE o.user_id = $1 ORDER BY o.created_at DESC;

-- name: ListObjectRequests :many
SELECT o.*, b.address, b.year_built, b.original_function, b.floors, b.area_total_m2::float8 AS area_total_m2,
       ST_X(b.centroid)::float8 AS lon, ST_Y(b.centroid)::float8 AS lat, u.email, u.company_name
FROM object_requests o JOIN buildings b ON b.id = o.building_id JOIN users u ON u.id = o.user_id
WHERE (sqlc.narg(status)::text IS NULL OR o.status = sqlc.narg(status)::text)
ORDER BY (o.status = 'pending') DESC, o.created_at DESC LIMIT 500;

-- name: ReviewObjectRequest :one
UPDATE object_requests SET status = $2, review_comment = $3 WHERE id = $1 AND status = 'pending' RETURNING *;

-- name: SetBuildingStatus :exec
UPDATE buildings SET status = $2 WHERE id = $1;

-- name: UpsertEstimatedContext :exec
-- Контекст для добавленного объекта: ближайший объект базы как оценка до пересчёта метрик.
INSERT INTO context_metrics (building_id, metro_name, metro_dist_m, transit_index, social_500m, commercial_density, business_activity)
SELECT @building_id::bigint, c.metro_name, c.metro_dist_m, c.transit_index, c.social_500m, c.commercial_density, c.business_activity
FROM context_metrics c JOIN buildings n ON n.id = c.building_id
WHERE n.id <> @building_id::bigint AND n.source = 'base'
ORDER BY n.centroid <-> (SELECT centroid FROM buildings WHERE id = @building_id::bigint)
LIMIT 1
ON CONFLICT (building_id) DO NOTHING;
