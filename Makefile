.PHONY: setup data dev build test lint up down refresh clean

# Python venv setup + web deps
setup:
	python -m venv .venv
	.venv/Scripts/pip install -r requirements-dev.txt
	cd web && npm ci

# Run ETL pipeline
data:
	.venv/Scripts/python -m pipeline.run --out ./artifacts

# Start dev servers
dev:
	cd web && npm run dev

# Build web app
build:
	cd web && npm run build

# Run all tests
test:
	.venv/Scripts/python -m pytest pipeline/tests/ -v
	cd web && npm test -- --run

# Lint all code
lint:
	.venv/Scripts/python -m ruff check pipeline/
	cd web && npm run lint

# Docker compose up
up:
	docker-compose up --build

# Docker compose down
down:
	docker-compose down

# Force ETL refresh
refresh:
	docker-compose exec etl python -m pipeline.run --out /data

# Clean artifacts
clean:
	rm -rf artifacts/ .venv/ web/node_modules/ web/dist/
