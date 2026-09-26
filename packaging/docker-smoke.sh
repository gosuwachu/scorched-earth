#!/usr/bin/env bash
set -euo pipefail
package=/artifacts/scorchedearth-html5_0.0.0-1_amd64.deb
app=/opt/scorchedearth-html5
if command -v node || command -v npm; then
  echo "The clean runtime fixture must not have system Node/npm installed" >&2
  exit 1
fi
dpkg -i "$package"
test "$(dpkg-query -W -f='${Status}' scorchedearth-html5)" = 'install ok installed'
test "$("$app/node/bin/node" --version)" = v24.21.0
test -f "$app/node/LICENSE"
test -f /usr/share/scorchedearth-html5/caddy/scorchedearth-html5.caddy
test ! -d "$app/node_modules/vite"
test ! -d "$app/node_modules/typescript"
test "$(stat -c %U "$app")" = root
runuser -u scorchedearth-html5 -- test ! -w "$app"
systemd-analyze verify /usr/lib/systemd/system/scorchedearth-html5.service
test -L /etc/systemd/system/multi-user.target.wants/scorchedearth-html5.service
ldd "$app/node/bin/node"
if ldd "$app/node/bin/node" | grep -q 'not found'; then exit 1; fi
"$app/node/bin/node" /tests/package-smoke.mjs
TEST_DENY_NETLINK=1 "$app/node/bin/node" /tests/package-smoke.mjs

# A real higher-version upgrade must preserve administrator configuration.
printf '\n# retained administrator setting\nPORT=4401\n' >> /etc/default/scorchedearth-html5
dpkg -i "$package"
grep -q '^PORT=4401$' /etc/default/scorchedearth-html5
upgrade_dir=$(mktemp -d)
dpkg-deb -R "$package" "$upgrade_dir"
sed -i 's/^Version: .*/Version: 0.0.0-2/' "$upgrade_dir/DEBIAN/control"
dpkg-deb -Zgzip --root-owner-group --build "$upgrade_dir" /tmp/upgrade.deb
dpkg -i /tmp/upgrade.deb
test "$(dpkg-query -W -f='${Version}' scorchedearth-html5)" = 0.0.0-2
grep -q '^PORT=4401$' /etc/default/scorchedearth-html5
"$app/node/bin/node" /tests/package-smoke.mjs
dpkg --remove scorchedearth-html5
test -f /etc/default/scorchedearth-html5
test ! -e "$app/node/bin/node"
dpkg --purge scorchedearth-html5
test ! -e /etc/default/scorchedearth-html5
test ! -e /etc/systemd/system/multi-user.target.wants/scorchedearth-html5.service
dpkg -i "$package"
dpkg --purge scorchedearth-html5
echo "PASS: offline package install, runtime, upgrade, configuration preservation, removal and purge"
