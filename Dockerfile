# Static Gifts frontend served by nginx. API URL is injected at container start.
#
# Build: docker build -t gifts-frontend ./frontend
# Run:  docker run -p 8080:80 -e GIFTS_API_BASE=https://your-api.example.com/api gifts-frontend
#
# GIFTS_API_BASE defaults to "/api" (same-origin; put a reverse proxy in front).

FROM nginx:1.27-alpine

RUN apk add --no-cache gettext

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

WORKDIR /usr/share/nginx/html
COPY index.html .
COPY css ./css/
COPY js ./js/

RUN rm -f ./js/config.js

ENTRYPOINT ["/docker-entrypoint.sh"]
