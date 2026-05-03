#!/bin/sh
set -e
export GIFTS_API_BASE="${GIFTS_API_BASE:-/api}"
export GIFTS_BACKEND_ORIGIN="${GIFTS_BACKEND_ORIGIN:-http://backend:3005}"
export NGINX_RESOLVER="${NGINX_RESOLVER:-127.0.0.11}"

envsubst '${GIFTS_API_BASE}' < /usr/share/nginx/html/js/config.template.env.js > /usr/share/nginx/html/js/config.js
rm -f /usr/share/nginx/html/js/config.template.env.js

envsubst '${GIFTS_BACKEND_ORIGIN} ${NGINX_RESOLVER}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
