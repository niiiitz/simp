#!/usr/bin/env bash
set -euo pipefail

# One-command WSL2 -> Steam Deck / Steam Machine / Steam Frame LAN deployer
TARGET="${1:-deck@steamdeck}"
echo "Deploying SIMP to $TARGET..."

cargo build --release -p simp
ssh "$TARGET" "mkdir -p ~/.local/share/SIMP ~/.config/systemd/user"
scp target/release/simp "$TARGET:~/.local/share/SIMP/simp"
scp packaging/systemd/simp.service "$TARGET:~/.config/systemd/user/simp.service"
ssh "$TARGET" "systemctl --user daemon-reload && systemctl --user enable simp.service --now && systemctl --user restart simp.service"

echo "✅ SIMP deployed and running on $TARGET!"

