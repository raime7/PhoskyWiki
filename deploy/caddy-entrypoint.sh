#!/bin/sh
set -eu
export CF_API_TOKEN="$(cat /run/secrets/cloudflare-dns-token)"
export CLOUDFLARE_CIDRS="$(cat /etc/caddy/cloudflare-cidrs.txt)"
test -n "$CF_API_TOKEN"
test -n "$CLOUDFLARE_CIDRS"
exec caddy "$@"
