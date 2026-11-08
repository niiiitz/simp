#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# SIMP — Zero-Sudo Userland aarch64-unknown-linux-gnu Cross-Toolchain Provisioner
# Uses Zig CC (`-target aarch64-linux-gnu.2.35`) + link-time stub shared libraries
# (`libasound.so.2`, `libdbus-1.so.3`) so `cargo build --target aarch64-unknown-linux-gnu`
# produces a portable ARM64 ELF binary compatible with SteamOS / Steam Frame (glibc >= 2.35).
# ==============================================================================

TARGET_ARCH="${1:-aarch64}"
TOOLCHAIN_DIR="${HOME}/.cache/simp-toolchain"
BIN_DIR="${TOOLCHAIN_DIR}/bin"
LIB_DIR="${TOOLCHAIN_DIR}/lib-${TARGET_ARCH}"
ZIG_VER="0.13.0"
HOST_OS="$(uname -s)"
HOST_ARCH="$(uname -m)"
if [[ "${HOST_OS}" == "Darwin" ]]; then
  if [[ "${HOST_ARCH}" == "arm64" || "${HOST_ARCH}" == "aarch64" ]]; then
    ZIG_SLUG="zig-macos-aarch64-${ZIG_VER}"
  else
    ZIG_SLUG="zig-macos-x86_64-${ZIG_VER}"
  fi
else
  if [[ "${HOST_ARCH}" == "aarch64" || "${HOST_ARCH}" == "arm64" ]]; then
    ZIG_SLUG="zig-linux-aarch64-${ZIG_VER}"
  else
    ZIG_SLUG="zig-linux-x86_64-${ZIG_VER}"
  fi
fi
ZIG_DIR="${TOOLCHAIN_DIR}/${ZIG_SLUG}"
ZIG_BIN="${ZIG_DIR}/zig"

[[ -d "${BIN_DIR}" && -d "${LIB_DIR}" ]] || mkdir -p "${BIN_DIR}" "${LIB_DIR}"

if [[ ! -x "${ZIG_BIN}" ]]; then
  echo "   • Downloading userland Zig ${ZIG_VER} (${ZIG_SLUG}) cross-compiler into ${TOOLCHAIN_DIR}..." >&2
  TARBALL="${TOOLCHAIN_DIR}/${ZIG_SLUG}.tar.xz"
  curl -fsSL "https://ziglang.org/download/${ZIG_VER}/${ZIG_SLUG}.tar.xz" -o "${TARBALL}"
  tar -xJf "${TARBALL}" -C "${TOOLCHAIN_DIR}"
  rm -f "${TARBALL}"
fi

# 1. Generate link-time ELF stub shared libraries (`DT_SONAME: libasound.so.2` & `libdbus-1.so.3`)
# CRITICAL: Must include `asound.map` (`ALSA_0.9`, `ALSA_0.9.0rc4`, `ALSA_0.9.0rc8`) and `dbus.map` (`LIBDBUS_1_3`)
# so `glibc` `dl-lookup.c` binds `snd_pcm_hw_params_get_rate_min` / `set_buffer_time_near` to `ALSA_0.9.0rc4`
# (the modern 3-arg ABI returning 0) instead of `ALSA_0.9` (the 1999 2-arg ABI returning the sample rate!).
if [[ ! -f "${LIB_DIR}/libasound.so" || ! -f "${LIB_DIR}/libdbus-1.so" || ! -f "${LIB_DIR}/asound.map" || ! -f "${LIB_DIR}/libnspr4.so" ]]; then
  cat > "${LIB_DIR}/alsa_stubs.c" <<'EOF'
#define STUB(name) void name(void) {}
STUB(snd_device_name_free_hint)
STUB(snd_device_name_get_hint)
STUB(snd_device_name_hint)
STUB(snd_pcm_avail)
STUB(snd_pcm_bytes_to_frames)
STUB(snd_pcm_close)
STUB(snd_pcm_get_params)
STUB(snd_pcm_hw_params)
STUB(snd_pcm_hw_params_any)
STUB(snd_pcm_hw_params_can_pause)
STUB(snd_pcm_hw_params_free)
STUB(snd_pcm_hw_params_get_buffer_size_max)
STUB(snd_pcm_hw_params_get_buffer_size_min)
STUB(snd_pcm_hw_params_get_channels_max)
STUB(snd_pcm_hw_params_get_channels_min)
STUB(snd_pcm_hw_params_get_rate_max)
STUB(snd_pcm_hw_params_get_rate_min)
STUB(snd_pcm_hw_params_malloc)
STUB(snd_pcm_hw_params_set_access)
STUB(snd_pcm_hw_params_set_buffer_size)
STUB(snd_pcm_hw_params_set_buffer_time_near)
STUB(snd_pcm_hw_params_set_channels)
STUB(snd_pcm_hw_params_set_format)
STUB(snd_pcm_hw_params_set_period_size_near)
STUB(snd_pcm_hw_params_set_period_time_near)
STUB(snd_pcm_hw_params_set_rate)
STUB(snd_pcm_hw_params_test_channels)
STUB(snd_pcm_hw_params_test_format)
STUB(snd_pcm_hw_params_test_rate)
STUB(snd_pcm_open)
STUB(snd_pcm_pause)
STUB(snd_pcm_poll_descriptors)
STUB(snd_pcm_poll_descriptors_count)
STUB(snd_pcm_poll_descriptors_revents)
STUB(snd_pcm_prepare)
STUB(snd_pcm_recover)
STUB(snd_pcm_status)
STUB(snd_pcm_status_get_delay)
STUB(snd_pcm_status_get_htstamp)
STUB(snd_pcm_status_get_trigger_htstamp)
STUB(snd_pcm_status_sizeof)
STUB(snd_pcm_sw_params)
STUB(snd_pcm_sw_params_current)
STUB(snd_pcm_sw_params_free)
STUB(snd_pcm_sw_params_malloc)
STUB(snd_pcm_sw_params_set_avail_min)
STUB(snd_pcm_sw_params_set_start_threshold)
STUB(snd_pcm_sw_params_set_tstamp_mode)
STUB(snd_pcm_sw_params_set_tstamp_type)
STUB(snd_pcm_writei)
STUB(snd_strerror)
EOF

  cat > "${LIB_DIR}/asound.map" <<'EOF'
