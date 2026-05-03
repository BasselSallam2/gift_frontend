# Static Gifts frontend served by nginx. Proxies `/api` to your backend container.
#
# Build: docker build -t gifts-frontend ./frontend
# Run:
#   docker run -p 8080:80 \
#     -e GIFTS_API_BASE=/api \
#     -e GIFTS_BACKEND_ORIGIN=http://host.docker.internal:3005 \
#     gifts-frontend
#
# - GIFTS_API_BASE: Browser API base (script config). Default: /api (same-origin).
# - GIFTS_BACKEND_ORIGIN: Upstream origin for nginx (no path). Default: http://backend:3005
# - NGINX_RESOLVER: Resolver for variable proxy_pass. Default: 127.0.0.11 (Compose embedded DNS).
#   Backend must listen on 0.0.0.0:3000; use docker-compose.yml from repo root for wiring.

FROM nginx:1.27-alpine

RUN apk add --no-cache gettext

COPY nginx.conf.template /etc/nginx/templates/default.conf.template

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

WORKDIR /usr/share/nginx/html
COPY index.html .
COPY css ./css/
COPY js ./js/

RUN rm -f ./js/config.js

ENTRYPOINT ["/docker-entrypoint.sh"]
