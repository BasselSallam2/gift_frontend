#!/bin/sh
set -e

export GIFTS_API_BASE="${GIFTS_API_BASE:-/api}"

# Upstream Express (scheme + host + port, NO path suffix). Compose default hostname "backend".
GIFTS_BACKEND_ORIGIN=$(printf '%s' "${GIFTS_BACKEND_ORIGIN:-http://backend:3005}" | sed 's#/\+$##')
export GIFTS_BACKEND_ORIGIN

envsubst '${GIFTS_API_BASE}' < /usr/share/nginx/html/js/config.template.env.js > /usr/share/nginx/html/js/config.js
rm -f /usr/share/nginx/html/js/config.template.env.js

# -----------------------------------------------------------------------------
# nginx resolver for variable proxy_pass: must use Docker / platform embedded DNS when
# available (never use only the host's first public DNS — it cannot resolve service names → 502).
# Override anytime with NGINX_RESOLVER env.
# -----------------------------------------------------------------------------
if [ -z "${NGINX_RESOLVER:-}" ]; then
    if [ ! -r /etc/resolv.conf ]; then
        NGINX_RESOLVER=127.0.0.11
    else
        NGINX_RESOLVER=$(
            awk '
                /^nameserver[[:space:]]+/ {
                    ip = $2
                    if (ip == "127.0.0.11") { docker_ns = ip }
                    if (ip ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ && first_ipv4 == "") first_ipv4 = ip
                    if (any == "") any = ip
                }
                END {
                    if (docker_ns != "") print docker_ns
                    else if (first_ipv4 != "") print first_ipv4
                    else if (any != "") print any
                    else print "127.0.0.11"
                }
            ' /etc/resolv.conf
        )
        [ -z "$NGINX_RESOLVER" ] && NGINX_RESOLVER=127.0.0.11
    fi
fi
export NGINX_RESOLVER

# -----------------------------------------------------------------------------
# Split Coolify / multi-app deployments: frontend & API are separate public URLs —
# disable nginx proxy (browser calls GIFTS_API_BASE directly; must be https?://host…/api)
# -----------------------------------------------------------------------------
PROXY_LOWER=$(printf '%s' "${GIFTS_API_PROXY_ENABLED:-true}" | tr '[:upper:]' '[:lower:]')
DISABLE_PROXY=""
case "$PROXY_LOWER" in 0|false|no|off) DISABLE_PROXY=1 ;; esac

if [ -n "$DISABLE_PROXY" ]; then
    case "${GIFTS_API_BASE}" in
        http://* | https://*) ;;
        *)
            printf '%s\n' "gifts-frontend: GIFTS_API_PROXY_ENABLED is off — GIFTS_API_BASE must be an absolute backend URL (e.g. https://YOUR-API-HOST/api), not '${GIFTS_API_BASE}'." >&2
            exit 1
            ;;
    esac
    cp /etc/nginx/templates/nginx-static.conf.template /etc/nginx/conf.d/default.conf
else
    envsubst '${GIFTS_BACKEND_ORIGIN} ${NGINX_RESOLVER}' < /etc/nginx/templates/nginx-proxy.conf.template >/etc/nginx/conf.d/default.conf
fi

exec nginx -g 'daemon off;'
