#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# SIMP (org.simp.player) — 100% Userland SteamOS Installer
# Target: Steam Deck, Steam Machine, Steam Frame (VR SteamOS), and Linux Desktop
# Zero root/immutable-OS modifications (`steamos-readonly` stays enabled!)
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detect whether we are running from a packaged release bundle or the git repo
if [[ -f "${SCRIPT_DIR}/bin/simp" ]]; then
  BUNDLE_ROOT="${SCRIPT_DIR}"
  BIN_SRC="${BUNDLE_ROOT}/bin/simp"
  UNINSTALL_SRC="${BUNDLE_ROOT}/uninstall-steamos.sh"
  UI_SRC="${BUNDLE_ROOT}/ui"
  SERVICE_SRC="${BUNDLE_ROOT}/systemd/simp.service"
  DESKTOP_SRC="${BUNDLE_ROOT}/desktop/org.simp.player.desktop"
  DECKY_SRC="${BUNDLE_ROOT}/simp-decky"
else
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
  BIN_SRC="${REPO_ROOT}/target/release/simp"
  UNINSTALL_SRC="${REPO_ROOT}/packaging/scripts/uninstall-steamos.sh"
  UI_SRC="${REPO_ROOT}/ui/dist"
  SERVICE_SRC="${REPO_ROOT}/packaging/systemd/simp.service"
  DESKTOP_SRC="${REPO_ROOT}/packaging/desktop/org.simp.player.desktop"
  DECKY_SRC="${REPO_ROOT}/decky-plugin"
fi

INSTALL_ROOT="${HOME}/.local/share/simp"
BIN_DEST="${INSTALL_ROOT}/bin"
UI_DEST="${INSTALL_ROOT}/ui"
LOCAL_BIN="${HOME}/.local/bin"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
APPLICATIONS_DIR="${HOME}/.local/share/applications"
DECKY_PLUGINS_DIR="${HOME}/homebrew/plugins"

echo "============================================================"
echo " Installing SIMP (org.simp.player) into Userland"
echo "============================================================"

if [[ ! -f "${BIN_SRC}" ]]; then
  echo "❌ Error: SIMP binary not found at ${BIN_SRC}"
  echo "   Run ./packaging/scripts/package-release.sh first."
  exit 1
fi

if [[ ! -f "${UI_SRC}/index.html" ]]; then
  echo "❌ Error: Built UI bundle not found at ${UI_SRC}/index.html"
  echo "   Run 'npm run build:ui' or ./packaging/scripts/package-release.sh first."
  exit 1
fi

# 1. Create userland directories
mkdir -p "${BIN_DEST}" "${UI_DEST}" "${LOCAL_BIN}" "${SYSTEMD_USER_DIR}" "${APPLICATIONS_DIR}"

# 2. Stop running service or standalone daemon before replacing binary
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user stop simp.service >/dev/null 2>&1 || true
fi
pkill -f "simp --daemon" >/dev/null 2>&1 || true
sleep 0.3

# 3. Install binary, uninstaller & CLI symlink
install -m 0755 "${BIN_SRC}" "${BIN_DEST}/simp"
if [[ -f "${UNINSTALL_SRC}" ]]; then
  install -m 0755 "${UNINSTALL_SRC}" "${BIN_DEST}/uninstall-steamos.sh"
fi
ln -sf "${BIN_DEST}/simp" "${LOCAL_BIN}/simp"
echo "✓ Installed binary:     ${BIN_DEST}/simp"

# 4. Install self-hosted production UI (:18888)
rm -rf "${UI_DEST:?}/"*
cp -r "${UI_SRC}/"* "${UI_DEST}/"
echo "✓ Installed Web UI:     ${UI_DEST}"

# 5. Install FreeDesktop / KDE Plasma Icons & Desktop Launcher (.desktop)
ICONS_DIR="${HOME}/.local/share/icons/hicolor/256x256/apps"
mkdir -p "${ICONS_DIR}" "${HOME}/.local/share/icons"
if [[ -f "${UI_DEST}/simp-icon-dark.png" ]]; then
  cp "${UI_DEST}/simp-icon-dark.png" "${ICONS_DIR}/org.simp.player.png"
  cp "${UI_DEST}/simp-icon-dark.png" "${HOME}/.local/share/icons/org.simp.player.png"
fi

DESKTOP_DEST="${APPLICATIONS_DIR}/org.simp.player.desktop"
sed \
  -e "s|__SIMP_BIN__|${BIN_DEST}/simp|g" \
  -e "s|__SIMP_ICON__|${UI_DEST}/simp-icon-dark.png|g" \
  "${DESKTOP_SRC}" > "${DESKTOP_DEST}"
chmod 0755 "${DESKTOP_DEST}"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${APPLICATIONS_DIR}" >/dev/null 2>&1 || true
fi
echo "✓ Installed launcher:   ${DESKTOP_DEST}"

# 6. Install and start systemd user service
cp "${SERVICE_SRC}" "${SYSTEMD_USER_DIR}/simp.service"
if command -v systemctl >/dev/null 2>&1 && systemctl --user status >/dev/null 2>&1; then
  systemctl --user daemon-reload
  systemctl --user enable simp.service --now
  systemctl --user restart simp.service
  echo "✓ Enabled & started:    systemd user unit (simp.service)"
else
  echo "ℹ systemd user bus not active in this shell; launch with: simp --daemon"
fi

# 7. Optional Decky Loader plugin installation (if ~/homebrew/plugins exists)
if [[ -d "${DECKY_PLUGINS_DIR}" ]]; then
  DECKY_TARGET="${DECKY_PLUGINS_DIR}/simp-decky"
  if [[ -w "${DECKY_PLUGINS_DIR}" ]]; then
    mkdir -p "${DECKY_TARGET}/dist"
    cp "${DECKY_SRC}/plugin.json" "${DECKY_TARGET}/"
    cp "${DECKY_SRC}/package.json" "${DECKY_TARGET}/"
    cp "${DECKY_SRC}/main.py" "${DECKY_TARGET}/"
    if [[ -f "${DECKY_SRC}/dist/index.js" ]]; then
      cp "${DECKY_SRC}/dist/"* "${DECKY_TARGET}/dist/"
    fi
    echo "✓ Installed Decky QAM:  ${DECKY_TARGET}"
  else
    echo "ℹ Decky directory (${DECKY_PLUGINS_DIR}) requires permissions; run:"
    echo "   sudo cp -r \"${DECKY_SRC}\" \"${DECKY_TARGET}\" && sudo systemctl restart plugin_loader"
  fi
fi

echo "============================================================"
echo "✅ SIMP Installed!"
echo "   • Console UI:   http://127.0.0.1:18888"
echo "   • Launch App:   simp (or 'SIMP' in Application Launcher / Add to Steam)"
echo "   • Uninstall:    ~/.local/share/simp/bin/uninstall-steamos.sh (or packaging/scripts/uninstall-steamos.sh)"
echo "============================================================"

