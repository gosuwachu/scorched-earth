#!/usr/bin/env bash
# Runs as root on the destination, beside package.deb and its SHA256SUMS.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
unit=scorchedearth-html5.service
app=/opt/scorchedearth-html5
upload=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
die() { echo "Game deployment: $*" >&2; exit 1; }
[[ $EUID == 0 ]] || die 'run the installer as root or with sudo'
install_started=false
diagnostics() {
  result=$?
  if [[ $result -ne 0 ]] && $install_started; then
    systemctl status "$unit" --no-pager >&2 || true
    journalctl -u "$unit" -n 40 --no-pager >&2 || true
  fi
}
trap diagnostics EXIT
trap 'exit 1' HUP INT TERM
# shellcheck disable=SC1091
source /etc/os-release
[[ $ID == ubuntu ]] || die 'the destination must run Ubuntu'
cd "$upload"
[[ -f package.deb && -f SHA256SUMS ]] || die 'the package upload is incomplete'
sha256sum --check --strict SHA256SUMS || die 'package checksum mismatch'
[[ $(dpkg-deb -f package.deb Package) == scorchedearth-html5 ]] || die 'unexpected package name'
[[ $(dpkg-deb -f package.deb Architecture) == "$(dpkg --print-architecture)" ]] || die 'package architecture does not match the VPS'
version=$(dpkg-deb -f package.deb Version)

# This root-owned file uses shell-compatible assignments, as does /etc/default.
HOST=127.0.0.1
PORT=4001
if [[ -f /etc/default/scorchedearth-html5 ]]; then
  # shellcheck disable=SC1091
  source /etc/default/scorchedearth-html5
fi
[[ $PORT =~ ^[0-9]+$ && ${#PORT} -le 5 ]] || die 'invalid configured PORT'
port=$((10#$PORT))
(( port >= 1 && port <= 65535 )) || die 'invalid configured PORT'
[[ -n $HOST ]] || die 'invalid configured HOST'
main_pid=$(systemctl show --property=MainPID --value "$unit" 2>/dev/null || true)
listeners=$(ss -H -ltnp "( sport = :$port )")
if [[ -n $listeners ]]; then
  if [[ ! $main_pid =~ ^[1-9][0-9]*$ ]] || ! systemctl is-active --quiet "$unit"; then
    die "port $port is occupied by another service"
  fi
  while IFS= read -r listener; do
    pids=$(grep -oE 'pid=[0-9]+' <<< "$listener") || die "cannot identify the listener on port $port"
    while IFS= read -r pid; do
      [[ $pid == "pid=$main_pid" ]] || die "port $port is occupied by another service"
    done <<< "$pids"
  done <<< "$listeners"
fi

install_started=true
DEBIAN_FRONTEND=noninteractive apt-get -y --no-remove --reinstall \
  -o Dpkg::Options::=--force-confold install "$upload/package.deb"
[[ $(dpkg-query -W -f='${Status}' scorchedearth-html5) == 'install ok installed' ]] || die 'package is not configured'
[[ $(dpkg-query -W -f='${Version}' scorchedearth-html5) == "$version" ]] || die 'installed version differs from the uploaded package'
systemctl enable "$unit"
systemctl restart "$unit"

# Read settings again after apt: existing conffiles are preserved on upgrades.
HOST=127.0.0.1
PORT=4001
# shellcheck disable=SC1091
source /etc/default/scorchedearth-html5
"$app/node/bin/node" --input-type=module - "$HOST" "$PORT" <<'JS'
import { setTimeout as pause } from "node:timers/promises";
let [host, port] = process.argv.slice(2);
if (host === "0.0.0.0") host = "127.0.0.1";
if (host === "::") host = "::1";
const url = `http://${host.includes(":") ? `[${host}]` : host}:${port}/api/lan`;
const deadline = Date.now() + 30_000;
let healthy = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(1500, deadline - Date.now()))) });
    if (response.ok && Array.isArray((await response.json()).urls)) { healthy = true; break; }
  } catch { /* service is starting */ }
  await pause(Math.min(250, Math.max(0, deadline - Date.now())));
}
if (!healthy) {
  console.error(`Game health check did not succeed within 30 seconds: ${url}`);
  process.exit(1);
}
console.log(`Game health check passed: ${url}`);
JS
systemctl is-active --quiet "$unit" || die 'game service is not active'
echo "Verified scorchedearth-html5 $version is installed and running."
