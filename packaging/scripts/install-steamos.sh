#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# SIMP (org.simp.player) — 100% Userland SteamOS Installer
# Target: Steam Deck, Steam Machine, Steam Frame (VR SteamOS), and Linux Desktop
# Zero root/immutable-OS modifications (`steamos-readonly` stays enabled!)
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# If invoked via `sudo`, resolve the real non-root desktop user (`SUDO_USER` or `deck`)
# so files in `~/.local/share/simp`, `~/.config/simp`, and `~/homebrew/plugins/simp-decky`
# are NEVER left owned by `root:root` (which would block future 1-click userland self-updates).
if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  REAL_USER="${SUDO_USER:-}"
  if [[ -z "${REAL_USER}" || "${REAL_USER}" == "root" ]]; then
    if id "deck" >/dev/null 2>&1; then
      REAL_USER="deck"
    fi
  fi
  if [[ -n "${REAL_USER}" && "${REAL_USER}" != "root" ]]; then
    REAL_UID="$(id -u "${REAL_USER}")"
    REAL_GID="$(id -g "${REAL_USER}")"
    REAL_HOME="$(getent passwd "${REAL_USER}" 2>/dev/null | cut -d: -f6 || echo "/home/${REAL_USER}")"
    export HOME="${REAL_HOME:-/home/${REAL_USER}}"
    export XDG_RUNTIME_DIR="/run/user/${REAL_UID}"
    export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${REAL_UID}/bus"
  else
    REAL_USER="$(whoami)"
    REAL_UID="$(id -u)"
    REAL_GID="$(id -g)"
  fi
else
  REAL_USER="$(whoami)"
  REAL_UID="$(id -u)"
  REAL_GID="$(id -g)"
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

# Detect whether we are running from a packaged release bundle or the git repo
if [[ -f "${SCRIPT_DIR}/bin/simp" ]]; then
  BUNDLE_ROOT="${SCRIPT_DIR}"
  BIN_SRC="${BUNDLE_ROOT}/bin/simp"
  UNINSTALL_SRC="${BUNDLE_ROOT}/uninstall-steamos.sh"
  UI_SRC="${BUNDLE_ROOT}/ui"
  SERVICE_SRC="${BUNDLE_ROOT}/systemd/simp.service"
  DESKTOP_SRC="${BUNDLE_ROOT}/desktop/org.simp.player.desktop"
  VRMANIFEST_SRC="${BUNDLE_ROOT}/openvr/org.simp.player.vrmanifest"
  DECKY_SRC="${BUNDLE_ROOT}/simp-decky"
else
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
  BIN_SRC="${REPO_ROOT}/target/release/simp"
  UNINSTALL_SRC="${REPO_ROOT}/packaging/scripts/uninstall-steamos.sh"
  UI_SRC="${REPO_ROOT}/ui/dist"
  SERVICE_SRC="${REPO_ROOT}/packaging/systemd/simp.service"
  DESKTOP_SRC="${REPO_ROOT}/packaging/desktop/org.simp.player.desktop"
  VRMANIFEST_SRC="${REPO_ROOT}/packaging/openvr/org.simp.player.vrmanifest"
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
mkdir -p "${BIN_DEST}" "${UI_DEST}" "${INSTALL_ROOT}/lib" "${LOCAL_BIN}" "${SYSTEMD_USER_DIR}" "${APPLICATIONS_DIR}"
if [[ -d "${SCRIPT_DIR}/lib" ]]; then
  cp -f "${SCRIPT_DIR}/lib/"* "${INSTALL_ROOT}/lib/" >/dev/null 2>&1 || true
fi

