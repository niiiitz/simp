#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Xcode Run Script Build Phase for SIMP (org.simp.player)
# Bridges Xcode (Automatic Signing / Run / Archive / Notarize) with Cargo & Vite
# ==============================================================================

export PATH="/usr/local/opt/node@24/bin:/opt/homebrew/opt/node@24/bin:${HOME}/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

REPO_ROOT="$(cd "${SRCROOT}/../.." && pwd)"
cd "${REPO_ROOT}"

# Build dist/SIMP.app using the canonical macOS packaging script
"${REPO_ROOT}/packaging/scripts/package-macos.sh"

# Populate Xcode's target bundle so Xcode's native code signing, LLDB, and Archive work seamlessly
DEST_APP="${TARGET_BUILD_DIR}/${WRAPPER_NAME}"
mkdir -p "${DEST_APP}/Contents/MacOS" "${DEST_APP}/Contents/Resources/ui"

cp "${REPO_ROOT}/dist/SIMP.app/Contents/MacOS/simp" "${DEST_APP}/Contents/MacOS/simp"
chmod +x "${DEST_APP}/Contents/MacOS/simp"
cp "${REPO_ROOT}/dist/SIMP.app/Contents/Resources/SIMP.icns" "${DEST_APP}/Contents/Resources/SIMP.icns"
cp -R "${REPO_ROOT}/dist/SIMP.app/Contents/Resources/ui/"* "${DEST_APP}/Contents/Resources/ui/"

