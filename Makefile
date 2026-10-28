.PHONY: up down seed seed-local osm sqlc dev-api dev-web test lint e2e screens

up:
	docker compose up -d --build

down:
	docker compose down

# Заполняет базу в docker compose: здания, контекст, пакеты, админ (dev).
seed:
	docker compose run --rm api seed

# То же для локально запущенного Postgres (порт 5433).
seed-local:
	cd api && SEED_DIR=../seed go run ./cmd/seed

# Перекачивает данные OSM и пересобирает seed/buildings.geojson. Нужна сеть.
osm:
	cd seed/osm && go run . -out ../buildings.geojson -cache ../../.cache/osm

sqlc:
	docker run --rm -v "$(CURDIR)/api":/src -w /src sqlc/sqlc:1.27.0 generate

dev-api:
	cd api && go run ./cmd/api

dev-web:
	cd web && npm run dev

test:
	cd api && go test ./...
	cd web && npm run typecheck

# golangci-lint должен быть собран Go ≥ 1.26: go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest
lint:
	cd api && go vet ./... && golangci-lint run ./...

e2e:
	cd web && npx playwright test

screens:
	cd web && node scripts/all-screens.mjs
