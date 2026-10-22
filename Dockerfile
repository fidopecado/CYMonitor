# syntax=docker/dockerfile:1
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="CYD Monitor web demo"
LABEL org.opencontainers.image.description="Static portfolio site and ESP32 CYD interface recreation"

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY web/ /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