# 1b. Auto-discover and stage libwidevinecdm.so into ~/.local/share/simp/lib/ if present on system
if [[ ! -f "${INSTALL_ROOT}/lib/libwidevinecdm.so" ]]; then
  FOUND_CDM="$(find "${HOME}/.var/app/org.mozilla.firefox/.mozilla/firefox" \
                    "${HOME}/.mozilla/firefox" \
                    "${HOME}/.var/app/com.google.Chrome/config/google-chrome/WidevineCdm" \
                    "${HOME}/.config/google-chrome/WidevineCdm" \
                    /opt/google/chrome/WidevineCdm \
                    /usr/lib/chromium \
                    -name "libwidevinecdm.so" -type f 2>/dev/null | head -n 1 || true)"
  if [[ -n "${FOUND_CDM}" && -f "${FOUND_CDM}" ]]; then
    cp "${FOUND_CDM}" "${INSTALL_ROOT}/lib/libwidevinecdm.so" >/dev/null 2>&1 || true
    chmod 0755 "${INSTALL_ROOT}/lib/libwidevinecdm.so" >/dev/null 2>&1 || true
    echo "✓ Staged Widevine CDM:  ${INSTALL_ROOT}/lib/libwidevinecdm.so"
  elif [[ "$(uname -m)" == "x86_64" ]] && command -v curl >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
    TMP_CRX="${INSTALL_ROOT}/lib/.widevine_dl.crx3"
    WV_URL="https://edgedl.me.gvt1.com/edgedl/release2/chrome_component/acqexsh26ysyu3zxeotqtsp63idq_4.10.3112.0/oimompecagnajdejgnnjijobebaeigek_4.10.3112.0_linux64_ad7kyx4q7wx7xknykmkbonbbmnwq.crx3"
    if curl -fsSL --max-time 25 -o "${TMP_CRX}" "${WV_URL}" 2>/dev/null; then
      python3 - "${TMP_CRX}" "${INSTALL_ROOT}/lib/libwidevinecdm.so" <<'PYEOF' || true
import sys, zipfile, os, io
crx_path, dest_path = sys.argv[1], sys.argv[2]
data = open(crx_path, "rb").read()
pk_idx = data.find(b"PK\x03\x04")
if pk_idx >= 0:
    with zipfile.ZipFile(io.BytesIO(data[pk_idx:])) as zf:
        for name in zf.namelist():
            if name.endswith("libwidevinecdm.so"):
                out = zf.read(name)
                open(dest_path, "wb").write(out)
                os.chmod(dest_path, 0o755)
                break
PYEOF
      rm -f "${TMP_CRX}" >/dev/null 2>&1 || true
      if [[ -f "${INSTALL_ROOT}/lib/libwidevinecdm.so" ]]; then
        echo "✓ Provisioned Widevine: ${INSTALL_ROOT}/lib/libwidevinecdm.so (4.10.3112.0)"
      fi
    fi
  elif [[ "$(uname -m)" == "aarch64" ]] && command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1; then
    TMP_DEB="${INSTALL_ROOT}/lib/.widevine_arm64.deb"
    TMP_EXT="${INSTALL_ROOT}/lib/.widevine_ext"
    WV_ARM_URL="https://archive.raspberrypi.com/debian/pool/main/w/widevine/libwidevinecdm0_4.10.2662.3+1_arm64.deb"
    if curl -fsSL --max-time 35 -o "${TMP_DEB}" "${WV_ARM_URL}" 2>/dev/null; then
      rm -rf "${TMP_EXT}" && mkdir -p "${TMP_EXT}"
      if command -v bsdtar >/dev/null 2>&1; then
        bsdtar -xf "${TMP_DEB}" -C "${TMP_EXT}" 2>/dev/null || true
      elif command -v ar >/dev/null 2>&1; then
        (cd "${TMP_EXT}" && ar x "${TMP_DEB}") 2>/dev/null || true
      fi
      if [[ -f "${TMP_EXT}/data.tar.xz" ]]; then
        tar -xf "${TMP_EXT}/data.tar.xz" -C "${TMP_EXT}" 2>/dev/null || true
        ARM_SO="$(find "${TMP_EXT}" -name "libwidevinecdm.so" -type f 2>/dev/null | head -n 1 || true)"
        if [[ -n "${ARM_SO}" && -f "${ARM_SO}" ]]; then
          cp -L "${ARM_SO}" "${INSTALL_ROOT}/lib/libwidevinecdm.so" >/dev/null 2>&1 || true
          chmod 0755 "${INSTALL_ROOT}/lib/libwidevinecdm.so" >/dev/null 2>&1 || true
          echo "✓ Provisioned Widevine: ${INSTALL_ROOT}/lib/libwidevinecdm.so (ARM64 4.10.2662.3)"
        fi
      fi
      rm -rf "${TMP_DEB}" "${TMP_EXT}" >/dev/null 2>&1 || true
    fi
  fi
