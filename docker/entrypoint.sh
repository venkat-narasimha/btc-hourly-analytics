#!/bin/sh
set -e

echo "[ETL Container] Running initial synchronous ETL pipeline..."
python -m pipeline.run --out /data

echo "[ETL Container] Initial ETL complete. Starting supercronic daemon..."
exec supercronic /etc/crontab
