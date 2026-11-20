FROM python:3.12-slim

# Install system dependencies & supercronic
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install supercronic (cron for containers)
ENV SUPERCRONIC_URL=https://github.com/aptible/supercronic/releases/download/v0.2.33/supercronic-linux-amd64 \
    SUPERCRONIC=supercronic-linux-amd64 \
    SUPERCRONIC_SHA1SUM=71b0d58cc53f6bd72cf2f293e09e294b79c666d8

RUN curl -fsSLO "$SUPERCRONIC_URL" \
    && echo "${SUPERCRONIC_SHA1SUM}  ${SUPERCRONIC}" | sha1sum -c - \
    && chmod +x "$SUPERCRONIC" \
    && mv "$SUPERCRONIC" /usr/local/bin/supercronic

WORKDIR /app

# Git commit SHA build argument
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

# Non-root user setup
RUN useradd -m -u 1000 appuser && \
    mkdir -p /data && \
    chown -R appuser:appuser /app /data

# Install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code and config
COPY pipeline/ ./pipeline/
COPY docker/crontab /etc/crontab
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN sed -i 's/\r$//' /app/entrypoint.sh /etc/crontab && \
    chmod +x /app/entrypoint.sh /etc/crontab && \
    chown -R appuser:appuser /app

VOLUME ["/data"]

ENTRYPOINT ["/app/entrypoint.sh"]
