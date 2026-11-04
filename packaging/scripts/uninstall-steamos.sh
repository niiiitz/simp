#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# SIMP (org.simp.player) — Clean Userland Uninstaller
# Usage:
#   ./uninstall-steamos.sh           # Removes app, daemon, desktop shortcut & Decky plugin (keeps playlists/settings)
#   ./uninstall-steamos.sh --purge   # Also removes ~/.config/simp, ~/.local/share/simp (DB), and ~/.cache/simp
# ==============================================================================

PURGE=0
if [[ "${1:-}" == "--purge" ]]; then
  PURGE=1
fi

# If invoked via `sudo`, resolve the real non-root desktop user (`SUDO_USER` or `deck`)
if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  REAL_USER="${SUDO_USER:-}"
  if [[ -z "${REAL_USER}" || "${REAL_USER}" == "root" ]]; then
    if id "deck" >/dev/null 2>&1; then
      REAL_USER="deck"
    fi
  fi
  if [[ -n "${REAL_USER}" && "${REAL_USER}" != "root" ]]; then
    REAL_UID="$(id -u "${REAL_USER}")"
    REAL_HOME="$(getent passwd "${REAL_USER}" 2>/dev/null | cut -d: -f6 || echo "/home/${REAL_USER}")"
    export HOME="${REAL_HOME:-/home/${REAL_USER}}"
    export XDG_RUNTIME_DIR="/run/user/${REAL_UID}"
    export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${REAL_UID}/bus"
  else
    REAL_USER="$(whoami)"
    REAL_UID="$(id -u)"
  fi
else
  REAL_USER="$(whoami)"
  REAL_UID="$(id -u)"
fi

run_user_systemctl() {
  if [[ "${EUID:-$(id -u)}" -eq 0 && "${REAL_USER}" != "root" ]]; then
    sudo -u "${REAL_USER}" \
      XDG_RUNTIME_DIR="/run/user/${REAL_UID}" \
      DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${REAL_UID}/bus" \
      systemctl --user "$@"
  else
    systemctl --user "$@"
  fi
}

INSTALL_ROOT="${HOME}/.local/share/simp"
BIN_DEST="${INSTALL_ROOT}/bin"
UI_DEST="${INSTALL_ROOT}/ui"
LOCAL_BIN_LINK="${HOME}/.local/bin/simp"
SERVICE_FILE="${HOME}/.config/systemd/user/simp.service"
DESKTOP_FILE="${HOME}/.local/share/applications/org.simp.player.desktop"
DECKY_TARGET="${HOME}/homebrew/plugins/simp-decky"

echo "============================================================"
echo " Uninstalling SIMP (org.simp.player) from Userland"
echo "============================================================"

# 1. Stop and disable systemd user service
if command -v systemctl >/dev/null 2>&1; then
  run_user_systemctl stop simp.service >/dev/null 2>&1 || true
  run_user_systemctl disable simp.service >/dev/null 2>&1 || true
fi

# Also terminate any manually-spawned simp --daemon process or orphaned headless Widevine worker
pkill -f "simp --daemon" >/dev/null 2>&1 || true
pkill -f "simp-widevine-worker" >/dev/null 2>&1 || true
pkill -f "18888/?worker=apple" >/dev/null 2>&1 || true

if [[ -f "${SERVICE_FILE}" ]]; then
  rm -f "${SERVICE_FILE}"
  if command -v systemctl >/dev/null 2>&1; then
    run_user_systemctl daemon-reload >/dev/null 2>&1 || true
  fi
  echo "✓ Removed systemd unit: ${SERVICE_FILE}"
fi

# 2. Remove binary, UI bundle, staged Decky bundle, and CLI symlinks
rm -rf "${BIN_DEST}" "${UI_DEST}" "${INSTALL_ROOT}/decky-staged"
rm -f "${LOCAL_BIN_LINK}"
if [[ -L "/usr/local/bin/simp" && -w "/usr/local/bin" ]]; then
  rm -f "/usr/local/bin/simp" >/dev/null 2>&1 || true
fi
echo "✓ Removed binary & UI:  ${BIN_DEST}, ${UI_DEST}"

# 3. Remove Desktop shortcut & Wayland app_id alias
rm -f "${HOME}/.local/share/applications/chrome-127.0.0.1__-Default.desktop"
if [[ -f "${DESKTOP_FILE}" ]]; then
  rm -f "${DESKTOP_FILE}"
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "${HOME}/.local/share/applications" >/dev/null 2>&1 || true
  fi
  echo "✓ Removed launcher:     ${DESKTOP_FILE}"
fi

# 4. Remove Decky plugin if present and writable
if [[ -d "${DECKY_TARGET}" ]]; then
  if [[ -w "${DECKY_TARGET}" || -w "$(dirname "${DECKY_TARGET}")" ]]; then
    rm -rf "${DECKY_TARGET}"
    echo "✓ Removed Decky plugin: ${DECKY_TARGET}"
  else
    echo "ℹ Note: To remove root-owned Decky plugin directory, run: sudo rm -rf \"${DECKY_TARGET}\""
  fi
fi

# 5. Handle user data (preserve by default, or wipe on --purge)
if [[ "${PURGE}" -eq 1 ]]; then
  rm -rf "${INSTALL_ROOT}" "${HOME}/.config/simp" "${HOME}/.cache/simp"
  echo "✓ Purged all user data: ~/.local/share/simp, ~/.config/simp, ~/.cache/simp"
else
  echo "ℹ Preserved user library & settings (~/.config/simp/settings.vdf, ~/.local/share/simp/library.db)."
  echo "  (Run with --purge to delete all databases, caches, and settings.)"
fi

echo "============================================================"
echo "✅ SIMP cleanly uninstalled."
echo "============================================================"