fi

# 2. Stop running service, standalone daemon, and any orphaned Widevine worker before replacing binary
if command -v systemctl >/dev/null 2>&1; then
  run_user_systemctl stop simp.service >/dev/null 2>&1 || true
fi
pkill -f "simp --daemon" >/dev/null 2>&1 || true
pkill -f "simp-widevine-worker" >/dev/null 2>&1 || true
pkill -f "18888/?worker=apple" >/dev/null 2>&1 || true
rm -f "${HOME}/.local/share/simp/simp-widevine-worker/lock" \
      "${HOME}/.local/share/simp/simp-widevine-worker/.parentlock" \
      "${HOME}/.local/share/simp/simp-widevine-worker/parent.lock" \
      "${HOME}/.local/share/simp/simp-widevine-worker/SingletonLock" \
      "${HOME}/.local/share/simp/simp-widevine-worker/SingletonCookie" \
      "${HOME}/.local/share/simp/simp-widevine-worker/SingletonSocket" >/dev/null 2>&1 || true
sleep 0.3

# 3. Install binary, uninstaller & CLI symlink
install -m 0755 "${BIN_SRC}" "${BIN_DEST}/simp"
if [[ -f "${UNINSTALL_SRC}" ]]; then
  install -m 0755 "${UNINSTALL_SRC}" "${BIN_DEST}/uninstall-steamos.sh"
fi
ln -sf "${BIN_DEST}/simp" "${LOCAL_BIN}/simp"
if [[ -w "/usr/local/bin" ]]; then
  ln -sf "${BIN_DEST}/simp" "/usr/local/bin/simp" >/dev/null 2>&1 || true
fi

# Ensure ~/.local/bin is in the user's shell PATH so `simp` and `whereis simp` always work
for rc_file in "${HOME}/.bashrc" "${HOME}/.profile"; do
  if [[ -f "${rc_file}" ]]; then
    if ! grep -q '\.local/bin' "${rc_file}" 2>/dev/null; then
      printf '\n# Added by SIMP installer\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "${rc_file}"
      if [[ "${EUID:-$(id -u)}" -eq 0 && "${REAL_USER}" != "root" ]]; then
        chown "${REAL_UID}:${REAL_GID}" "${rc_file}" >/dev/null 2>&1 || true
      fi
    fi
  fi
done
echo "✓ Installed binary:     ${BIN_DEST}/simp"

# 4. Install self-hosted production UI (:18888)
rm -rf "${UI_DEST:?}/"*
cp -r "${UI_SRC}/"* "${UI_DEST}/"
echo "✓ Installed Web UI:     ${UI_DEST}"

# 5. Install FreeDesktop / KDE Plasma / Steam Frame Icons & Desktop Launcher (.desktop)
mkdir -p "${HOME}/.local/share/icons" "${HOME}/.local/share/pixmaps"
for sz in 16 32 48 64 128 256 512; do
  SZ_DIR="${HOME}/.local/share/icons/hicolor/${sz}x${sz}/apps"
  mkdir -p "${SZ_DIR}"
  if [[ -f "${UI_DEST}/simp-icon-${sz}.png" ]]; then
    cp "${UI_DEST}/simp-icon-${sz}.png" "${SZ_DIR}/org.simp.player.png"
    cp "${UI_DEST}/simp-icon-${sz}.png" "${SZ_DIR}/simp-player-ui.png"
    cp "${UI_DEST}/simp-icon-${sz}.png" "${SZ_DIR}/simp.png"
  elif [[ -f "${UI_DEST}/simp-icon-dark.png" ]]; then
    cp "${UI_DEST}/simp-icon-dark.png" "${SZ_DIR}/org.simp.player.png"
    cp "${UI_DEST}/simp-icon-dark.png" "${SZ_DIR}/simp-player-ui.png"
    cp "${UI_DEST}/simp-icon-dark.png" "${SZ_DIR}/simp.png"
  fi
