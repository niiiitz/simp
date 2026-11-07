#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# SIMP (org.simp.player) — Native macOS .app Bundle & Signed Release Packager
# Produces:
#   dist/SIMP.app
#   dist/SIMP-macos-arm64.zip (or dist/SIMP-macos-x86_64.zip)
# ==============================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

export PATH="/usr/local/opt/node@24/bin:/opt/homebrew/opt/node@24/bin:${HOME}/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

CARGO_BIN="${CARGO_BIN:-$(command -v cargo || echo "${HOME}/.cargo/bin/cargo")}"
if [[ -x "/usr/bin/python3" ]]; then
  PYTHON_BIN="/usr/bin/python3"
else
  PYTHON_BIN="$(command -v python3)"
fi
HOST_ARCH="$(uname -m)"
if [[ "${HOST_ARCH}" == "arm64" || "${HOST_ARCH}" == "aarch64" ]]; then
  ARCH_SLUG="arm64"
else
  ARCH_SLUG="x86_64"
fi

APP_BUNDLE="${REPO_ROOT}/dist/SIMP.app"
ZIP_ARCHIVE="${REPO_ROOT}/dist/SIMP-macos-${ARCH_SLUG}.zip"

echo "============================================================"
echo " Building SIMP macOS Native Application Bundle (${ARCH_SLUG})"
echo "============================================================"

# 0. Determine and synchronize release version
TARGET_VERSION="${1:-${SIMP_VERSION:-}}"
SYNCED_VERSION="$(TARGET_VERSION="${TARGET_VERSION}" "${PYTHON_BIN}" - <<'PY'
import json, os, re

pkg_path = "package.json"
with open(pkg_path, "r", encoding="utf-8") as f:
    pkg = json.load(f)

raw_ver = os.environ.get("TARGET_VERSION", "").strip().lstrip("v")
if not raw_ver:
    raw_ver = pkg.get("version", "0.1.0-alpha").lstrip("v")

for p_path in ["decky-plugin/package.json", "package.json", "ui/package.json", "packages/simp-client/package.json"]:
    if os.path.isfile(p_path):
        with open(p_path, "r", encoding="utf-8") as f:
            p_data = json.load(f)
        if p_data.get("version") != raw_ver:
            p_data["version"] = raw_ver
            with open(p_path, "w", encoding="utf-8") as f:
                json.dump(p_data, f, indent=2)
                f.write("\n")

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

print(raw_ver, end="")
PY
)"
echo "0/5 Target version: v${SYNCED_VERSION}"

echo "1/5 Building production React UI (ui/dist)..."
if [[ -d "${REPO_ROOT}/node_modules" ]]; then
  npm run build:ui
elif [[ -f "${REPO_ROOT}/ui/dist/index.html" ]]; then
  echo "   • Using prebuilt ui/dist"
else
  npm run build:ui
fi

echo "2/5 Minting embedded credentials & compiling release Rust binary..."
ENV_FILE="${REPO_ROOT}/.env"
if [[ ! -f "${ENV_FILE}" && -f "${HOME}/simp/.env" ]]; then
  ENV_FILE="${HOME}/simp/.env"
fi

if [[ -z "${SIMP_EMBEDDED_APPLE_DEV_TOKEN:-}" && -s "/tmp/.simp_embedded_jwt" ]]; then
  export SIMP_EMBEDDED_APPLE_DEV_TOKEN="$(cat /tmp/.simp_embedded_jwt)"
fi
if [[ -f "${ENV_FILE}" && -z "${SIMP_EMBEDDED_APPLE_DEV_TOKEN:-}" ]]; then
  EMBEDDED_JWT="$(ENV_FILE="${ENV_FILE}" "${PYTHON_BIN}" - <<'PY' || true
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
    exp = now + 86400 * 150
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
    echo "   • Baked 150-day ES256 Apple Developer Token into binary"
  fi
fi

if [[ -f "${ENV_FILE}" ]]; then
  SC_ID="$(ENV_FILE="${ENV_FILE}" "${PYTHON_BIN}" -c 'import os; env=dict(l.strip().split("=",1) for l in open(os.environ["ENV_FILE"]) if l.strip() and not l.strip().startswith("#") and "=" in l); print(env.get("SOUNDCLOUD_CLIENT_ID","").strip().strip("\x27\x22"), end="")' 2>/dev/null || true)"
  SC_SEC="$(ENV_FILE="${ENV_FILE}" "${PYTHON_BIN}" -c 'import os; env=dict(l.strip().split("=",1) for l in open(os.environ["ENV_FILE"]) if l.strip() and not l.strip().startswith("#") and "=" in l); print(env.get("SOUNDCLOUD_CLIENT_SECRET","").strip().strip("\x27\x22"), end="")' 2>/dev/null || true)"
  if [[ -n "${SC_ID}" && -n "${SC_SEC}" ]]; then
    export SIMP_EMBEDDED_SOUNDCLOUD_CLIENT_ID="${SC_ID}"
    export SIMP_EMBEDDED_SOUNDCLOUD_CLIENT_SECRET="${SC_SEC}"
    echo "   • Baked SoundCloud Client Credentials into binary"
  fi
