# Multi-stage build for web application
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY web/package.json web/package-lock.json ./

# Install dependencies cleanly
RUN npm ci

# Copy web source code
COPY web/ ./

ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=$VITE_BASE_PATH

# Build production assets
RUN npm run build

# Nginx production stage
FROM nginx:alpine

# Remove default nginx static files
RUN rm -rf /usr/share/nginx/html/*

# Copy built SPA from builder stage to root and /btc
COPY --from=builder /app/dist /usr/share/nginx/html
COPY --from=builder /app/dist /usr/share/nginx/html/btc

# Copy custom nginx configuration
COPY docker/nginx.conf /etc/nginx/nginx.conf

# Create /data directory for volume mount
RUN mkdir -p /data

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
