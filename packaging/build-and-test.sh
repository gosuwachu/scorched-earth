#!/usr/bin/env bash
set -euo pipefail
usage() { echo 'usage: packaging/build-and-test.sh [--skip-tests]'; }
skip_tests=false
for argument in "$@"; do
  case "$argument" in
    --skip-tests) skip_tests=true ;;
    --help) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
done
cd "$(dirname "$0")/.."
# DOCKER may name a wrapper or an alternate Docker executable.
docker_cmd="${DOCKER:-docker}"
"$docker_cmd" info >/dev/null
mkdir -p artifacts
if "$skip_tests"; then
  echo 'WARNING: tests skipped; this build is not test-verified.' >&2
else
  "$docker_cmd" build --platform linux/amd64 -f packaging/Dockerfile --target verify .
fi
"$docker_cmd" build --platform linux/amd64 -f packaging/Dockerfile --target artifact \
  --output "type=local,dest=$(pwd)/artifacts" .
if "$skip_tests"; then
  (cd artifacts && sha256sum --check SHA256SUMS)
  echo 'Built package and verified checksum; tests were skipped.'
  exit 0
fi
for release in 24.04 25.04; do
  "$docker_cmd" build --platform linux/amd64 -f packaging/Dockerfile --target smoke \
    --build-arg "TEST_UBUNTU=$release" -t "scorchedearth-package-test:$release" .
  "$docker_cmd" run --rm --platform linux/amd64 --network none --cpus 4 --memory 4g --memory-swap 4g \
    --mount "type=bind,source=$(pwd)/artifacts,target=/artifacts,readonly" \
    "scorchedearth-package-test:$release"
  "$docker_cmd" build --platform linux/amd64 -f packaging/Dockerfile --target deployment-test \
    --build-arg "TEST_UBUNTU=$release" -t "scorchedearth-deployment-test:$release" .
  # ss needs permission to inspect the unprivileged service's socket ownership.
  "$docker_cmd" run --rm --init --cap-add SYS_PTRACE --platform linux/amd64 --network none --cpus 4 --memory 4g --memory-swap 4g \
    --mount "type=bind,source=$(pwd)/artifacts,target=/artifacts,readonly" \
    "scorchedearth-deployment-test:$release"
done
"$docker_cmd" build --platform linux/amd64 -f packaging/Dockerfile --target browser \
  -t scorchedearth-package-test:browser .
"$docker_cmd" run --rm --platform linux/amd64 --network none --cpus 4 --memory 4g --memory-swap 4g \
  --mount "type=bind,source=$(pwd)/artifacts,target=/artifacts,readonly" \
  --add-host scorched.example.com:127.0.0.1 scorchedearth-package-test:browser
(cd artifacts && sha256sum --check SHA256SUMS)
echo "PASS: package lifecycle and deployment installer on Ubuntu 24.04/25.04, and HTTPS multiplayer browser flow"
