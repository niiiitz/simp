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

export PATH="/usr/local/opt/node@24/bin:/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:${HOME}/.cargo/bin:${PATH}"
CARGO_BIN="${CARGO_BIN:-$(command -v cargo || echo "${HOME}/.cargo/bin/cargo")}"
HOST_OS="$(uname -s)"
HOST_ARCH="$(uname -m)"
if [[ "${HOST_OS}" == "Darwin" ]]; then
  ARCH="${SIMP_TARGET_ARCH:-x86_64}"
else
  ARCH="${SIMP_TARGET_ARCH:-${HOST_ARCH}}"
fi
OUT_DIR="${REPO_ROOT}/dist/simp-steamos-userland"
ARCHIVE="${REPO_ROOT}/dist/simp-steamos-userland.tar.gz"
ARCH_ARCHIVE="${REPO_ROOT}/dist/simp-steamos-userland-${ARCH}.tar.gz"
DECKY_ZIP="${REPO_ROOT}/dist/simp-decky.zip"
# Default to Decky-free on Steam Frame (aarch64); optional separate artifact on x86_64
if [[ "${ARCH}" == "aarch64" ]]; then
  WITH_DECKY="${SIMP_WITH_DECKY:-0}"
else
  WITH_DECKY="${SIMP_WITH_DECKY:-1}"
fi

echo "============================================================"
echo " Building SIMP Release Package (Arch: ${ARCH}, Decky Add-On: ${WITH_DECKY})"
echo "============================================================"

# Automatically synchronize release version across Cargo.toml, Cargo.lock, package.json files, decky-plugin/src/index.tsx, and README.md
TARGET_VERSION="${1:-${SIMP_VERSION:-}}"
SYNCED_VERSION="$(TARGET_VERSION="${TARGET_VERSION}" python3 - <<'PY'
import json, os, re

pkg_path = "decky-plugin/package.json"
with open(pkg_path, "r", encoding="utf-8") as f:
    pkg = json.load(f)

raw_ver = os.environ.get("TARGET_VERSION", "").strip().lstrip("v")
if not raw_ver:
    raw_ver = pkg.get("version", "0.1.0-alpha").lstrip("v")

# 1. Sync all workspace package.json files
for p_path in ["decky-plugin/package.json", "package.json", "ui/package.json", "packages/simp-client/package.json"]:
    if os.path.isfile(p_path):
        with open(p_path, "r", encoding="utf-8") as f:
            p_data = json.load(f)
        if p_data.get("version") != raw_ver:
            p_data["version"] = raw_ver
            with open(p_path, "w", encoding="utf-8") as f:
                json.dump(p_data, f, indent=2)
                f.write("\n")

# 2. Sync root Cargo.toml [workspace.package] version
cargo_toml = "Cargo.toml"
if os.path.isfile(cargo_toml):
    with open(cargo_toml, "r", encoding="utf-8") as f:
        ct_src = f.read()
    ct_next = re.sub(
        r'(\[workspace\.package\]\s*\nversion\s*=\s*)"[^"]+"',
        rf'\1"{raw_ver}"',
        ct_src,
        count=1,
    )
    if ct_next != ct_src:
        with open(cargo_toml, "w", encoding="utf-8") as f:
            f.write(ct_next)

# 3. Sync workspace crate versions in Cargo.lock so offline builds stay lock-consistent
cargo_lock = "Cargo.lock"
if os.path.isfile(cargo_lock):
    with open(cargo_lock, "r", encoding="utf-8") as f:
        cl_src = f.read()
    cl_next = re.sub(
        r'(name = "(?:simp|simp-core|simp-daemon|simp-protocol)"\nversion = )"[^"]+"',
        rf'\1"{raw_ver}"',
        cl_src,
    )
    if cl_next != cl_src:
        with open(cargo_lock, "w", encoding="utf-8") as f:
            f.write(cl_next)

# 4. Sync decky-plugin/src/index.tsx SIMP_VERSION constant
idx_path = "decky-plugin/src/index.tsx"
if os.path.isfile(idx_path):
    with open(idx_path, "r", encoding="utf-8") as f:
        idx_src = f.read()
    idx_next = re.sub(
        r"const SIMP_VERSION = 'v[^']+';",
        f"const SIMP_VERSION = 'v{raw_ver}';",
        idx_src,
    )
    if idx_next != idx_src:
        with open(idx_path, "w", encoding="utf-8") as f:
            f.write(idx_next)