ALSA_0.9 {
  global:
    snd_device_name_free_hint;
    snd_device_name_get_hint;
    snd_device_name_hint;
    snd_pcm_avail;
    snd_pcm_bytes_to_frames;
    snd_pcm_close;
    snd_pcm_get_params;
    snd_pcm_hw_params;
    snd_pcm_hw_params_any;
    snd_pcm_hw_params_can_pause;
    snd_pcm_hw_params_free;
    snd_pcm_hw_params_malloc;
    snd_pcm_hw_params_set_access;
    snd_pcm_hw_params_set_buffer_size;
    snd_pcm_hw_params_set_channels;
    snd_pcm_hw_params_set_format;
    snd_pcm_hw_params_set_rate;
    snd_pcm_hw_params_test_channels;
    snd_pcm_hw_params_test_format;
    snd_pcm_hw_params_test_rate;
    snd_pcm_open;
    snd_pcm_pause;
    snd_pcm_poll_descriptors;
    snd_pcm_poll_descriptors_count;
    snd_pcm_poll_descriptors_revents;
    snd_pcm_prepare;
    snd_pcm_recover;
    snd_pcm_status;
    snd_pcm_status_get_delay;
    snd_pcm_status_sizeof;
    snd_pcm_sw_params;
    snd_pcm_sw_params_current;
    snd_pcm_sw_params_free;
    snd_pcm_sw_params_malloc;
    snd_pcm_sw_params_set_avail_min;
    snd_pcm_sw_params_set_start_threshold;
    snd_pcm_sw_params_set_tstamp_mode;
    snd_pcm_sw_params_set_tstamp_type;
    snd_pcm_writei;
    snd_strerror;
};

ALSA_0.9.0rc4 {
  global:
    snd_pcm_hw_params_get_buffer_size_max;
    snd_pcm_hw_params_get_buffer_size_min;
    snd_pcm_hw_params_get_channels_max;
    snd_pcm_hw_params_get_channels_min;
    snd_pcm_hw_params_get_rate_max;
    snd_pcm_hw_params_get_rate_min;
    snd_pcm_hw_params_set_buffer_time_near;
    snd_pcm_hw_params_set_period_size_near;
    snd_pcm_hw_params_set_period_time_near;
} ALSA_0.9;

ALSA_0.9.0rc8 {
  global:
    snd_pcm_status_get_htstamp;
    snd_pcm_status_get_trigger_htstamp;
} ALSA_0.9.0rc4;
EOF

  cat > "${LIB_DIR}/dbus_stubs.c" <<'EOF'
#define STUB(name) void name(void) {}
STUB(dbus_bus_get_private)
STUB(dbus_connection_close)
STUB(dbus_connection_pop_message)
STUB(dbus_connection_read_write)
STUB(dbus_connection_send)
STUB(dbus_connection_send_with_reply_and_block)
STUB(dbus_connection_set_exit_on_disconnect)
STUB(dbus_connection_set_watch_functions)
STUB(dbus_connection_unref)
STUB(dbus_error_free)
STUB(dbus_error_init)
STUB(dbus_free)
STUB(dbus_get_local_machine_id)
STUB(dbus_message_copy)
STUB(dbus_message_get_interface)
STUB(dbus_message_get_member)
STUB(dbus_message_get_no_reply)
STUB(dbus_message_get_path)
STUB(dbus_message_get_sender)
STUB(dbus_message_get_type)
STUB(dbus_message_iter_append_basic)
STUB(dbus_message_iter_append_fixed_array)
STUB(dbus_message_iter_close_container)
STUB(dbus_message_iter_get_arg_type)
STUB(dbus_message_iter_get_basic)
STUB(dbus_message_iter_get_element_type)
STUB(dbus_message_iter_get_fixed_array)
STUB(dbus_message_iter_get_signature)
STUB(dbus_message_iter_init)
STUB(dbus_message_iter_init_append)
STUB(dbus_message_iter_next)
STUB(dbus_message_iter_open_container)
STUB(dbus_message_iter_recurse)
STUB(dbus_message_new_error)
STUB(dbus_message_new_method_call)
STUB(dbus_message_new_method_return)
STUB(dbus_message_new_signal)
STUB(dbus_message_unref)
STUB(dbus_set_error)
STUB(dbus_set_error_from_message)
STUB(dbus_signature_validate_single)
STUB(dbus_threads_init_default)
STUB(dbus_validate_bus_name)
STUB(dbus_validate_error_name)
STUB(dbus_validate_interface)
STUB(dbus_validate_member)
STUB(dbus_validate_path)
EOF

  cat > "${LIB_DIR}/dbus.map" <<'EOF'
