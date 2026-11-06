#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# SIMP — Zero-Sudo Userland x86_64-pc-windows-gnu Cross-Toolchain Provisioner
# Uses cached Zig CC (`-target x86_64-windows-gnu`) so `cargo build --target x86_64-pc-windows-gnu`
# produces a standalone 64-bit Windows executable (`simp.exe`) from Linux / WSL2.
# ==============================================================================

TOOLCHAIN_DIR="${HOME}/.cache/simp-toolchain"
BIN_DIR="${TOOLCHAIN_DIR}/bin"
ZIG_VER="0.13.0"
ZIG_DIR="${TOOLCHAIN_DIR}/zig-linux-x86_64-${ZIG_VER}"
ZIG_BIN="${ZIG_DIR}/zig"

mkdir -p "${BIN_DIR}"

if [[ ! -x "${ZIG_BIN}" ]]; then
  echo "   • Downloading userland Zig ${ZIG_VER} cross-compiler into ${TOOLCHAIN_DIR}..." >&2
  TARBALL="${TOOLCHAIN_DIR}/zig-${ZIG_VER}.tar.xz"
  curl -fsSL "https://ziglang.org/download/${ZIG_VER}/zig-linux-x86_64-${ZIG_VER}.tar.xz" -o "${TARBALL}"
  tar -xJf "${TARBALL}" -C "${TOOLCHAIN_DIR}"
  rm -f "${TARBALL}"
fi

cat > "${BIN_DIR}/x86_64-w64-mingw32-gcc" <<EOF
#!/usr/bin/env bash
ARGS=()
IS_COMPILE=0
for arg in "\$@"; do
  case "\$arg" in
    -c)
      IS_COMPILE=1
      ARGS+=("\$arg")
      ;;
    --target=x86_64-pc-windows-gnu|-target|x86_64-pc-windows-gnu|-fno-use-linker-plugin|-Wl,--disable-auto-image-base|-Wl,--nxcompat|-Wl,--dynamicbase|-Wl,--high-entropy-va|-Wl,--large-address-aware|-Wl,-Bdynamic|-Wl,-Bstatic|-lgcc_eh|-lgcc|-lmsvcrt|-lmingwex|-lmingw32|-l:libpthread.a|-nodefaultlibs|*libcompiler_builtins*.rlib)
      ;;
    *)
      ARGS+=("\$arg")
      ;;
  esac
done
if [[ "\${IS_COMPILE}" -eq 0 ]]; then
  ARGS+=("-Wno-dll-attribute-on-redeclaration" "-lunwind")
fi
exec "${ZIG_BIN}" cc -target x86_64-windows-gnu "\${ARGS[@]}"
EOF

cat > "${BIN_DIR}/x86_64-w64-mingw32-g++" <<EOF
#!/usr/bin/env bash
exec "${ZIG_BIN}" c++ -target x86_64-windows-gnu "\$@"
EOF

cat > "${BIN_DIR}/x86_64-w64-mingw32-ar" <<EOF
#!/usr/bin/env bash
exec "${ZIG_BIN}" ar "\$@"
EOF

cat > "${BIN_DIR}/x86_64-w64-mingw32-ranlib" <<EOF
#!/usr/bin/env bash
exec "${ZIG_BIN}" ranlib "\$@"
EOF

cat > "${BIN_DIR}/x86_64-w64-mingw32-dlltool" <<EOF
#!/usr/bin/env bash
exec "${ZIG_BIN}" dlltool "\$@"
EOF

chmod +x \
  "${BIN_DIR}/x86_64-w64-mingw32-gcc" \
  "${BIN_DIR}/x86_64-w64-mingw32-g++" \
  "${BIN_DIR}/x86_64-w64-mingw32-ar" \
  "${BIN_DIR}/x86_64-w64-mingw32-ranlib" \
  "${BIN_DIR}/x86_64-w64-mingw32-dlltool"

echo "${BIN_DIR}"