# 5. Sync README.md Status shields.io badge
readme_path = "README.md"
if os.path.isfile(readme_path):
    with open(readme_path, "r", encoding="utf-8") as f:
        readme_src = f.read()
    shield_ver = raw_ver.replace("-", "--")
    readme_next = re.sub(
        r"\[!\[Status: v[^\]]+\]\(https://img\.shields\.io/badge/status-v[^)]+\)\]\([^)]+\)",
        f"[![Status: v{raw_ver}](https://img.shields.io/badge/status-v{shield_ver}-ff6a00?style=flat-square)](https://github.com/niiiitz/simp/releases)",
        readme_src,
    )
    if readme_next != readme_src:
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(readme_next)

# 6. Sync packaging/macos/SIMP.xcodeproj/project.pbxproj version
pbx_path = "packaging/macos/SIMP.xcodeproj/project.pbxproj"
if os.path.isfile(pbx_path):
    with open(pbx_path, "r", encoding="utf-8") as f:
        pbx_src = f.read()
    pbx_next = re.sub(
        r'(CURRENT_PROJECT_VERSION|MARKETING_VERSION) = "[^"]+";',
        rf'\1 = "{raw_ver}";',
        pbx_src,
    )
    if pbx_next != pbx_src:
        with open(pbx_path, "w", encoding="utf-8") as f:
            f.write(pbx_next)

print(f"v{raw_ver}", end="")
PY
)"
echo "0/4 Synchronized version ${SYNCED_VERSION} across Cargo.toml, package.json, decky-plugin & README.md"

echo "1/4 Building production React UI (ui/dist)..."
if [[ -d "${REPO_ROOT}/node_modules" ]]; then
  npm run build:ui
elif [[ -f "${REPO_ROOT}/ui/dist/index.html" ]]; then
  echo "   • Using prebuilt ui/dist (worktree without node_modules)"
else
  npm run build:ui
fi

if [[ "${WITH_DECKY}" == "1" ]]; then
  echo "2/4 Building optional Decky QAM add-on bundle (decky-plugin/dist)..."
  if [[ -d "${REPO_ROOT}/decky-plugin/node_modules" || -d "${REPO_ROOT}/node_modules" ]]; then
    npm run build:decky
  elif [[ -f "${REPO_ROOT}/decky-plugin/dist/index.js" ]]; then
    echo "   • Using prebuilt decky-plugin/dist (worktree without node_modules)"
  else
    npm run build:decky
  fi
else
  echo "2/4 Skipping Decky QAM plugin build (Decky-free ${ARCH} target)..."
fi

echo "3/4 Building release Rust binary (simp for ${ARCH})..."
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
    echo "   • Baked 150-day ES256 Apple Developer Token into binary (no .p8 key required on target devices)"
  fi
fi

if [[ -f "${ENV_FILE}" ]]; then
  SC_ID="$(ENV_FILE="${ENV_FILE}" python3 -c 'import os; env=dict(l.strip().split("=",1) for l in open(os.environ["ENV_FILE"]) if l.strip() and not l.strip().startswith("#") and "=" in l); print(env.get("SOUNDCLOUD_CLIENT_ID","").strip().strip("\x27\x22"), end="")' 2>/dev/null || true)"
  SC_SEC="$(ENV_FILE="${ENV_FILE}" python3 -c 'import os; env=dict(l.strip().split("=",1) for l in open(os.environ["ENV_FILE"]) if l.strip() and not l.strip().startswith("#") and "=" in l); print(env.get("SOUNDCLOUD_CLIENT_SECRET","").strip().strip("\x27\x22"), end="")' 2>/dev/null || true)"
  if [[ -n "${SC_ID}" && -n "${SC_SEC}" ]]; then
    export SIMP_EMBEDDED_SOUNDCLOUD_CLIENT_ID="${SC_ID}"
    export SIMP_EMBEDDED_SOUNDCLOUD_CLIENT_SECRET="${SC_SEC}"
    echo "   • Baked SoundCloud Client Credentials into binary (Public Discovery, OAuth PKCE Sign-In & 160kbps AAC streaming enabled out-of-the-box)"
  fi
