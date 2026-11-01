#!/usr/bin/env bash
set -euo pipefail

# One-command WSL2 -> Steam Deck / Steam Machine / Steam Frame LAN deployer
TARGET="${1:-deck@steamdeck}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

"${REPO_ROOT}/packaging/scripts/package-release.sh"

echo "Deploying SIMP bundle to ${TARGET}..."
scp "${REPO_ROOT}/dist/simp-steamos-userland.tar.gz" "${TARGET}:/tmp/simp-steamos-userland.tar.gz"
ssh "${TARGET}" "tar -xzf /tmp/simp-steamos-userland.tar.gz -C /tmp && /tmp/simp-steamos-userland/install-steamos.sh && rm -rf /tmp/simp-steamos-userland /tmp/simp-steamos-userland.tar.gz"

echo "✅ SIMP deployed and running on ${TARGET}!"
