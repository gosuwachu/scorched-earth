#!/bin/bash
# Deploy only this application's site to an already provisioned shared proxy.
set -euo pipefail
usage() { echo 'usage: deploy-caddy.sh <ssh-target> <domain>'; }
if [[ $# -eq 1 && $1 == --help ]]; then usage; exit 0; fi
[[ $# -eq 2 ]] || { usage >&2; exit 1; }
target=$1
domain=$2
[[ $target != -* && -n $target && $target != *[[:space:]]* ]] || { echo 'invalid SSH target' >&2; exit 1; }
# Restrict substitution to a DNS hostname, excluding Caddy syntax and sed metacharacters.
label='[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?'
[[ ${#domain} -le 253 && $domain =~ ^$label(\.$label)+$ && ! $domain =~ ^[0-9.]+$ ]] || {
    echo 'invalid domain: expected a DNS hostname such as scorched.example.com' >&2; exit 1;
}
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
site=$(sed "s/__SITE_DOMAIN__/$domain/g" "$project_dir/deploy/caddy/scorchedearth-html5.caddy")

# Configuration travels on stdin, never as remote shell code.
ssh -- "$target" 'set -eu
upload=$(mktemp /tmp/caddy-upload.XXXXXXXX)
trap '\''rm -f "$upload"'\'' EXIT
trap '\''exit 1'\'' HUP INT TERM
cat > "$upload"
if [ "$(id -u)" -eq 0 ]; then
    /usr/local/sbin/caddy-config deploy scorchedearth-html5 "$upload"
else
    sudo -n /usr/local/sbin/caddy-config deploy scorchedearth-html5 "$upload"
fi' <<< "$site"