fi
if [[ -z "${SIMP_EMBEDDED_APPLE_DEV_TOKEN:-}" ]]; then
  echo "   ❌ ERROR: SIMP_EMBEDDED_APPLE_DEV_TOKEN was not generated (check APPLE_PRIVATE_KEY_PATH accessibility; run outside sandbox if key is on /mnt/c)." >&2
  exit 1
fi
if [[ "${HOST_OS}" != "Linux" || "${ARCH}" != "${HOST_ARCH}" ]]; then
  RUST_TARGET="${ARCH}-unknown-linux-gnu"
  chmod +x "${REPO_ROOT}/packaging/scripts/setup-aarch64-toolchain.sh"
  TOOLCHAIN_BIN="$("${REPO_ROOT}/packaging/scripts/setup-aarch64-toolchain.sh" "${ARCH}")"
  TOOLCHAIN_LIB="${HOME}/.cache/simp-toolchain/lib-${ARCH}"
  mkdir -p /tmp/simp-zig-cache
  export ZIG_GLOBAL_CACHE_DIR=/tmp/simp-zig-cache
  export ZIG_LOCAL_CACHE_DIR=/tmp/simp-zig-cache
  export PATH="${TOOLCHAIN_BIN}:${PATH}"
  if [[ "${ARCH}" == "aarch64" ]]; then
    export CC_aarch64_unknown_linux_gnu="${TOOLCHAIN_BIN}/aarch64-linux-gnu-gcc"
    export CXX_aarch64_unknown_linux_gnu="${TOOLCHAIN_BIN}/aarch64-linux-gnu-gcc"
    export AR_aarch64_unknown_linux_gnu="${TOOLCHAIN_BIN}/aarch64-linux-gnu-ar"
    export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER="${TOOLCHAIN_BIN}/aarch64-linux-gnu-gcc"
    export PKG_CONFIG_ALLOW_CROSS=1
    export PKG_CONFIG_PATH_aarch64_unknown_linux_gnu="${TOOLCHAIN_LIB}/pkgconfig"
    export PKG_CONFIG_LIBDIR_aarch64_unknown_linux_gnu="${TOOLCHAIN_LIB}/pkgconfig"
  else
    export CC_x86_64_unknown_linux_gnu="${TOOLCHAIN_BIN}/x86_64-linux-gnu-gcc"
    export CXX_x86_64_unknown_linux_gnu="${TOOLCHAIN_BIN}/x86_64-linux-gnu-gcc"
    export AR_x86_64_unknown_linux_gnu="${TOOLCHAIN_BIN}/x86_64-linux-gnu-ar"
    export CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER="${TOOLCHAIN_BIN}/x86_64-linux-gnu-gcc"
    export PKG_CONFIG_ALLOW_CROSS=1
    export PKG_CONFIG_PATH_x86_64_unknown_linux_gnu="${TOOLCHAIN_LIB}/pkgconfig"
    export PKG_CONFIG_LIBDIR_x86_64_unknown_linux_gnu="${TOOLCHAIN_LIB}/pkgconfig"
  fi
  "${CARGO_BIN}" build --release -p simp --target "${RUST_TARGET}" --offline
  BUILT_BIN="${REPO_ROOT}/target/${RUST_TARGET}/release/simp"
else
  "${CARGO_BIN}" build --release -p simp --offline
  BUILT_BIN="${REPO_ROOT}/target/release/simp"
fi

echo "4/4 Assembling dist/simp-steamos-userland/..."
rm -rf "${OUT_DIR}"
mkdir -p \
  "${OUT_DIR}/bin" \
  "${OUT_DIR}/lib" \
  "${OUT_DIR}/ui" \
  "${OUT_DIR}/systemd" \
  "${OUT_DIR}/desktop" \
  "${OUT_DIR}/openvr"

cp "${BUILT_BIN}" "${OUT_DIR}/bin/simp"
if [[ "${ARCH}" == "aarch64" && -f "${HOME}/.cache/simp-toolchain/lib-aarch64/libnspr4.so" ]]; then
  cp "${HOME}/.cache/simp-toolchain/lib-aarch64/libnspr4.so" "${OUT_DIR}/lib/libnspr4.so"
