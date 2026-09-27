#!/usr/bin/env bash
# Build, verify, and install the game. Caddy is deployed independently.
set -euo pipefail
usage() { echo 'usage: deploy.sh [--skip-tests] <ssh-target>'; }
target=
target_set=false
build_args=()
for argument in "$@"; do
  case "$argument" in
    --skip-tests) build_args=(--skip-tests) ;;
    --help) usage; exit 0 ;;
    -*) usage >&2; exit 1 ;;
    *)
      if "$target_set"; then usage >&2; exit 1; fi
      target=$argument
      target_set=true
      ;;
  esac
done
"$target_set" || { usage >&2; exit 1; }
[[ -n $target && $target != -* && $target != *[[:space:]]* ]] || { echo 'invalid SSH target' >&2; exit 1; }
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for command in ssh tar sha256sum awk; do command -v "$command" >/dev/null; done

echo '[1/4] Checking SSH access and installation privileges...'
ssh -o BatchMode=yes -o ConnectTimeout=10 -- "$target" 'set -eu
command -v bash tar sha256sum apt-get dpkg-deb systemctl ss >/dev/null
if [ "$(id -u)" -ne 0 ]; then sudo -n true; fi'

if ((${#build_args[@]})); then
  echo '[2/4] Building the package in Docker (tests skipped)...'
else
  echo '[2/4] Building and testing the package in Docker...'
fi
bash "$project_dir/packaging/build-and-test.sh" "${build_args[@]}"
control="$project_dir/packaging/DEBIAN/control"
name=$(awk '$1 == "Package:" {print $2}' "$control")
version=$(awk '$1 == "Version:" {print $2}' "$control")
architecture=$(awk '$1 == "Architecture:" {print $2}' "$control")
[[ $name == scorchedearth-html5 && $version =~ ^[0-9][0-9A-Za-z.+:~-]*$ && $architecture =~ ^[a-z0-9]+$ ]] || {
  echo 'Invalid package metadata' >&2; exit 1;
}
filename="${name}_${version}_${architecture}.deb"
artifact="$project_dir/artifacts/$filename"
expected=$(awk -v file="$filename" '$2 == file {print $1}' "$project_dir/artifacts/SHA256SUMS")
[[ $expected =~ ^[0-9a-f]{64}$ && -f $artifact ]] || { echo 'Missing package or checksum' >&2; exit 1; }
actual=$(sha256sum "$artifact")
[[ ${actual%% *} == "$expected" ]] || { echo 'Local package checksum mismatch' >&2; exit 1; }

# Snapshot exactly the verified artifact; do not upload a concurrently replaced build.
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
trap 'exit 1' HUP INT TERM
cp -- "$artifact" "$stage/package.deb"
printf '%s  package.deb\n' "$expected" > "$stage/SHA256SUMS"
cp -- "$project_dir/deploy/install-game.sh" "$stage/install-game.sh"
(cd "$stage" && sha256sum --check SHA256SUMS)

echo "[3/4] Uploading and installing $filename on $target..."
echo 'Installation restarts the game service and interrupts active matches.'
tar -C "$stage" -cf - package.deb SHA256SUMS install-game.sh | \
  ssh -o BatchMode=yes -o ConnectTimeout=10 -- "$target" 'set -eu
upload=$(mktemp -d /tmp/scorchedearth-deploy.XXXXXXXX)
trap '\''rm -rf -- "$upload"'\'' EXIT
trap '\''exit 1'\'' HUP INT TERM
# Uploaded files must belong to the SSH account, not UIDs from the workstation.
tar --no-same-owner --no-same-permissions -xf - -C "$upload"
# Permit the unprivileged apt download account to read this non-secret upload.
chmod 755 "$upload"
chmod 644 "$upload/package.deb" "$upload/SHA256SUMS" "$upload/install-game.sh"
if [ "$(id -u)" -eq 0 ]; then
    bash "$upload/install-game.sh"
else
    sudo -n bash "$upload/install-game.sh"
fi'
echo "[4/4] Deployment verified on $target."
echo 'To deploy the HTTPS site separately, run ./deploy-caddy.sh <ssh-target> <domain> with the same SSH target.'
