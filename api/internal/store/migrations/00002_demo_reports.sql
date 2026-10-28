-- +goose Up
ALTER TABLE buildings ADD COLUMN demo_slug text UNIQUE;

-- Hand-written example reports for demo buildings, readable without an account.
CREATE TABLE demo_reports (
    building_id     bigint PRIMARY KEY REFERENCES buildings(id) ON DELETE CASCADE,
    accuracy_level  text NOT NULL CHECK (accuracy_level IN ('low', 'mid', 'high')),
    engine_version  text NOT NULL,
    result          jsonb NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE demo_reports;
ALTER TABLE buildings DROP COLUMN demo_slug;
