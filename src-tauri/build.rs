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
        let out_res = out_dir.join("simp.res");

        let mut compiled = false;
        if rc_path.is_file() {
            // Try `zig rc` if available in ~/.cache/simp-toolchain
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
                            compiled = true;
                            break;
                        }
                    }
                }
            }
        }

        if !compiled && prebuilt_res.is_file() {
            let _ = std::fs::copy(&prebuilt_res, &out_res);
            compiled = out_res.is_file();
        }

        if compiled {
            println!("cargo:rustc-link-arg-bins={}", out_res.display());
        }
    }
}
