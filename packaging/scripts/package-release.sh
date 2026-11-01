#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# SIMP (org.simp.player) — Self-Contained SteamOS Release Bundle Packager
# Produces:
#   dist/simp-steamos-userland/
#   dist/simp-steamos-userland.tar.gz
# ==============================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

CARGO_BIN="${CARGO_BIN:-$(command -v cargo || echo "${HOME}/.cargo/bin/cargo")}"
ARCH="$(uname -m)"
OUT_DIR="${REPO_ROOT}/dist/simp-steamos-userland"
ARCHIVE="${REPO_ROOT}/dist/simp-steamos-userland.tar.gz"
ARCH_ARCHIVE="${REPO_ROOT}/dist/simp-steamos-userland-${ARCH}.tar.gz"
DECKY_ZIP="${REPO_ROOT}/dist/simp-decky.zip"

echo "============================================================"
echo " Building SIMP Release Package (Daemon + UI + Decky + Scripts)"
echo "============================================================"

echo "1/4 Building production React UI (ui/dist)..."
npm run build:ui

echo "2/4 Building Decky QAM plugin bundle (decky-plugin/dist)..."
npm run build:decky

echo "3/4 Building release Rust binary (simp)..."
"${CARGO_BIN}" build --release -p simp --offline

echo "4/4 Assembling dist/simp-steamos-userland/..."
rm -rf "${OUT_DIR}"
mkdir -p \
  "${OUT_DIR}/bin" \
  "${OUT_DIR}/ui" \
  "${OUT_DIR}/systemd" \
  "${OUT_DIR}/desktop" \
  "${OUT_DIR}/simp-decky/dist"

cp "${REPO_ROOT}/target/release/simp" "${OUT_DIR}/bin/simp"
cp -r "${REPO_ROOT}/ui/dist/"* "${OUT_DIR}/ui/"
cp "${REPO_ROOT}/packaging/systemd/simp.service" "${OUT_DIR}/systemd/simp.service"
cp "${REPO_ROOT}/packaging/desktop/org.simp.player.desktop" "${OUT_DIR}/desktop/org.simp.player.desktop"

cp "${REPO_ROOT}/decky-plugin/plugin.json" "${OUT_DIR}/simp-decky/"
cp "${REPO_ROOT}/decky-plugin/package.json" "${OUT_DIR}/simp-decky/"
cp "${REPO_ROOT}/decky-plugin/main.py" "${OUT_DIR}/simp-decky/"
cp "${REPO_ROOT}/decky-plugin/dist/"* "${OUT_DIR}/simp-decky/dist/"

cp "${REPO_ROOT}/packaging/scripts/install-steamos.sh" "${OUT_DIR}/install-steamos.sh"
cp "${REPO_ROOT}/packaging/scripts/uninstall-steamos.sh" "${OUT_DIR}/uninstall-steamos.sh"
cp "${REPO_ROOT}/packaging/scripts/uninstall-steamos.sh" "${OUT_DIR}/bin/uninstall-steamos.sh"
chmod +x "${OUT_DIR}/install-steamos.sh" "${OUT_DIR}/uninstall-steamos.sh" "${OUT_DIR}/bin/uninstall-steamos.sh" "${OUT_DIR}/bin/simp"

tar -C "${REPO_ROOT}/dist" -czf "${ARCHIVE}" "simp-steamos-userland"
cp "${ARCHIVE}" "${ARCH_ARCHIVE}"
python3 -m zipfile -c "${DECKY_ZIP}" "${OUT_DIR}/simp-decky"
# Ensure zip root folder is `simp-decky/` (Decky Loader ZIP standard)
(cd "${OUT_DIR}" && python3 -m zipfile -c "${DECKY_ZIP}" simp-decky)

echo "============================================================"
echo "✅ Release Bundle Ready:"
echo "   • Directory:   ${OUT_DIR}"
echo "   • Tarball:     ${ARCH_ARCHIVE}"
echo "   • Decky ZIP:   ${DECKY_ZIP}"
echo "============================================================"