fi

"${CARGO_BIN}" build --release -p simp --offline
BUILT_BIN="${REPO_ROOT}/target/release/simp"

echo "3/5 Generating macOS SIMP.icns icon set..."
ICON_SRC="${REPO_ROOT}/ui/public/simp-icon-dark.png"
ICONSET_DIR="${REPO_ROOT}/dist/SIMP.iconset"
rm -rf "${ICONSET_DIR}" "${APP_BUNDLE}" "${ZIP_ARCHIVE}"
mkdir -p "${ICONSET_DIR}" \
  "${APP_BUNDLE}/Contents/MacOS" \
  "${APP_BUNDLE}/Contents/Resources/ui"

for sz in 16 32 128 256 512; do
  sips -z "${sz}" "${sz}" "${ICON_SRC}" --out "${ICONSET_DIR}/icon_${sz}x${sz}.png" >/dev/null
  sz2=$((sz * 2))
  sips -z "${sz2}" "${sz2}" "${ICON_SRC}" --out "${ICONSET_DIR}/icon_${sz}x${sz}@2x.png" >/dev/null
done
iconutil -c icns "${ICONSET_DIR}" -o "${APP_BUNDLE}/Contents/Resources/SIMP.icns"
rm -rf "${ICONSET_DIR}"

echo "4/5 Assembling dist/SIMP.app bundle..."
sed "s/__SIMP_VERSION__/${SYNCED_VERSION}/g" \
  "${REPO_ROOT}/packaging/macos/Info.plist" > "${APP_BUNDLE}/Contents/Info.plist"

cp "${BUILT_BIN}" "${APP_BUNDLE}/Contents/MacOS/simp"
chmod +x "${APP_BUNDLE}/Contents/MacOS/simp"
cp -R "${REPO_ROOT}/ui/dist/"* "${APP_BUNDLE}/Contents/Resources/ui/"

echo "5/5 Code signing dist/SIMP.app and creating dist/SIMP-macos-${ARCH_SLUG}.zip..."
SIGN_IDENTITY="${MACOS_CODESIGN_IDENTITY:-${EXPANDED_CODE_SIGN_IDENTITY:-}}"
SIGN_LABEL="${EXPANDED_CODE_SIGN_IDENTITY_NAME:-}"
if [[ -z "${SIGN_IDENTITY}" ]]; then
  # Auto-detect Developer ID Application or Apple Development identity SHA-1 hash in Keychain if present
  SIGN_IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | awk '/Developer ID Application|Apple Development/ {print $2; exit}' || true)"
  SIGN_LABEL="$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Developer ID Application|Apple Development/ {print $2; exit}' || true)"
fi
if [[ -z "${SIGN_IDENTITY}" ]]; then
  SIGN_IDENTITY="-"
  echo "   • Signing with ad-hoc identity (-) + entitlements (no Apple Developer X.509 certificate in Keychain)"
  codesign --force --deep \
    --entitlements "${REPO_ROOT}/packaging/macos/entitlements.plist" \
    --sign "${SIGN_IDENTITY}" \
    "${APP_BUNDLE}"
else
  echo "   • Signing with Keychain identity (Hardened Runtime): ${SIGN_LABEL:-${SIGN_IDENTITY}} (${SIGN_IDENTITY})"
  codesign --force --deep \
    --options runtime \
    --entitlements "${REPO_ROOT}/packaging/macos/entitlements.plist" \
    --sign "${SIGN_IDENTITY}" \
    "${APP_BUNDLE}"
fi

codesign --verify --deep --strict "${APP_BUNDLE}"
ditto -c -k --keepParent "${APP_BUNDLE}" "${ZIP_ARCHIVE}"

echo "============================================================"
echo "✅ macOS Application Bundle Ready (${ARCH_SLUG}):"
echo "   • App Bundle:  ${APP_BUNDLE}"
echo "   • Release ZIP: ${ZIP_ARCHIVE}"
echo "============================================================"
