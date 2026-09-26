#!/usr/bin/env bash
set -euo pipefail
source_dir="$1"
package_dir="$2"
node_dir="$3"
app="$package_dir/opt/scorchedearth-html5"
install -d "$app/node/bin" "$package_dir/DEBIAN" "$package_dir/etc/default" \
  "$package_dir/usr/lib/systemd/system" "$package_dir/usr/share/doc/scorchedearth-html5" \
  "$package_dir/usr/share/scorchedearth-html5/caddy"
cp -a "$source_dir/dist" "$source_dir/dist-server" "$source_dir/node_modules" "$app/"
install -m 644 "$source_dir/package.json" "$source_dir/package-lock.json" "$app/"
install -m 755 "$node_dir/bin/node" "$app/node/bin/node"
install -m 644 "$node_dir/LICENSE" "$app/node/LICENSE"
install -m 644 "$source_dir/README.md" "$package_dir/usr/share/doc/scorchedearth-html5/README.md"
# Minimal Ubuntu images can exclude /usr/share/doc; this is operational config.
install -m 644 "$source_dir/deploy/caddy/scorchedearth-html5.caddy" "$package_dir/usr/share/scorchedearth-html5/caddy/scorchedearth-html5.caddy"
install -m 644 "$source_dir/deployment/scorchedearth-html5.default" "$package_dir/etc/default/scorchedearth-html5"
install -m 644 "$source_dir/deployment/scorchedearth-html5.service" "$package_dir/usr/lib/systemd/system/scorchedearth-html5.service"
install -m 644 "$source_dir/packaging/DEBIAN/control" "$source_dir/packaging/DEBIAN/conffiles" "$package_dir/DEBIAN/"
for script in postinst prerm postrm; do
  install -m 755 "$source_dir/packaging/DEBIAN/$script" "$package_dir/DEBIAN/$script"
done
du -sk "$package_dir/opt" | awk '{print "Installed-Size: " $1}' >> "$package_dir/DEBIAN/control"
