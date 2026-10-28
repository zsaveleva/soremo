-- +goose Up
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE cities (
    id          serial PRIMARY KEY,
    slug        text NOT NULL UNIQUE,
    name        text NOT NULL,
    bbox        geometry(Polygon, 4326) NOT NULL
);

CREATE TABLE users (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email              text NOT NULL UNIQUE,
    password_hash      text NOT NULL,
    email_verified_at  timestamptz,
    type               text NOT NULL CHECK (type IN ('individual', 'company')),
    segment            text NOT NULL CHECK (segment IN ('owner', 'investor', 'consultant', 'government', 'other')),
    company_name       text,
    phone              text,
    role               text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE buildings (
    id                 bigserial PRIMARY KEY,
    city_id            int NOT NULL REFERENCES cities(id),
    osm_id             bigint UNIQUE,
    address            text NOT NULL,
    name               text,
    geom               geometry(Polygon, 4326) NOT NULL,
    centroid           geometry(Point, 4326) NOT NULL,
    year_built         int NOT NULL CHECK (year_built BETWEEN 1800 AND 2100),
    original_function  text NOT NULL CHECK (original_function IN
                         ('industrial', 'warehouse', 'culture', 'administrative', 'research', 'retail', 'sport', 'other')),
    floors             int NOT NULL CHECK (floors > 0),
    area_total_m2      numeric(12, 1) NOT NULL,
    area_site_m2       numeric(12, 1) NOT NULL,
    area_footprint_m2  numeric(12, 1) NOT NULL,
    vri                text NOT NULL,
    pzz_zone           text NOT NULL,
    is_okn             boolean NOT NULL DEFAULT false,
    legal_status       text NOT NULL,
    source             text NOT NULL DEFAULT 'base' CHECK (source IN ('base', 'user')),
    status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'rejected')),
    is_demo            boolean NOT NULL DEFAULT false,
    created_by         uuid REFERENCES users(id),
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX buildings_geom_idx ON buildings USING gist (geom);
CREATE INDEX buildings_centroid_idx ON buildings USING gist (centroid);
CREATE INDEX buildings_address_trgm_idx ON buildings USING gin (address gin_trgm_ops);
CREATE INDEX buildings_city_status_idx ON buildings (city_id, status);

CREATE TABLE context_metrics (
    building_id         bigint PRIMARY KEY REFERENCES buildings(id) ON DELETE CASCADE,
    metro_name          text NOT NULL,
    metro_dist_m        int NOT NULL,
    transit_index       int NOT NULL CHECK (transit_index BETWEEN 0 AND 100),
    social_500m         int NOT NULL,
    commercial_density  int NOT NULL CHECK (commercial_density BETWEEN 0 AND 100),
    business_activity   int NOT NULL CHECK (business_activity BETWEEN 0 AND 100),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE packages (
    id             serial PRIMARY KEY,
    objects_limit  int,          -- NULL = все объекты
    months         int NOT NULL,
    price_rub      bigint NOT NULL,
    is_active      boolean NOT NULL DEFAULT true,
    UNIQUE (objects_limit, months)
);

CREATE TABLE accesses (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES users(id),
    package_id     int NOT NULL REFERENCES packages(id),
    objects_limit  int,
    objects_used   int NOT NULL DEFAULT 0,
    starts_at      timestamptz NOT NULL,
    ends_at        timestamptz NOT NULL,
    status         text NOT NULL CHECK (status IN ('active', 'expired'))
);
CREATE INDEX accesses_user_idx ON accesses (user_id, status);

CREATE TABLE access_objects (
    access_id      uuid NOT NULL REFERENCES accesses(id),
    building_id    bigint NOT NULL REFERENCES buildings(id),
    first_used_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (access_id, building_id)
);

CREATE TABLE payments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id),
    package_id  int NOT NULL REFERENCES packages(id),
    access_id   uuid REFERENCES accesses(id),
    amount_rub  bigint NOT NULL,
    status      text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
    provider    text NOT NULL DEFAULT 'mock',
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id     bigint NOT NULL REFERENCES buildings(id),
    user_id         uuid NOT NULL REFERENCES users(id),
    kind            text NOT NULL CHECK (kind IN ('survey', 'expertise', 'other')),
    issued_on       date NOT NULL,
    file_key        text NOT NULL,
    file_name       text NOT NULL,
    mime            text NOT NULL,
    size            bigint NOT NULL,
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    review_comment  text,
    reviewed_by     uuid REFERENCES users(id),
    reviewed_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_building_idx ON documents (building_id, status);

CREATE TABLE reports (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id     bigint NOT NULL REFERENCES buildings(id),
    user_id         uuid NOT NULL REFERENCES users(id),
    access_id       uuid REFERENCES accesses(id),
    accuracy_level  text NOT NULL CHECK (accuracy_level IN ('low', 'mid', 'high')),
    engine_version  text NOT NULL,
    input_snapshot  jsonb NOT NULL,
    result          jsonb,
    status          text NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
    pdf_key         text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz
);
CREATE INDEX reports_user_building_idx ON reports (user_id, building_id, created_at DESC);

CREATE TABLE object_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id),
    building_id     bigint NOT NULL REFERENCES buildings(id),
    comment         text,
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    review_comment  text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
    id          bigserial PRIMARY KEY,
    kind        text NOT NULL,
    payload     jsonb NOT NULL,
    run_at      timestamptz NOT NULL DEFAULT now(),
    attempts    int NOT NULL DEFAULT 0,
    locked_at   timestamptz,
    done_at     timestamptz,
    last_error  text
);
CREATE INDEX jobs_pending_idx ON jobs (run_at) WHERE done_at IS NULL;

-- +goose Down
DROP TABLE jobs, object_requests, reports, documents, payments, access_objects,
           accesses, packages, context_metrics, buildings, users, cities;
