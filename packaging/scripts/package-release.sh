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
if [[ -f "${REPO_ROOT}/.env" && -z "${SIMP_EMBEDDED_APPLE_DEV_TOKEN:-}" ]]; then
  EMBEDDED_JWT="$(python3 - <<'PY' || true
import base64, json, os, subprocess, time

env = {}
if os.path.exists(".env"):
    for line in open(".env"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip("'").strip('"')

team_id = env.get("APPLE_TEAM_ID", "")
key_id = env.get("APPLE_KEY_ID", "")
key_path = env.get("APPLE_PRIVATE_KEY_PATH", "")

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

