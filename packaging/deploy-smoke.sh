#!/usr/bin/env bash
set -euo pipefail
stage=$(mktemp -d)
cp /artifacts/scorchedearth-html5_0.0.0-1_amd64.deb "$stage/package.deb"
cp /tests/install-game.sh "$stage/install-game.sh"
checksum() { (cd "$stage" && sha256sum package.deb > SHA256SUMS); }
run_installer() { bash "$stage/install-game.sh"; }
fail_installer() {
  if run_installer > /tmp/scorch-deploy-failure.log 2>&1; then
    echo 'Installer unexpectedly succeeded' >&2; exit 1
  fi
  if ! grep -q "$1" /tmp/scorch-deploy-failure.log; then
    cat /tmp/scorch-deploy-failure.log >&2
    return 1
  fi
}
cleanup() { systemctl stop scorchedearth-html5.service || true; }
trap cleanup EXIT

# Reject corrupt or wrong-architecture uploads before any installation.
printf '%064d  package.deb\n' 0 > "$stage/SHA256SUMS"
fail_installer 'package checksum mismatch'
wrong_arch=$(mktemp -d)
dpkg-deb -R "$stage/package.deb" "$wrong_arch"
sed -i 's/^Architecture: .*/Architecture: arm64/' "$wrong_arch/DEBIAN/control"
dpkg-deb -Zgzip --root-owner-group --build "$wrong_arch" "$stage/package.deb"
checksum
fail_installer 'architecture does not match'
test ! -e /opt/scorchedearth-html5
cp /artifacts/scorchedearth-html5_0.0.0-1_amd64.deb "$stage/package.deb"
checksum
run_installer

# A same-version deployment must restore files and retain custom configuration.
printf '\nPORT=4401\n' >> /etc/default/scorchedearth-html5
mv /opt/scorchedearth-html5/dist/index.html /tmp/scorch-original-index.html
run_installer
cmp /opt/scorchedearth-html5/dist/index.html /tmp/scorch-original-index.html
grep -q '^PORT=4401$' /etc/default/scorchedearth-html5
# The existing listener belongs to the game and is allowed on repeat deployment.
run_installer

# A foreign listener on the configured port must prevent installation.
systemctl stop scorchedearth-html5.service
/opt/scorchedearth-html5/node/bin/node --input-type=module -e 'import {createServer} from "node:http"; createServer().listen(4401, "127.0.0.1");' &
foreign_pid=$!
trap 'kill "$foreign_pid" 2>/dev/null || true; cleanup' EXIT
for _ in $(seq 1 100); do
  [[ -n $(ss -H -ltn 'sport = :4401') ]] && break
  sleep 0.05
done
fail_installer 'occupied by another service'
kill "$foreign_pid"
wait "$foreign_pid" || true
trap cleanup EXIT

# Upgrade with a changed package default: confold must retain the administrator's port.
upgrade=$(mktemp -d)
dpkg-deb -R "$stage/package.deb" "$upgrade"
sed -i 's/^Version: .*/Version: 0.0.0-2/' "$upgrade/DEBIAN/control"
sed -i 's/^PORT=.*/PORT=4501/' "$upgrade/etc/default/scorchedearth-html5"
dpkg-deb -Zgzip --root-owner-group --build "$upgrade" "$stage/package.deb"
checksum
run_installer
test "$(dpkg-query -W -f='${Version}' scorchedearth-html5)" = 0.0.0-2
grep -q '^PORT=4401$' /etc/default/scorchedearth-html5

# A running process alone is insufficient: require a healthy application response.
touch /tmp/scorch-deploy-unhealthy
fail_installer 'health check did not succeed within 30 seconds'
grep -q 'Container service status:' /tmp/scorch-deploy-failure.log
rm /tmp/scorch-deploy-unhealthy
run_installer
echo 'PASS: deployment install, same-version reinstall, upgrade, settings, checksum, architecture, port ownership, health failures and recovery'
