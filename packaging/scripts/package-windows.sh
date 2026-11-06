#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# SIMP (org.simp.player) — Standalone Portable Windows Release Packager
# Produces:
#   dist/simp-windows-portable/
#   dist/simp-windows-portable-x86_64.zip
# ==============================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

CARGO_BIN="${CARGO_BIN:-$(command -v cargo || echo "${HOME}/.cargo/bin/cargo")}"
RUST_TARGET="x86_64-pc-windows-gnu"
OUT_DIR="${REPO_ROOT}/dist/simp-windows-portable"
ZIP_ARCHIVE="${REPO_ROOT}/dist/simp-windows-portable-x86_64.zip"

echo "============================================================"
echo " Building SIMP Portable Windows Package (${RUST_TARGET})"
echo "============================================================"

echo "1/4 Building production React UI (ui/dist)..."
if [[ -d "${REPO_ROOT}/node_modules" ]]; then
  npm run build:ui
elif [[ -f "${REPO_ROOT}/ui/dist/index.html" ]]; then
  echo "   • Using prebuilt ui/dist (worktree without node_modules)"
else
  npm run build:ui
fi

echo "2/4 Generating embedded 150-day ES256 Apple Music Developer Token & SoundCloud Credentials..."
ENV_FILE="${REPO_ROOT}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  COMMON_GIT_DIR="$(git -C "${REPO_ROOT}" rev-parse --git-common-dir 2>/dev/null || true)"
  if [[ -n "${COMMON_GIT_DIR}" && -f "$(cd "${REPO_ROOT}" && cd "${COMMON_GIT_DIR}/.." && pwd)/.env" ]]; then
    ENV_FILE="$(cd "${REPO_ROOT}" && cd "${COMMON_GIT_DIR}/.." && pwd)/.env"
  elif [[ -f "${HOME}/simp/.env" ]]; then
    ENV_FILE="${HOME}/simp/.env"
  fi
fi

if [[ -z "${SIMP_EMBEDDED_APPLE_DEV_TOKEN:-}" && -s "/tmp/.simp_embedded_jwt" ]]; then
  export SIMP_EMBEDDED_APPLE_DEV_TOKEN="$(cat /tmp/.simp_embedded_jwt)"
fi
if [[ -f "${ENV_FILE}" && -z "${SIMP_EMBEDDED_APPLE_DEV_TOKEN:-}" ]]; then
  EMBEDDED_JWT="$(ENV_FILE="${ENV_FILE}" python3 - <<'PY' || true
import base64, json, os, subprocess, time

env = {}
env_path = os.environ.get("ENV_FILE", ".env")
if os.path.exists(env_path):
    for line in open(env_path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip("'").strip('"')

team_id = env.get("APPLE_TEAM_ID", "")
key_id = env.get("APPLE_KEY_ID", "")
key_path = env.get("APPLE_PRIVATE_KEY_PATH", "")
if (not key_path or not os.path.isfile(key_path)) and key_id:
    local_candidate = f"AuthKey_{key_id}.p8"
    if os.path.isfile(local_candidate):
        key_path = local_candidate

if team_id and key_id and key_path and os.path.isfile(key_path):
    now = int(time.time())
    exp = now + 86400 * 150  # 150-day public MusicKit Developer Token
    b64u = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")
    hdr = b64u(json.dumps({"alg": "ES256", "kid": key_id, "typ": "JWT"}, separators=(",", ":")).encode())
    pld = b64u(json.dumps({"iss": team_id, "iat": now, "exp": exp}, separators=(",", ":")).encode())
    signing_input = f"{hdr}.{pld}"
    p = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", key_path],
        input=signing_input.encode("ascii"),
        capture_output=True,
        check=True,
    )
    der = p.stdout
    pos = 2 if (der[1] & 0x80) == 0 else 2 + (der[1] & 0x7F)
    def read_int(idx):
        assert der[idx] == 0x02
        length = der[idx + 1]
        val = der[idx + 2 : idx + 2 + length]
        if len(val) > 32 and val[0] == 0:
            val = val[-32:]
        return val.rjust(32, b"\x00"), idx + 2 + length
    r, pos = read_int(pos)
    s, pos = read_int(pos)
    sig = b64u(r + s)
    print(f"{signing_input}.{sig}", end="")
PY
)"
  if [[ -n "${EMBEDDED_JWT}" ]]; then
    export SIMP_EMBEDDED_APPLE_DEV_TOKEN="${EMBEDDED_JWT}"
    echo "   • Baked 150-day ES256 Apple Developer Token into simp.exe"
  fi
fi

if [[ -f "${ENV_FILE}" ]]; then
  SC_ID="$(ENV_FILE="${ENV_FILE}" python3 -c 'import os; env=dict(l.strip().split("=",1) for l in open(os.environ["ENV_FILE"]) if l.strip() and not l.strip().startswith("#") and "=" in l); print(env.get("SOUNDCLOUD_CLIENT_ID","").strip().strip("\x27\x22"), end="")' 2>/dev/null || true)"
  SC_SEC="$(ENV_FILE="${ENV_FILE}" python3 -c 'import os; env=dict(l.strip().split("=",1) for l in open(os.environ["ENV_FILE"]) if l.strip() and not l.strip().startswith("#") and "=" in l); print(env.get("SOUNDCLOUD_CLIENT_SECRET","").strip().strip("\x27\x22"), end="")' 2>/dev/null || true)"
  if [[ -n "${SC_ID}" && -n "${SC_SEC}" ]]; then
    export SIMP_EMBEDDED_SOUNDCLOUD_CLIENT_ID="${SC_ID}"
    export SIMP_EMBEDDED_SOUNDCLOUD_CLIENT_SECRET="${SC_SEC}"
    echo "   • Baked SoundCloud Client Credentials into simp.exe (Public Discovery, OAuth PKCE Sign-In & 160kbps AAC streaming enabled out-of-the-box)"
  fi
