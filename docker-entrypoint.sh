#!/bin/sh
set -e


# -----------------------------------------------------------------------------
# js/config.js: regenerate only when GIFTS_API_BASE is explicitly set (non-empty).
# If unset → use baked-in frontend/js/config.js from the image (Coolify separate API URL).
# Docker Compose passes GIFTS_API_BASE=/api → same-origin requests + nginx proxy works.
# -----------------------------------------------------------------------------
GIFTS_BACKEND_ORIGIN=$(printf '%s' "${GIFTS_BACKEND_ORIGIN:-http://backend:3005}" | sed 's#/\+$##')
export GIFTS_BACKEND_ORIGIN

if [ "${GIFTS_API_BASE:+n}" ]; then
    GIFTS_API_BASE="${GIFTS_API_BASE:-/api}"
    export GIFTS_API_BASE
    envsubst '${GIFTS_API_BASE}' < /usr/share/nginx/html/js/config.template.env.js >/usr/share/nginx/html/js/config.js
fi
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
    CONFIG_JS="/usr/share/nginx/html/js/config.js"
    eff=$(sed -n 's/.*API_BASE:[[:space:]]*"\([^"]*\)".*/\1/p' "$CONFIG_JS" | head -n 1)
    case "$eff" in
        http://* | https://*) ;;
        *)
            printf '%s\n' "gifts-frontend: GIFTS_API_PROXY_ENABLED is off — API_BASE in ${CONFIG_JS} must be absolute (http/https), got '${eff}'. Set frontend/js/config.js or pass GIFTS_API_BASE." >&2
            exit 1
            ;;
    esac
    cp /etc/nginx/templates/nginx-static.conf.template /etc/nginx/conf.d/default.conf
else
    envsubst '${GIFTS_BACKEND_ORIGIN} ${NGINX_RESOLVER}' < /etc/nginx/templates/nginx-proxy.conf.template >/etc/nginx/conf.d/default.conf
fi

exec nginx -g 'daemon off;'