done

PRIMARY_ICON="${UI_DEST}/simp-icon-256.png"
if [[ ! -f "${PRIMARY_ICON}" ]]; then
  PRIMARY_ICON="${UI_DEST}/simp-icon-dark.png"
fi
if [[ -f "${PRIMARY_ICON}" ]]; then
  cp "${PRIMARY_ICON}" "${HOME}/.local/share/icons/org.simp.player.png"
  cp "${PRIMARY_ICON}" "${HOME}/.local/share/pixmaps/org.simp.player.png"
  cp "${PRIMARY_ICON}" "${HOME}/.local/share/pixmaps/simp-player-ui.png"
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "${HOME}/.local/share/icons/hicolor" >/dev/null 2>&1 || true
fi

DESKTOP_DEST="${APPLICATIONS_DIR}/org.simp.player.desktop"
sed \
  -e "s|__SIMP_BIN__|${BIN_DEST}/simp|g" \
  -e "s|__SIMP_ICON__|org.simp.player|g" \
  "${DESKTOP_SRC}" > "${DESKTOP_DEST}"
chmod 0755 "${DESKTOP_DEST}"

# Also create hidden Wayland/X11 app_id mappings so KWin & SteamVR Quick Launch Bar / App Launch History
# always resolve Chromium `--app=http://127.0.0.1:18888` and `--class=simp-player-ui` windows to the SIMP icon.
for alias_id in "simp-player-ui" "simp" "chrome-127.0.0.1__-Default" "chrome-http___127.0.0.1_18888_-Default" "127.0.0.1"; do
  WAYLAND_ALIAS_DEST="${APPLICATIONS_DIR}/${alias_id}.desktop"
  cat > "${WAYLAND_ALIAS_DEST}" <<EOF
[Desktop Entry]
Type=Application
Name=SIMP
Exec=${BIN_DEST}/simp
Icon=org.simp.player
NoDisplay=true
StartupWMClass=${alias_id}
EOF
  chmod 0644 "${WAYLAND_ALIAS_DEST}"
done

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${APPLICATIONS_DIR}" >/dev/null 2>&1 || true
fi
echo "✓ Installed launcher:   ${DESKTOP_DEST}"

# 5b. Install OpenVR / SteamVR Application Manifest (`org.simp.player.vrmanifest`) + Action Bindings for Steam Frame & VR
OPENVR_DEST_DIR="${INSTALL_ROOT}/openvr"
mkdir -p "${OPENVR_DEST_DIR}"
if [[ -f "${PRIMARY_ICON}" ]]; then
  cp "${PRIMARY_ICON}" "${OPENVR_DEST_DIR}/simp-icon-256.png"
  cp "${PRIMARY_ICON}" "${OPENVR_DEST_DIR}/simp-icon-dark.png"
