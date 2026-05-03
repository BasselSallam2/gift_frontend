# Static Gifts frontend — nginx serves the SPA and optionally reverse-proxies `/api` to Express.
#
# Build: docker build -t gifts-frontend ./frontend
#
# API URL (js/config.js):
# • Coolify omit GIFTS_API_BASE → image uses the frontend/js/config.js committed in Git (your full backend URL).
# • Docker Compose typically sets GIFTS_API_BASE=/api to regenerate config for same-origin + proxy.
#
# ── Docker Compose / same network (repo docker-compose.yml): ──
#   GIFTS_API_BASE=/api
#   GIFTS_BACKEND_ORIGIN=http://backend:3005   # Express container + port (3005)
#
# ── Split Coolify apps (different public hostnames): ──
#   GIFTS_API_PROXY_ENABLED=false — browser calls baked-in API_BASE (no nginx /api proxy)
#   or set GIFTS_API_BASE=http://YOUR-API.sslip.io/api to override config at startup.
#
# ── Resolver is auto-detected from /etc/resolv.conf ──

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

ENTRYPOINT ["/docker-entrypoint.sh"]
