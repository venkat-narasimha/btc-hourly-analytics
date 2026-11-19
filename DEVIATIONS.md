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

## DEV-003: `hyparquet` package version pinned to `1.33.1`
- **What**: PLAN.md §4 specifies `hyparquet` without exact minor version or mentions 1.7.1 in initial drafts.
- **Why**: Version `1.7.1` is not published on npm registry; the stable version published is `1.33.1`.
- **Alternative**: Pinned `hyparquet` to `1.33.1`.
- **Impact**: Fully compatible with zero dependencies; Promise-based API `parquetReadObjects({ file })` operates directly.

## DEV-004: All downloaded Binance UM futures files use millisecond timestamps
- **What**: PLAN.md §3 Gotcha 1 noted that files from 2025-01-01 onwards may use microseconds (`> 1e14`).
- **Why**: In runtime ingestion across 82 monthly and 18 daily files (through 2026-11), all timestamps encountered were <= 10^14 (standard millisecond epoch timestamps).
- **Alternative**: Keep runtime auto-detection threshold logic active in `normalize_timestamp()` and record stats in quality report (`files_ms: 100, files_us: 0`).
- **Impact**: Zero rows required microsecond division, but handling remains in place if future archives switch.
