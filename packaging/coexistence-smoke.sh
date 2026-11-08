#!/usr/bin/env bash
# Run in the clean packaging smoke image with both releases mounted in /releases.
set -euo pipefail
classic=/opt/scorchedearth-html5
modern=/opt/scorchedearth-modern
classic_pid=
modern_pid=
cleanup() {
  [[ -z $modern_pid ]] || kill "$modern_pid" 2>/dev/null || true
  [[ -z $classic_pid ]] || kill "$classic_pid" 2>/dev/null || true
}
trap cleanup EXIT
snapshot_classic() {
  find "$classic" /etc/default/scorchedearth-html5 /usr/lib/systemd/system/scorchedearth-html5.service -type f -exec sha256sum {} + | sort
}
health() {
  for _ in $(seq 1 100); do
    if curl -fsS "http://127.0.0.1:$1/api/lan" >/dev/null; then return; fi
    sleep 0.1
  done
  return 1
}
dpkg -i /releases/classic.deb
snapshot_classic > /tmp/classic-before
(cd "$classic" && HOST=127.0.0.1 PORT=4001 exec ./node/bin/node dist-server/server/index.js) &
classic_pid=$!
health 4001
dpkg -i /releases/modern.deb
(cd "$modern" && HOST=127.0.0.1 PORT=4002 exec ./node/bin/node dist-server/server/index.js) &
modern_pid=$!
health 4002
health 4001
kill "$modern_pid"
wait "$modern_pid" || true
modern_pid=
# Upgrade and purge modern while classic continues serving the original files.
upgrade=$(mktemp -d)
dpkg-deb -R /releases/modern.deb "$upgrade"
version=$(dpkg-deb -f /releases/modern.deb Version)
sed -i "s/^Version: .*/Version: $version.1/" "$upgrade/DEBIAN/control"
dpkg-deb --root-owner-group --build "$upgrade" /tmp/modern-upgrade.deb
dpkg -i /tmp/modern-upgrade.deb
dpkg --purge scorchedearth-modern
snapshot_classic > /tmp/classic-after
cmp /tmp/classic-before /tmp/classic-after
kill -0 "$classic_pid"
health 4001
test ! -e "$modern"
echo 'PASS: installing, upgrading and purging modern preserves classic files and live process'