LIBDBUS_1_3 {
  global:
    *;
};
EOF

  cat > "${LIB_DIR}/nspr4_stub.c" <<'EOF'
void __simp_nspr4_placeholder(void) {}
EOF

  "${ZIG_BIN}" cc -target "${TARGET_ARCH}-linux-gnu.2.35" -shared -Wl,-soname,libasound.so.2 \
    -Wl,--version-script="${LIB_DIR}/asound.map" \
    "${LIB_DIR}/alsa_stubs.c" -o "${LIB_DIR}/libasound.so.2"
  ln -sf "${LIB_DIR}/libasound.so.2" "${LIB_DIR}/libasound.so"

  "${ZIG_BIN}" cc -target "${TARGET_ARCH}-linux-gnu.2.35" -shared -Wl,-soname,libdbus-1.so.3 \
    -Wl,--version-script="${LIB_DIR}/dbus.map" \
    "${LIB_DIR}/dbus_stubs.c" -o "${LIB_DIR}/libdbus-1.so.3"
  ln -sf "${LIB_DIR}/libdbus-1.so.3" "${LIB_DIR}/libdbus-1.so"

  "${ZIG_BIN}" cc -target "${TARGET_ARCH}-linux-gnu.2.35" -shared -Wl,-soname,libnspr4.so \
    "${LIB_DIR}/nspr4_stub.c" -o "${LIB_DIR}/libnspr4.so"
fi

# 1b. Generate pkg-config `.pc` files for `alsa-sys` and `libdbus-sys` cross-builds
if [[ ! -f "${LIB_DIR}/pkgconfig/alsa.pc" || ! -f "${LIB_DIR}/pkgconfig/dbus-1.pc" ]]; then
  mkdir -p "${LIB_DIR}/pkgconfig"
  cat > "${LIB_DIR}/pkgconfig/alsa.pc" <<EOF
prefix=${TOOLCHAIN_DIR}
exec_prefix=\${prefix}
libdir=${LIB_DIR}
includedir=/usr/include

Name: alsa
Description: Advanced Linux Sound Architecture (ALSA) - Library (${TARGET_ARCH} Stub)
Version: 1.2.10
Libs: -L\${libdir} -lasound
Cflags: -I\${includedir}
EOF

  cat > "${LIB_DIR}/pkgconfig/dbus-1.pc" <<EOF
prefix=${TOOLCHAIN_DIR}
exec_prefix=\${prefix}
libdir=${LIB_DIR}
includedir=/usr/include/dbus-1.0

Name: dbus
Description: Free desktop message bus (${TARGET_ARCH} Stub)
Version: 1.14.10
Libs: -L\${libdir} -ldbus-1
Cflags: -I\${includedir}
EOF
fi

# 2. Create `${TARGET_ARCH}-linux-gnu-gcc` and `${TARGET_ARCH}-linux-gnu-ar` wrappers
cat > "${BIN_DIR}/${TARGET_ARCH}-linux-gnu-gcc" <<EOF
#!/usr/bin/env bash
ARGS=()
for arg in "\$@"; do
  case "\$arg" in
    --target=${TARGET_ARCH}-unknown-linux-gnu|-target|${TARGET_ARCH}-unknown-linux-gnu|-Wl,--fix-cortex-a53-843419)
      ;;
    *)
      ARGS+=("\$arg")
      ;;
  esac
done
exec "${ZIG_BIN}" cc -target ${TARGET_ARCH}-linux-gnu.2.35 -L"${LIB_DIR}" "\${ARGS[@]}"
EOF
chmod +x "${BIN_DIR}/${TARGET_ARCH}-linux-gnu-gcc"

cat > "${BIN_DIR}/${TARGET_ARCH}-linux-gnu-ar" <<EOF
#!/usr/bin/env bash
exec "${ZIG_BIN}" ar "\$@"
EOF
chmod +x "${BIN_DIR}/${TARGET_ARCH}-linux-gnu-ar"

echo "${BIN_DIR}"