fi

echo "3/4 Cross-compiling release Rust binary (simp.exe for ${RUST_TARGET})..."
chmod +x "${REPO_ROOT}/packaging/scripts/setup-windows-toolchain.sh"
TOOLCHAIN_BIN="$("${REPO_ROOT}/packaging/scripts/setup-windows-toolchain.sh")"
mkdir -p /tmp/simp-zig-cache
export ZIG_GLOBAL_CACHE_DIR=/tmp/simp-zig-cache
export ZIG_LOCAL_CACHE_DIR=/tmp/simp-zig-cache
export PATH="${TOOLCHAIN_BIN}:${PATH}"
export CC_x86_64_pc_windows_gnu="${TOOLCHAIN_BIN}/x86_64-w64-mingw32-gcc"
export CXX_x86_64_pc_windows_gnu="${TOOLCHAIN_BIN}/x86_64-w64-mingw32-g++"
export AR_x86_64_pc_windows_gnu="${TOOLCHAIN_BIN}/x86_64-w64-mingw32-ar"
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER="${TOOLCHAIN_BIN}/x86_64-w64-mingw32-gcc"

"${CARGO_BIN}" build --release -p simp --target "${RUST_TARGET}" --offline
BUILT_EXE="${REPO_ROOT}/target/${RUST_TARGET}/release/simp.exe"

echo "4/4 Assembling dist/simp-windows-portable/ and ZIP archive..."
rm -rf "${OUT_DIR}" "${ZIP_ARCHIVE}"
mkdir -p "${OUT_DIR}/ui" "${OUT_DIR}/data/lib" "${OUT_DIR}/data/bin"

cp "${BUILT_EXE}" "${OUT_DIR}/simp.exe"
cp -r "${REPO_ROOT}/ui/dist/"* "${OUT_DIR}/ui/"

cat > "${OUT_DIR}/portable.txt" <<'EOF'
SIMP Portable Mode Marker
=========================
Keeping this file (portable.txt) next to simp.exe tells SIMP to store all
library databases (data\library.db), settings (data\settings.vdf), cached
cover art (data\art\), and chromeless window state (data\window-profile\)
self-contained inside this folder.

Delete portable.txt if you prefer SIMP to store data in %LOCALAPPDATA%\simp.
EOF

cat > "${OUT_DIR}/Stop-SIMP-Background-Audio.bat" <<'EOF'
@echo off
echo Stopping SIMP headless background audio service (simp.exe)...
taskkill /F /IM simp.exe >nul 2>&1
echo Done.
EOF

cat > "${OUT_DIR}/README-WINDOWS.txt" <<'EOF'
======================================================================
 SIMP (Simple Integrated Media Player) — Windows Portable Edition
======================================================================

1. HOW TO LAUNCH
   Double-click `simp.exe`.
   - Starts the ultra-lightweight headless Rust audio daemon (`simp.exe --daemon`)
     in the background (~0.1% CPU, native Windows WASAPI audio).
   - Places the SIMP Portal Icon in the Windows System Tray (Notification Area).
   - Opens the chromeless SIMP Console window (via Edge / Brave / Chrome `--app`).

2. HEADLESS BACKGROUND PLAYBACK & SYSTEM TRAY
   - Closing the SIMP window keeps your music playing in the background with
     zero taskbar clutter.
   - Left-click the SIMP System Tray icon in the bottom-right Notification Area
     to re-open the SIMP Console window at any time.
   - Middle-click the System Tray icon to toggle Play / Pause.
   - Right-click the System Tray icon for Now Playing status, Play/Pause,
     Next, Previous, Open SIMP Console, or Quit SIMP.
   - Hardware keyboard Media Keys (Play/Pause, Next, Previous) and the
     Windows 10/11 Volume Flyout work automatically while in-game.

3. PORTABLE MODE (`data\` FOLDER)
   - Because `portable.txt` is present next to `simp.exe`, all settings,
     playlists, SQLite library metadata, and Apple Music tokens are stored
     inside the local `data\` folder. You can move this folder anywhere
     (including an external SSD or USB drive).

4. OPTICAL DISC DRIVES (AUDIO CD & DVD-VIDEO)
   - Audio CDs (`CD-DA`) are read directly from any Windows optical drive
     (`D:\`, `E:\`, etc.) with automatic MusicBrainz & Cover Art Archive lookup.
   - For encrypted DVD-Video discs, place `libdvdcss-2.dll` in `data\lib\`
     and `ffmpeg.exe` in `data\bin\` (or system PATH).
EOF

(cd "${REPO_ROOT}/dist" && python3 -m zipfile -c "${ZIP_ARCHIVE}" simp-windows-portable)

echo "============================================================"
echo "✅ Windows Portable Release Ready:"
echo "   • Directory:   ${OUT_DIR}"
echo "   • ZIP Archive: ${ZIP_ARCHIVE}"
echo "============================================================"

