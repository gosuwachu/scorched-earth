#!/usr/bin/env bash
# Dispatch an explicit variant through an isolated copy of the deployment templates.
# Sourced by entrypoints before they parse their original arguments.
if [[ ${1:-} == --variant ]]; then
  variant=${2:-}
  case "$variant" in
    classic) shift 2 ;;
    modern)
      shift 2
      variant_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
      # Callers may use relative entrypoint paths.
      variant_entry=$(realpath --relative-to="$variant_root" "$0")
      variant_stage=$(mktemp -d)
      trap 'rm -rf -- "$variant_stage"' EXIT
      trap 'exit 1' HUP INT TERM
      tar -C "$variant_root" --exclude-from="$variant_root/.dockerignore" --exclude=artwork -cf - . | tar -C "$variant_stage" -xf -
      variant_sha=$(git -C "$variant_root" rev-parse --short=12 HEAD)
      variant_version="0.0.0-1.modern.$(date -u +%Y%m%d%H%M%S).g$variant_sha"
      node "$variant_root/packaging/render-variant.mjs" "$variant_stage" "$variant_version"
      # Archive the exact source used, including local deployment edits.
      if [[ $variant_entry != deploy-caddy.sh ]]; then
        mkdir -p "$variant_root/artifacts/modern"
        tar -C "$variant_stage" -czf "$variant_root/artifacts/modern/source-$variant_version.tar.gz" .
      fi
      bash "$variant_stage/$variant_entry" "$@"
      if [[ -d $variant_stage/artifacts ]]; then
        cp -a "$variant_stage/artifacts/." "$variant_root/artifacts/modern/"
        cp "$variant_stage/artifacts/SHA256SUMS" "$variant_root/artifacts/modern/SHA256SUMS-$variant_version"
      fi
      exit 0
      ;;
    *) echo 'Expected --variant classic or --variant modern' >&2; exit 1 ;;
  esac
fi
