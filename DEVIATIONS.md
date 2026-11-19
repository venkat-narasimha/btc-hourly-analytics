# DEVIATIONS.md — Deviations from PLAN.md

This file documents any departures from the PLAN.md specification, with rationale.

## DEV-001: `uv` → `venv + pip` for local development
- **What**: PLAN.md specifies `uv`-managed Python with `uv.lock`. `uv` is not installed on this system.
- **Why**: `uv` is not available; installing it requires elevated permissions the user has not granted.
- **Alternative**: Standard `python -m venv` + `pip` with `requirements.txt` and `requirements-dev.txt` (pinned). Docker images use `pip install` as well. Functionally equivalent for dependency management.
- **Impact**: `uv.lock` replaced by `requirements.txt` / `requirements-dev.txt`. Makefile targets adjusted.

## DEV-002: `docker compose` subcommand → `docker-compose` v1 CLI
- **What**: PLAN.md references `docker compose` (v2 plugin syntax). The system has `docker-compose` (Compose v5.7.0 standalone).
- **Why**: Docker on this machine exposes `docker-compose` but not the `docker compose` plugin alias.
- **Alternative**: Use `docker-compose` command. Compose file format is identical. README documents both.
- **Impact**: None to functionality; `Makefile` and docs use `docker-compose`.
