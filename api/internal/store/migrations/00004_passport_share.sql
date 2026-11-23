-- +goose Up
-- Паспорт здания: откуда год постройки и какие зоны с особыми условиями пересекают участок.
ALTER TABLE buildings
    ADD COLUMN year_source text NOT NULL DEFAULT 'user'
        CHECK (year_source IN ('osm', 'manual', 'generated', 'user')),
    ADD COLUMN zones jsonb,            -- NULL: пересечения не проверены
    ADD COLUMN zones_source text,
    ADD COLUMN zones_checked_on date,
    ADD COLUMN zones_demo boolean NOT NULL DEFAULT false;

-- Ссылка на отчёт для инвестора или банка: открывается без входа, пока владелец её не закроет.
ALTER TABLE reports
    ADD COLUMN share_token text UNIQUE,
    ADD COLUMN shared_at timestamptz;

-- +goose Down
ALTER TABLE reports DROP COLUMN shared_at, DROP COLUMN share_token;
ALTER TABLE buildings DROP COLUMN zones_demo, DROP COLUMN zones_checked_on, DROP COLUMN zones_source,
    DROP COLUMN zones, DROP COLUMN year_source;
