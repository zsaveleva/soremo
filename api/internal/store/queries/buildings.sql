-- name: GetCityBySlug :one
SELECT id, slug, name, ST_AsGeoJSON(bbox)::text AS bbox
FROM cities WHERE slug = $1;

-- name: ListCities :many
SELECT id, slug, name,
       ST_XMin(bbox)::float8 AS min_lon, ST_YMin(bbox)::float8 AS min_lat,
       ST_XMax(bbox)::float8 AS max_lon, ST_YMax(bbox)::float8 AS max_lat
FROM cities ORDER BY id;

-- name: ListBuildingFeatures :many
SELECT b.id, b.address, b.year_built, b.original_function,
       b.area_total_m2::float8 AS area_total_m2, b.source, b.is_demo,
       ST_AsGeoJSON(b.geom, 6)::text AS geometry
FROM buildings b
WHERE b.status = 'active'
  AND b.city_id = @city_id
  AND b.geom && ST_MakeEnvelope(@min_lon::float8, @min_lat::float8, @max_lon::float8, @max_lat::float8, 4326)
  AND (sqlc.narg(year_from)::int IS NULL OR b.year_built >= sqlc.narg(year_from)::int)
  AND (sqlc.narg(year_to)::int IS NULL OR b.year_built <= sqlc.narg(year_to)::int)
  AND (sqlc.narg(area_from)::float8 IS NULL OR b.area_total_m2 >= sqlc.narg(area_from)::float8)
  AND (sqlc.narg(area_to)::float8 IS NULL OR b.area_total_m2 <= sqlc.narg(area_to)::float8)
  AND (sqlc.narg(functions)::text[] IS NULL OR b.original_function = ANY (sqlc.narg(functions)::text[]))
  AND (sqlc.narg(has_docs)::bool IS NULL OR sqlc.narg(has_docs)::bool = EXISTS (
        SELECT 1 FROM documents d WHERE d.building_id = b.id AND d.status = 'accepted'))
  AND (sqlc.narg(mine)::uuid IS NULL OR EXISTS (
        SELECT 1 FROM reports r WHERE r.building_id = b.id AND r.user_id = sqlc.narg(mine)::uuid))
ORDER BY b.id
LIMIT 5000;

-- name: ListBuildingClusters :many
SELECT count(*)::int AS n,
       ST_X(ST_Centroid(ST_Collect(b.centroid)))::float8 AS lon,
       ST_Y(ST_Centroid(ST_Collect(b.centroid)))::float8 AS lat,
       min(b.id)::bigint AS sample_id
FROM buildings b
WHERE b.status = 'active'
  AND b.city_id = @city_id
  AND b.geom && ST_MakeEnvelope(@min_lon::float8, @min_lat::float8, @max_lon::float8, @max_lat::float8, 4326)
  AND (sqlc.narg(year_from)::int IS NULL OR b.year_built >= sqlc.narg(year_from)::int)
  AND (sqlc.narg(year_to)::int IS NULL OR b.year_built <= sqlc.narg(year_to)::int)
  AND (sqlc.narg(area_from)::float8 IS NULL OR b.area_total_m2 >= sqlc.narg(area_from)::float8)
  AND (sqlc.narg(area_to)::float8 IS NULL OR b.area_total_m2 <= sqlc.narg(area_to)::float8)
  AND (sqlc.narg(functions)::text[] IS NULL OR b.original_function = ANY (sqlc.narg(functions)::text[]))
  AND (sqlc.narg(has_docs)::bool IS NULL OR sqlc.narg(has_docs)::bool = EXISTS (
        SELECT 1 FROM documents d WHERE d.building_id = b.id AND d.status = 'accepted'))
  AND (sqlc.narg(mine)::uuid IS NULL OR EXISTS (
        SELECT 1 FROM reports r WHERE r.building_id = b.id AND r.user_id = sqlc.narg(mine)::uuid))
GROUP BY ST_SnapToGrid(b.centroid, @cell_deg::float8);

-- name: GetBuilding :one
SELECT b.id, b.city_id, b.address, b.name, b.year_built, b.original_function, b.floors,
       b.area_total_m2::float8 AS area_total_m2, b.area_site_m2::float8 AS area_site_m2,
       b.area_footprint_m2::float8 AS area_footprint_m2, b.vri, b.pzz_zone, b.is_okn,
       b.legal_status, b.source, b.status, b.is_demo, b.created_by,
       ST_AsGeoJSON(b.geom, 6)::text AS geometry,
       ST_X(b.centroid)::float8 AS lon, ST_Y(b.centroid)::float8 AS lat,
       c.metro_name, c.metro_dist_m, c.transit_index, c.social_500m,
       c.commercial_density, c.business_activity
FROM buildings b
JOIN context_metrics c ON c.building_id = b.id
WHERE b.id = $1;

-- name: UpsertCity :one
INSERT INTO cities (slug, name, bbox)
VALUES (@slug, @name, ST_MakeEnvelope(@min_lon::float8, @min_lat::float8, @max_lon::float8, @max_lat::float8, 4326))
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, bbox = EXCLUDED.bbox
RETURNING id;

-- name: UpsertSeedBuilding :one
INSERT INTO buildings (city_id, osm_id, address, name, geom, centroid, year_built, original_function,
                       floors, area_total_m2, area_site_m2, area_footprint_m2, vri, pzz_zone,
                       is_okn, legal_status, source, status, is_demo)
