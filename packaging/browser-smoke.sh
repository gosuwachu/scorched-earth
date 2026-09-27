#!/usr/bin/env bash
set -euo pipefail
dpkg -i /artifacts/scorchedearth-html5_0.0.0-1_amd64.deb
test_dir=$(mktemp -d)
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$test_dir/key.pem" -out "$test_dir/cert.pem" \
  -subj /CN=scorched.example.com -addext subjectAltName=DNS:scorched.example.com
# Exercise the same shared import layout as the VPS, adding only a test certificate.
mkdir "$test_dir/sites.d"
printf 'import sites.d/*.caddy\n' > "$test_dir/Caddyfile"
printf 'http://127.0.0.1:4080 {\n    respond "other application"\n}\n' > "$test_dir/sites.d/other.caddy"
sed -e 's/__SITE_DOMAIN__/scorched.example.com/g' -e "/reverse_proxy/i\    tls $test_dir/cert.pem $test_dir/key.pem" \
  /usr/share/scorchedearth-html5/caddy/scorchedearth-html5.caddy > "$test_dir/sites.d/scorchedearth-html5.caddy"
caddy validate --config "$test_dir/Caddyfile" --adapter caddyfile
runuser -u scorchedearth-html5 -- sh -c 'cd /opt/scorchedearth-html5; set -a; . /etc/default/scorchedearth-html5; exec ./node/bin/node dist-server/server/index.js' > "$test_dir/server.log" 2>&1 &
server_pid=$!
caddy run --config "$test_dir/Caddyfile" --adapter caddyfile > "$test_dir/caddy.log" 2>&1 &
caddy_pid=$!
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then cat "$test_dir/server.log" "$test_dir/caddy.log"; fi
  kill "$server_pid" "$caddy_pid" 2>/dev/null || true
  wait "$server_pid" "$caddy_pid" 2>/dev/null || true
}
trap cleanup EXIT
export NODE_EXTRA_CA_CERTS="$test_dir/cert.pem"
export ONLINE_BASE_URL=https://scorched.example.com
export ONLINE_TEST_TLS=1
node test-browser/online_production.mjs
node --input-type=module -e 'import assert from "node:assert/strict"; assert.equal(await (await fetch("http://127.0.0.1:4080")).text(), "other application");'
