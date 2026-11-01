#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo " SIMP — WSL2 / Ubuntu Toolchain & Dependencies Bootstrap"
echo "=========================================================="

echo "[1/2] Installing Linux audio, D-Bus, and Tauri v2 dev packages via apt..."
sudo apt update
sudo apt install -y \
  build-essential \
  pkg-config \
  curl \
  wget \
  file \
  libasound2-dev \
  libasound2-plugins \
  pulseaudio-utils \
  libpulse-dev \
  libdbus-1-dev \
  libssl-dev \
  libglib2.0-dev \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf

if ! command -v cargo >/dev/null 2>&1; then
  echo "[2/2] Installing Rust stable toolchain via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
else
  echo "[2/2] Rust toolchain already installed: $(rustc --version)"
fi

echo ""
echo "✅ Bootstrap complete! Run: source \"\$HOME/.cargo/env\" && cargo check --workspace"

