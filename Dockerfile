# Static Gifts frontend served by nginx. Proxies `/api` to your backend container.
#
# Build: docker build -t gifts-frontend ./frontend
# Run:
#   docker run -p 8080:80 \
#     -e GIFTS_API_BASE=/api \
#     -e GIFTS_BACKEND_ORIGIN=http://host.docker.internal:3000 \
#     gifts-frontend
#
# - GIFTS_API_BASE: Browser API base URL (script config). Default: /api (same-origin).
# - GIFTS_BACKEND_ORIGIN: Where nginx proxies /api (Express). Default: http://backend:3000
#   (Docker Compose service name). Override if your Node service hostname differs.

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
