#!/bin/bash
# Deploy only this application's site to an already provisioned shared proxy.
set -euo pipefail
[[ $# -le 1 ]] || { echo 'usage: deploy-caddy.sh [ssh-target]' >&2; exit 1; }
target=${1-root@shopping}
[[ $target != -* && -n $target ]] || { echo 'invalid SSH target' >&2; exit 1; }
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

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
fi' < "$project_dir/deploy/caddy/scorchedearth-html5.caddy"
