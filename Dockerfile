# Static Gifts frontend — nginx serves the SPA and optionally reverse-proxies `/api` to Express.
#
# Build: docker build -t gifts-frontend ./frontend
#
# ── Docker Compose / one private network (same as repo docker-compose.yml): ──
#   GIFTS_API_BASE=/api
#   GIFTS_BACKEND_ORIGIN=http://backend:3005   # service name + container PORT
# Resolver is auto-detected from /etc/resolv.conf (works on Coolify, not only 127.0.0.11).
#
# ── Coolify: separate public apps (frontend URL ≠ backend URL): ──
#   GIFTS_API_PROXY_ENABLED=false
#   GIFTS_API_BASE=https://YOUR-BACKEND-PUBLIC-URL/api
# (Browser calls the backend directly; nginx does not proxy.)
#
# ── Coolify: unified project, internal DNS: ──
#   Set GIFTS_BACKEND_ORIGIN to the internal URL Coolify shows for the API container
#   (often http://SERVICE_NAME:3005), not necessarily "backend".

FROM nginx:1.27-alpine

RUN apk add --no-cache gettext

COPY nginx-proxy.conf.template /etc/nginx/templates/nginx-proxy.conf.template
COPY nginx-static.conf.template /etc/nginx/templates/nginx-static.conf.template

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

WORKDIR /usr/share/nginx/html
COPY index.html .
COPY css ./css/
COPY js ./js/

RUN rm -f ./js/config.js

ENTRYPOINT ["/docker-entrypoint.sh"]