VALUES (@city_id, @osm_id, @address, @name,
        ST_GeomFromGeoJSON(@geometry::text), ST_PointOnSurface(ST_GeomFromGeoJSON(@geometry::text)),
        @year_built, @original_function, @floors, @area_total_m2::float8, @area_site_m2::float8,
        @area_footprint_m2::float8, @vri, @pzz_zone, @is_okn, @legal_status, 'base', 'active', @is_demo)
ON CONFLICT (osm_id) DO UPDATE SET
    address = EXCLUDED.address, name = EXCLUDED.name, geom = EXCLUDED.geom, centroid = EXCLUDED.centroid,
    year_built = EXCLUDED.year_built, original_function = EXCLUDED.original_function,
    floors = EXCLUDED.floors, area_total_m2 = EXCLUDED.area_total_m2, area_site_m2 = EXCLUDED.area_site_m2,
    area_footprint_m2 = EXCLUDED.area_footprint_m2, vri = EXCLUDED.vri, pzz_zone = EXCLUDED.pzz_zone,
    is_okn = EXCLUDED.is_okn, legal_status = EXCLUDED.legal_status, is_demo = EXCLUDED.is_demo
RETURNING id;

-- name: UpsertContextMetrics :exec
INSERT INTO context_metrics (building_id, metro_name, metro_dist_m, transit_index, social_500m,
                             commercial_density, business_activity, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, now())
ON CONFLICT (building_id) DO UPDATE SET
    metro_name = EXCLUDED.metro_name, metro_dist_m = EXCLUDED.metro_dist_m,
    transit_index = EXCLUDED.transit_index, social_500m = EXCLUDED.social_500m,
    commercial_density = EXCLUDED.commercial_density, business_activity = EXCLUDED.business_activity,
    updated_at = now();

-- name: UpsertPackage :exec
INSERT INTO packages (objects_limit, months, price_rub, is_active)
VALUES ($1, $2, $3, true)
ON CONFLICT (objects_limit, months) DO UPDATE SET price_rub = EXCLUDED.price_rub, is_active = true;

-- name: UpsertAdmin :exec
INSERT INTO users (email, password_hash, email_verified_at, type, segment, role)
VALUES ($1, $2, now(), 'company', 'other', 'admin')
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin';

-- name: SetDemoSlug :exec
UPDATE buildings SET demo_slug = $2 WHERE id = $1;

-- name: GetBuildingIDByDemoSlug :one
SELECT id FROM buildings WHERE demo_slug = $1;

-- name: UpsertDemoReport :exec
INSERT INTO demo_reports (building_id, accuracy_level, engine_version, result, updated_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (building_id) DO UPDATE SET
    accuracy_level = EXCLUDED.accuracy_level, engine_version = EXCLUDED.engine_version,
    result = EXCLUDED.result, updated_at = now();

-- name: GetDemoReport :one
SELECT building_id, accuracy_level, engine_version, result, updated_at
FROM demo_reports WHERE building_id = $1;

-- name: ListDemoBuildings :many
SELECT b.id, b.address, b.name, ST_X(b.centroid)::float8 AS lon, ST_Y(b.centroid)::float8 AS lat
FROM buildings b JOIN demo_reports d ON d.building_id = b.id
ORDER BY b.id;

-- name: SearchBuildings :many
SELECT b.id, b.address, b.name, b.year_built, b.original_function, b.is_demo, b.source,
       ST_X(b.centroid)::float8 AS lon, ST_Y(b.centroid)::float8 AS lat
FROM buildings b
WHERE b.status = 'active' AND b.city_id = @city_id
  AND NOT EXISTS (
        SELECT 1 FROM unnest(@tokens::text[]) t
        WHERE replace(lower(b.address || ' ' || coalesce(b.name, '')), 'ё', 'е') NOT LIKE '%' || t || '%')
ORDER BY greatest(similarity(b.address, @q::text), similarity(coalesce(b.name, ''), @q::text)) DESC, b.address
LIMIT 8;

-- name: DocumentStatsForBuilding :one
SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
       count(*) FILTER (WHERE status = 'accepted')::int AS accepted,
       coalesce(array_agg(DISTINCT kind) FILTER (WHERE status = 'accepted'), '{}')::text[] AS accepted_kinds
FROM documents WHERE building_id = $1;

-- name: UpsertDemoUser :one
INSERT INTO users (email, password_hash, email_verified_at, type, segment, company_name, role)
VALUES ($1, $2, now(), 'company', 'investor', 'ООО «Демо-инвест»', 'user')
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, email_verified_at = coalesce(users.email_verified_at, now())
RETURNING id;

-- name: EnsureDemoAccess :exec
INSERT INTO accesses (user_id, package_id, objects_limit, objects_used, starts_at, ends_at, status)
SELECT @user_id::uuid, p.id, p.objects_limit, 0, now(), now() + make_interval(months => p.months), 'active'
FROM packages p
WHERE p.objects_limit = 25 AND p.months = 6
  AND NOT EXISTS (SELECT 1 FROM accesses a WHERE a.user_id = @user_id::uuid AND a.status = 'active' AND a.ends_at > now());
