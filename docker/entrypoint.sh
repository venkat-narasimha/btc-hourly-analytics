#!/bin/sh
set -e

# Ensure volume /data has permissions for appuser
mkdir -p /data
chown -R appuser:appuser /data 2>/dev/null || true

echo "[ETL Container] Running initial synchronous ETL pipeline as appuser..."
su -s /bin/sh appuser -c "python -m pipeline.run --out /data"

echo "[ETL Container] Initial ETL complete. Starting supercronic daemon as appuser..."
exec su -s /bin/sh appuser -c "exec supercronic /etc/crontab"
