#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# SIMP — Reliable GitHub Release Publisher (IPv4 + HTTP/1.1 Sequential Uploader)
# Avoids `gh release upload` Go HTTP/2 + IPv6 `HTTP 408` upload stalls and
# ensures every release is published as `Latest` (`prerelease: false`).
#
# Usage:
#   ./packaging/scripts/publish-github-release.sh v0.1.0-alpha.41 [notes_file]
# ==============================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

TAG="${1:-}"
NOTES_FILE="${2:-}"

if [[ -z "${TAG}" ]]; then
  echo "Usage: $0 <vX.Y.Z-alpha.N> [notes_file]" >&2
  exit 1
fi

TAG="v${TAG#v}"

python3 - "${TAG}" "${NOTES_FILE}" <<'PY'
import json
import os
import subprocess
import sys

tag = sys.argv[1]
notes_file = sys.argv[2] if len(sys.argv) > 2 else ""

notes = f"SIMP {tag}"
if notes_file and os.path.isfile(notes_file):
    with open(notes_file, "r", encoding="utf-8") as f:
        notes = f.read()

token = os.environ.get("GH_TOKEN", "").strip()
if not token:
    try:
        token = subprocess.check_output(["gh", "auth", "token"], text=True).strip()
    except Exception:
        pass
for env_candidate in [".env", os.path.expanduser("~/simp/.env")]:
    if not token and os.path.isfile(env_candidate):
        for line in open(env_candidate, "r", encoding="utf-8"):
            line = line.strip()
            if line.startswith("GH_TOKEN="):
                token = line.split("=", 1)[1].strip().strip("'").strip('"')

if not token:
    print("❌ ERROR: Could not resolve GitHub token from gh auth token or .env", file=sys.stderr)
    sys.exit(1)

repo = "niiiitz/simp"

def api_call(method, url, payload=None):
    cmd = [
        "curl", "-4", "--http1.1", "--retry", "3", "-sS",
        "-X", method,
        "-H", f"Authorization: Bearer {token}",
        "-H", "Accept: application/vnd.github+json",
    ]
    if payload is not None:
        cmd.extend(["-H", "Content-Type: application/json", "-d", json.dumps(payload)])
    cmd.append(url)
    out = subprocess.check_output(cmd, text=True)
    return json.loads(out) if out.strip() else {}

# 1. Check if release already exists for tag
check_cmd = [
    "curl", "-4", "--http1.1", "-sS",
    "-H", f"Authorization: Bearer {token}",
    "-H", "Accept: application/vnd.github+json",
    f"https://api.github.com/repos/{repo}/releases/tags/{tag}",
]
rel_raw = subprocess.check_output(check_cmd, text=True)
rel = json.loads(rel_raw)

if "id" in rel:
    rel_id = rel["id"]
    print(f"Updating existing release {tag} (ID {rel_id}, prerelease=false)...")
    rel = api_call(
        "PATCH",
        f"https://api.github.com/repos/{repo}/releases/{rel_id}",
        {
            "tag_name": tag,
            "name": f"SIMP {tag}",
            "body": notes,
            "draft": False,
            "prerelease": False,
            "make_latest": "true",
        },
    )
else:
    print(f"Creating release {tag} (prerelease=false, make_latest=true)...")
    rel = api_call(
        "POST",
        f"https://api.github.com/repos/{repo}/releases",
        {
            "tag_name": tag,
            "name": f"SIMP {tag}",
            "body": notes,
            "draft": False,
            "prerelease": False,
            "make_latest": "true",
        },
    )
    rel_id = rel["id"]

existing_assets = {a["name"]: a["id"] for a in rel.get("assets", [])}

assets = [
    ("dist/simp-steamos-userland-aarch64.tar.gz", "application/gzip"),
    ("dist/simp-steamos-userland-x86_64.tar.gz", "application/gzip"),
    ("dist/simp-steamos-userland.tar.gz", "application/gzip"),
    ("dist/simp-decky.zip", "application/zip"),
    ("dist/simp-windows-portable-x86_64.zip", "application/zip"),
]

for path, ctype in assets:
    if not os.path.isfile(path):
        print(f"⚠️ Skipping missing asset {path}")
        continue
    name = os.path.basename(path)
    if name in existing_assets:
        print(f"Removing previous asset {name} ({existing_assets[name]})...")
        api_call("DELETE", f"https://api.github.com/repos/{repo}/releases/assets/{existing_assets[name]}")

    upload_url = f"https://uploads.github.com/repos/{repo}/releases/{rel_id}/assets?name={name}"
    print(f"Uploading {name} ({os.path.getsize(path)} bytes) over IPv4 HTTP/1.1...")
    res = subprocess.run(
        [
            "curl", "-4", "--http1.1", "--retry", "3", "--retry-all-errors",
            "-sS", "-X", "POST",
            "-H", f"Authorization: Bearer {token}",
            "-H", f"Content-Type: {ctype}",
            "--data-binary", f"@{path}",
            upload_url,
        ],
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        print(f"❌ Failed uploading {name}: {res.stderr}", file=sys.stderr)
        sys.exit(1)
    uploaded = json.loads(res.stdout)
    print(f"  ✓ {uploaded.get('name')} ({uploaded.get('size')} bytes, state={uploaded.get('state')})")

print(f"✅ Release published: {rel.get('html_url', f'https://github.com/{repo}/releases/tag/{tag}')}")
PY