fi
cp -r "${REPO_ROOT}/ui/dist/"* "${OUT_DIR}/ui/"
cp "${REPO_ROOT}/packaging/systemd/simp.service" "${OUT_DIR}/systemd/simp.service"
cp "${REPO_ROOT}/packaging/desktop/org.simp.player.desktop" "${OUT_DIR}/desktop/org.simp.player.desktop"
cp "${REPO_ROOT}/packaging/openvr/org.simp.player.vrmanifest" "${OUT_DIR}/openvr/org.simp.player.vrmanifest"

# On x86_64 (Steam Deck / gamescope), bundle `simp-decky/` (~65 KB) inside `simp-steamos-userland`
# so both `install-steamos.sh` and 1-touch `simp update` install/update the Decky QAM plugin automatically!
if [[ "${WITH_DECKY}" == "1" ]]; then
  mkdir -p "${OUT_DIR}/simp-decky/dist"
  cp "${REPO_ROOT}/decky-plugin/plugin.json" "${OUT_DIR}/simp-decky/"
  cp "${REPO_ROOT}/decky-plugin/package.json" "${OUT_DIR}/simp-decky/"
  cp "${REPO_ROOT}/decky-plugin/main.py" "${OUT_DIR}/simp-decky/"
  cp "${REPO_ROOT}/decky-plugin/dist/"* "${OUT_DIR}/simp-decky/dist/"
fi

cp "${REPO_ROOT}/packaging/scripts/install-steamos.sh" "${OUT_DIR}/install-steamos.sh"
cp "${REPO_ROOT}/packaging/scripts/uninstall-steamos.sh" "${OUT_DIR}/uninstall-steamos.sh"
cp "${REPO_ROOT}/packaging/scripts/uninstall-steamos.sh" "${OUT_DIR}/bin/uninstall-steamos.sh"
chmod +x "${OUT_DIR}/install-steamos.sh" "${OUT_DIR}/uninstall-steamos.sh" "${OUT_DIR}/bin/uninstall-steamos.sh" "${OUT_DIR}/bin/simp"

if [[ "${HOST_OS}" == "Darwin" ]]; then
  xattr -cr "${OUT_DIR}" 2>/dev/null || true
  COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -C "${REPO_ROOT}/dist" -czf "${ARCH_ARCHIVE}" "simp-steamos-userland"
else
  tar --no-xattrs -C "${REPO_ROOT}/dist" -czf "${ARCH_ARCHIVE}" "simp-steamos-userland"
fi
if [[ "${ARCH}" == "x86_64" ]]; then
  cp "${ARCH_ARCHIVE}" "${ARCHIVE}"
fi

if [[ "${WITH_DECKY}" == "1" ]]; then
  DECKY_STAGE="${REPO_ROOT}/dist/decky-staging"
  rm -rf "${DECKY_STAGE}"
  mkdir -p "${DECKY_STAGE}/simp-decky/dist" "${DECKY_STAGE}/simp-decky/bin" "${DECKY_STAGE}/simp-decky/ui"
  cp "${REPO_ROOT}/decky-plugin/plugin.json" "${DECKY_STAGE}/simp-decky/"
  cp "${REPO_ROOT}/decky-plugin/package.json" "${DECKY_STAGE}/simp-decky/"
  cp "${REPO_ROOT}/decky-plugin/main.py" "${DECKY_STAGE}/simp-decky/"
  cp "${REPO_ROOT}/decky-plugin/dist/"* "${DECKY_STAGE}/simp-decky/dist/"
  cp "${OUT_DIR}/bin/simp" "${DECKY_STAGE}/simp-decky/bin/simp"
  cp -r "${OUT_DIR}/ui/"* "${DECKY_STAGE}/simp-decky/ui/"
  chmod +x "${DECKY_STAGE}/simp-decky/bin/simp"
  (cd "${DECKY_STAGE}" && python3 -m zipfile -c "${DECKY_ZIP}" simp-decky)
  rm -rf "${DECKY_STAGE}"
fi

echo "============================================================"
echo "✅ Release Bundle Ready (${ARCH}):"
echo "   • Directory:   ${OUT_DIR} (100% Decky-free core + OpenVR manifest)"
echo "   • Tarball:     ${ARCH_ARCHIVE}"
if [[ "${WITH_DECKY}" == "1" ]]; then
  echo "   • Decky ZIP:   ${DECKY_ZIP} (separate optional add-on)"
fi
echo "============================================================"

