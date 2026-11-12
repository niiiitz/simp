#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# IMP / SIMP — itch.io Multi-Channel Butler Publisher
# Pushes platform-tagged release builds to itch.io via `butler`:
#   - linux-amd64     (dist/simp-steamos-userland-x86_64.tar.gz)
#   - linux-arm64     (dist/simp-steamos-userland-aarch64.tar.gz)
#   - windows-amd64   (dist/simp-windows-portable-x86_64.zip)
#   - macos-universal (dist/SIMP-macos-arm64.zip)
#
# Usage:
#   ./packaging/scripts/publish-itch.sh [version]
# Environment:
#   ITCH_TARGET       (default: "niiiitz/imp")
#   BUTLER_BIN        (default: "$(command -v butler)")
#   ITCH_DRY_RUN=1    (optional: validate artifacts & print butler commands without pushing)
# ==============================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

ITCH_TARGET="${ITCH_TARGET:-niiiitz/imp}"
BUTLER_BIN="${BUTLER_BIN:-$(command -v butler || true)}"
RAW_VERSION="${1:-$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')}"
VERSION="${RAW_VERSION#v}"

echo "============================================================"
echo " Publishing IMP (SIMP) v${VERSION} to itch.io (${ITCH_TARGET})"
echo "============================================================"

if [[ -z "${BUTLER_BIN}" && "${ITCH_DRY_RUN:-0}" != "1" ]]; then
  echo "❌ Error: 'butler' CLI not found in PATH." >&2
  echo "   Install itch.io butler from https://itch.io/docs/butler/installing.html" >&2
  echo "   or run with ITCH_DRY_RUN=1 to preview channel commands." >&2
  exit 1
fi

push_channel() {
  local artifact="$1"
  local channel="$2"
  if [[ ! -f "${artifact}" ]]; then
    echo "   ⚠️  Skipping channel '${channel}' (artifact not found: ${artifact})"
    return 0
  fi
  echo "   🚀 Pushing ${artifact} -> ${ITCH_TARGET}:${channel} (userversion ${VERSION})"
  if [[ "${ITCH_DRY_RUN:-0}" == "1" ]]; then
    echo "      [DRY-RUN] butler push \"${artifact}\" \"${ITCH_TARGET}:${channel}\" --userversion \"${VERSION}\""
  else
    "${BUTLER_BIN}" push "${artifact}" "${ITCH_TARGET}:${channel}" --userversion "${VERSION}"
  fi
}

push_channel "${REPO_ROOT}/dist/simp-steamos-userland-x86_64.tar.gz" "linux-amd64"
push_channel "${REPO_ROOT}/dist/simp-steamos-userland-aarch64.tar.gz" "linux-arm64"
push_channel "${REPO_ROOT}/dist/simp-windows-portable-x86_64.zip" "windows-amd64"
push_channel "${REPO_ROOT}/dist/SIMP-macos-arm64.zip" "macos-universal"
push_channel "${REPO_ROOT}/dist/simp-decky.zip" "steamos-decky"

echo "============================================================"
echo "✅ itch.io channel push complete for v${VERSION}"
echo "============================================================"