fi
VRMANIFEST_DIR="$(dirname "${VRMANIFEST_SRC}")"
for vr_json in "${VRMANIFEST_DIR}"/*.json; do
  if [[ -f "${vr_json}" ]]; then
    cp "${vr_json}" "${OPENVR_DEST_DIR}/"
    chmod 0644 "${OPENVR_DEST_DIR}/$(basename "${vr_json}")"
  fi
done
if [[ -f "${VRMANIFEST_SRC}" ]]; then
  sed \
    -e "s|__SIMP_BIN__|${BIN_DEST}/simp|g" \
    -e "s|__SIMP_ACTIONS__|${OPENVR_DEST_DIR}/actions.json|g" \
    -e "s|__SIMP_ICON__|${OPENVR_DEST_DIR}/simp-icon-256.png|g" \
    "${VRMANIFEST_SRC}" > "${OPENVR_DEST_DIR}/org.simp.player.vrmanifest"
  chmod 0644 "${OPENVR_DEST_DIR}/org.simp.player.vrmanifest"
  # Register SIMP's `.vrmanifest` in SteamVR's `appconfig.json` when present so SteamVR loads VR controller bindings automatically
  for steam_cfg_dir in "${HOME}/.steam/steam/config" "${HOME}/.local/share/Steam/config"; do
    if [[ -d "${steam_cfg_dir}" ]] && command -v python3 >/dev/null 2>&1; then
      APPCONFIG_PATH="${steam_cfg_dir}/appconfig.json" \
      MANIFEST_PATH="${OPENVR_DEST_DIR}/org.simp.player.vrmanifest" \
      python3 - <<'PY' >/dev/null 2>&1 || true
import json, os
p = os.environ["APPCONFIG_PATH"]
m = os.environ["MANIFEST_PATH"]
data = {}
if os.path.isfile(p):
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {}
paths = data.get("manifest_paths")
if not isinstance(paths, list):
    paths = []
if m not in paths:
    paths.append(m)
    data["manifest_paths"] = paths
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=3)
        f.write("\n")
PY
    fi
  done
  echo "✓ Installed OpenVR:     ${OPENVR_DEST_DIR}/org.simp.player.vrmanifest"
fi

# 6. Install and start systemd user service
cp "${SERVICE_SRC}" "${SYSTEMD_USER_DIR}/simp.service"

# Ensure all userland directories and files belong to REAL_USER (even if script was run with `sudo`)
if [[ "${EUID:-$(id -u)}" -eq 0 && "${REAL_USER}" != "root" ]]; then
  chown -R "${REAL_UID}:${REAL_GID}" "${INSTALL_ROOT}" "${SYSTEMD_USER_DIR}" "${APPLICATIONS_DIR}" "${HOME}/.local/share/icons" >/dev/null 2>&1 || true
  chown -h "${REAL_UID}:${REAL_GID}" "${LOCAL_BIN}/simp" >/dev/null 2>&1 || true
  if [[ -d "${HOME}/.config/simp" ]]; then
    chown -R "${REAL_UID}:${REAL_GID}" "${HOME}/.config/simp" >/dev/null 2>&1 || true
  fi
fi

if command -v systemctl >/dev/null 2>&1 && run_user_systemctl status >/dev/null 2>&1; then
  run_user_systemctl daemon-reload
  run_user_systemctl enable simp.service --now
  run_user_systemctl restart simp.service
  echo "✓ Enabled & started:    systemd user unit (simp.service)"
else
  echo "ℹ systemd user bus not active in this shell; launch with: simp --daemon"
fi

# 7. Decky Loader plugin installation (enabled by default on x86_64 Steam Deck / gamescope when ~/homebrew/plugins exists; skipped on aarch64 Steam Frame)
if [[ "$(uname -m)" == "aarch64" ]]; then
  DEFAULT_INSTALL_DECKY="0"
else
  DEFAULT_INSTALL_DECKY="1"
fi

if [[ -d "${DECKY_SRC}" ]]; then
  rm -rf "${INSTALL_ROOT}/decky-staged"
  mkdir -p "${INSTALL_ROOT}/decky-staged/dist"
  cp "${DECKY_SRC}/plugin.json" "${INSTALL_ROOT}/decky-staged/" 2>/dev/null || true
  cp "${DECKY_SRC}/package.json" "${INSTALL_ROOT}/decky-staged/" 2>/dev/null || true
  cp "${DECKY_SRC}/main.py" "${INSTALL_ROOT}/decky-staged/" 2>/dev/null || true
  if [[ -f "${DECKY_SRC}/dist/index.js" ]]; then
    cp "${DECKY_SRC}/dist/"* "${INSTALL_ROOT}/decky-staged/dist/" 2>/dev/null || true
  fi
  if [[ "${EUID:-$(id -u)}" -eq 0 && "${REAL_USER}" != "root" ]]; then
    chown -R "${REAL_UID}:${REAL_GID}" "${INSTALL_ROOT}/decky-staged" >/dev/null 2>&1 || true
  fi
fi

if [[ "${SIMP_INSTALL_DECKY:-${DEFAULT_INSTALL_DECKY}}" == "1" && -d "${DECKY_PLUGINS_DIR}" && -d "${DECKY_SRC}" ]]; then
  DECKY_TARGET="${DECKY_PLUGINS_DIR}/simp-decky"
  if [[ "${EUID:-$(id -u)}" -eq 0 ]] || { [[ ! -w "${DECKY_PLUGINS_DIR}" ]] && [[ ! -w "${DECKY_TARGET}" ]]; }; then
    echo "ℹ Granting ${REAL_USER} ownership on ${DECKY_PLUGINS_DIR} & ${DECKY_TARGET} so future 1-click updates and restores require zero sudo..."
    sudo mkdir -p "${DECKY_TARGET}" >/dev/null 2>&1 || mkdir -p "${DECKY_TARGET}" >/dev/null 2>&1 || true
    sudo rm -rf "${DECKY_TARGET}/simp-decky" "${DECKY_TARGET}/bin" "${DECKY_TARGET}/ui" >/dev/null 2>&1 || rm -rf "${DECKY_TARGET}/simp-decky" "${DECKY_TARGET}/bin" "${DECKY_TARGET}/ui" >/dev/null 2>&1 || true
    sudo chown "${REAL_UID}:${REAL_GID}" "${DECKY_PLUGINS_DIR}" >/dev/null 2>&1 || chown "${REAL_UID}:${REAL_GID}" "${DECKY_PLUGINS_DIR}" >/dev/null 2>&1 || true
    sudo chmod 0755 "${DECKY_PLUGINS_DIR}" >/dev/null 2>&1 || chmod 0755 "${DECKY_PLUGINS_DIR}" >/dev/null 2>&1 || true
    sudo chown -R "${REAL_UID}:${REAL_GID}" "${DECKY_TARGET}" >/dev/null 2>&1 || chown -R "${REAL_UID}:${REAL_GID}" "${DECKY_TARGET}" >/dev/null 2>&1 || true
  fi

  if [[ -w "${DECKY_PLUGINS_DIR}" ]] || [[ -w "${DECKY_TARGET}" ]]; then
    rm -rf "${DECKY_TARGET}/simp-decky" "${DECKY_TARGET}/bin" "${DECKY_TARGET}/ui"
    mkdir -p "${DECKY_TARGET}/dist"
    cp "${DECKY_SRC}/plugin.json" "${DECKY_TARGET}/"
    cp "${DECKY_SRC}/package.json" "${DECKY_TARGET}/"
    cp "${DECKY_SRC}/main.py" "${DECKY_TARGET}/"
    if [[ -f "${DECKY_SRC}/dist/index.js" ]]; then
      cp "${DECKY_SRC}/dist/"* "${DECKY_TARGET}/dist/"
    fi
    if [[ "${EUID:-$(id -u)}" -eq 0 && "${REAL_USER}" != "root" ]]; then
      chown -R "${REAL_UID}:${REAL_GID}" "${DECKY_TARGET}" >/dev/null 2>&1 || true
    fi
    sudo -n systemctl restart plugin_loader >/dev/null 2>&1 || true
    echo "✓ Installed Decky QAM:  ${DECKY_TARGET}"
  else
    echo "ℹ Decky directory (${DECKY_PLUGINS_DIR}) requires permissions; run:"
    echo "   sudo rm -rf \"${DECKY_TARGET}\" && sudo cp -r \"${DECKY_SRC}\" \"${DECKY_TARGET}\" && sudo chown -R \$(id -u):\$(id -g) \"${DECKY_TARGET}\" && sudo systemctl restart plugin_loader"
  fi
fi

echo "============================================================"
echo "✅ SIMP Installed!"
echo "   • Console UI:   http://127.0.0.1:18888"
echo "   • Launch App:   simp (or 'SIMP' in Application Launcher / Add to Steam)"
echo "   • Self-Update:  simp update (or click '🔄 Update SIMP' inside the SIMP Power/Settings menu)"
echo "   • Uninstall:    ~/.local/share/simp/bin/uninstall-steamos.sh (or packaging/scripts/uninstall-steamos.sh)"
echo "============================================================"

