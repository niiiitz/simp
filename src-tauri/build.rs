use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=../packaging/windows/simp.ico");
    println!("cargo:rerun-if-changed=../packaging/windows/simp.rc");
    println!("cargo:rerun-if-changed=../packaging/windows/simp.res");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
        let win_dir = manifest_dir.join("../packaging/windows");
        let rc_path = win_dir.join("simp.rc");
        let prebuilt_res = win_dir.join("simp.res");
        let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap_or_else(|_| "/tmp".to_string()));
        let out_coff = out_dir.join("simp_res.o");
        let out_res = out_dir.join("simp.res");

        let mut linked_artifact: Option<PathBuf> = None;

        // 1. Prefer `x86_64-w64-mingw32-windres -O coff` when building with GNU binutils / MinGW-w64
        //    (e.g. on macOS `/usr/local/bin/x86_64-w64-mingw32-gcc`), since GNU `ld` requires a COFF
        //    object file (`simp_res.o`) rather than a raw `.res` binary.
        if rc_path.is_file() {
            for windres_bin in [
                "x86_64-w64-mingw32-windres",
                "/usr/local/bin/x86_64-w64-mingw32-windres",
                "/opt/homebrew/bin/x86_64-w64-mingw32-windres",
            ] {
                if Command::new(windres_bin)
                    .current_dir(&win_dir)
                    .args(["-i", "simp.rc", "-O", "coff", "-o"])
                    .arg(&out_coff)
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false)
                {
                    linked_artifact = Some(out_coff.clone());
                    break;
                }
            }
        }

        // 2. Fallback to `zig rc` when using `zig cc` as the MinGW linker (e.g. on Linux/WSL)
        if linked_artifact.is_none() && rc_path.is_file() {
            if let Some(home) = std::env::var_os("HOME") {
                for slug in [
                    "zig-linux-x86_64-0.13.0",
                    "zig-linux-aarch64-0.13.0",
                    "zig-macos-aarch64-0.13.0",
                    "zig-macos-x86_64-0.13.0",
                ] {
                    let zig_bin = PathBuf::from(&home)
                        .join(".cache/simp-toolchain")
                        .join(slug)
                        .join("zig");
                    if zig_bin.is_file() {
                        let _ = std::fs::create_dir_all("/tmp/simp-zig-cache");
                        if Command::new(&zig_bin)
                            .current_dir(&win_dir)
                            .env("ZIG_GLOBAL_CACHE_DIR", "/tmp/simp-zig-cache")
                            .env("ZIG_LOCAL_CACHE_DIR", "/tmp/simp-zig-cache")
                            .args(["rc", "--", "simp.rc"])
                            .arg(&out_res)
                            .status()
                            .map(|s| s.success())
                            .unwrap_or(false)
                        {
                            linked_artifact = Some(out_res.clone());
                            break;
                        }
                    }
                }
            }
        }

        if linked_artifact.is_none() && prebuilt_res.is_file() {
            let _ = std::fs::copy(&prebuilt_res, &out_res);
            if out_res.is_file() {
                linked_artifact = Some(out_res);
            }
        }

        if let Some(artifact) = linked_artifact {
            println!("cargo:rustc-link-arg-bins={}", artifact.display());
        }
    }
}
