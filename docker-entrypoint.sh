#!/bin/sh
set -e
export GIFTS_API_BASE="${GIFTS_API_BASE:-/api}"
envsubst '${GIFTS_API_BASE}' < /usr/share/nginx/html/js/config.template.env.js > /usr/share/nginx/html/js/config.js
rm -f /usr/share/nginx/html/js/config.template.env.js
exec nginx -g 'daemon off;'
