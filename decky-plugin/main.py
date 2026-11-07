import asyncio
import hashlib
import os
import pwd
import shutil
import socket
import subprocess

SERVICE_UNIT_TEMPLATE = """[Unit]
Description=SIMP (Simple Integrated Media Player) Background Audio & UI Daemon
After=pipewire.service pipewire-pulse.service graphical-session.target
Wants=pipewire.service

[Service]
Type=simple
ExecStart=%h/.local/share/simp/bin/simp --daemon
Environment="SIMP_UI_DIR=%h/.local/share/simp/ui"
Environment="XDG_RUNTIME_DIR=/run/user/%U"
Environment="DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/%U/bus"
Environment="MIMALLOC_PURGE_DELAY=100"
Environment="MIMALLOC_RESERVE_ERRORS=0"
Restart=always
RestartSec=1
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
"""


def _resolve_target_user():
    user = os.environ.get("DECKY_USER") or "deck"
    home = os.environ.get("DECKY_USER_HOME") or f"/home/{user}"
    uid, gid = 1000, 1000
    try:
        pw = pwd.getpwnam(user)
        uid, gid = pw.pw_uid, pw.pw_gid
        home = pw.pw_dir or home
    except Exception:
        pass
    return user, home, uid, gid


def _chown_tree(path: str, uid: int, gid: int):
    if os.geteuid() != 0 or not os.path.exists(path):
        return
    try:
        os.chown(path, uid, gid)
    except Exception:
        pass
    for root, dirs, files in os.walk(path):
        for d in dirs:
            try:
                os.chown(os.path.join(root, d), uid, gid)
            except Exception:
                pass
        for f in files:
            try:
                os.chown(os.path.join(root, f), uid, gid)
            except Exception:
                pass


def _sha256_file(path: str) -> str:
    if not os.path.isfile(path):
        return ""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _is_daemon_listening() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", 18888), timeout=0.35):
            return True
    except Exception:
        return False


def _run_as_user(cmd: list[str], user: str, home: str, uid: int, gid: int):
    env = os.environ.copy()
    env["HOME"] = home
    env["USER"] = user
    env["LOGNAME"] = user
    env["XDG_RUNTIME_DIR"] = f"/run/user/{uid}"
    env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path=/run/user/{uid}/bus"

    if os.geteuid() == 0:
        return subprocess.run(
            ["sudo", "-u", user, "-E", *cmd],
            env=env,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    return subprocess.run(
        cmd,
        env=env,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _parse_version_tuple(raw: str) -> tuple[int, int, int, int, int]:
    cleaned = raw.strip()
    if "simp " in cleaned:
        cleaned = cleaned.split("simp ", 1)[1].strip()
    cleaned = cleaned.lstrip("v")
    if "-" in cleaned:
        core, pre = cleaned.split("-", 1)
    else:
        core, pre = cleaned, ""
    parts = [int(p) if p.isdigit() else 0 for p in core.split(".")]
    while len(parts) < 3:
        parts.append(0)
    if not pre:
        return (parts[0], parts[1], parts[2], 1, 0)
    pre_tail = pre.rsplit(".", 1)[-1]
    pre_num = int(pre_tail) if pre_tail.isdigit() else 0
    return (parts[0], parts[1], parts[2], 0, pre_num)


def _binary_version_tuple(bin_path: str) -> tuple[int, int, int, int, int]:
    if not os.path.isfile(bin_path):
        return (0, 0, 0, 0, 0)
    try:
        res = subprocess.run(
            [bin_path, "--version"],
            check=False,
            capture_output=True,
            text=True,
            timeout=3,
        )
        if res.returncode == 0 and res.stdout:
            return _parse_version_tuple(res.stdout.splitlines()[0])
    except Exception:
        pass
    return (0, 0, 0, 0, 0)


def _sync_staged_decky_plugin(plugin_dir: str, home: str, uid: int, gid: int) -> bool:
    """
    If `simp` self-updater staged a newer Decky plugin bundle into `~/.local/share/simp/decky-staged/`,
    copy its files into `~/homebrew/plugins/simp-decky/` (with root privileges if running under Decky Loader)
    and grant `deck:deck` ownership on both `~/homebrew/plugins` and `~/homebrew/plugins/simp-decky`
    so future updates and restores work seamlessly without sudo.
    """
    plugins_parent = os.path.dirname(plugin_dir)
    if os.path.isdir(plugins_parent):
        try:
            os.chown(plugins_parent, uid, gid)
            os.chmod(plugins_parent, 0o755)
        except Exception:
            pass

    staged_dir = os.path.join(home, ".local", "share", "simp", "decky-staged")
    staged_dist_index = os.path.join(staged_dir, "dist", "index.js")
    if not os.path.isfile(staged_dist_index):
        _chown_tree(plugin_dir, uid, gid)
        return False

    current_dist_index = os.path.join(plugin_dir, "dist", "index.js")
    staged_pkg = os.path.join(staged_dir, "package.json")
    current_pkg = os.path.join(plugin_dir, "package.json")
    staged_main = os.path.join(staged_dir, "main.py")
    current_main = os.path.join(plugin_dir, "main.py")

    needs_sync = (
        _sha256_file(staged_dist_index) != _sha256_file(current_dist_index)
        or _sha256_file(staged_pkg) != _sha256_file(current_pkg)
        or (os.path.isfile(staged_main) and _sha256_file(staged_main) != _sha256_file(current_main))
    )
    if not needs_sync:
        _chown_tree(plugin_dir, uid, gid)
        return False

    try:
        os.makedirs(os.path.join(plugin_dir, "dist"), exist_ok=True)
        for fname in ("plugin.json", "package.json", "main.py"):
            src_f = os.path.join(staged_dir, fname)
            if os.path.isfile(src_f):
                shutil.copy2(src_f, os.path.join(plugin_dir, fname))
        shutil.copytree(
            os.path.join(staged_dir, "dist"),
            os.path.join(plugin_dir, "dist"),
            dirs_exist_ok=True,
        )
        # Remove any stale bundled bin/ or ui/ from an older simp-decky.zip install
        shutil.rmtree(os.path.join(plugin_dir, "bin"), ignore_errors=True)
        shutil.rmtree(os.path.join(plugin_dir, "ui"), ignore_errors=True)
        _chown_tree(plugin_dir, uid, gid)
        return True
    except Exception:
        return False


def _provision_and_start_userland():
    plugin_dir = os.environ.get("DECKY_PLUGIN_DIR") or os.path.dirname(
        os.path.realpath(__file__)
    )
    user, home, uid, gid = _resolve_target_user()

    # 0. Self-heal nested `simp-decky/simp-decky` directory if created by `cp -r SRC DEST` when DEST existed
    nested_dir = os.path.join(plugin_dir, "simp-decky")
    if os.path.isdir(nested_dir):
        try:
            shutil.copytree(nested_dir, plugin_dir, dirs_exist_ok=True)
            shutil.rmtree(nested_dir, ignore_errors=True)
        except Exception:
            pass

    # 1. Sync any staged Decky plugin bundle from `~/.local/share/simp/decky-staged/`
    # and ensure user `deck` owns `~/homebrew/plugins/simp-decky` so userland updates work without sudo.
    _sync_staged_decky_plugin(plugin_dir, home, uid, gid)
    _chown_tree(plugin_dir, uid, gid)

    install_root = os.path.join(home, ".local", "share", "simp")
    bin_dest_dir = os.path.join(install_root, "bin")
    ui_dest_dir = os.path.join(install_root, "ui")
    local_bin_dir = os.path.join(home, ".local", "bin")
    systemd_user_dir = os.path.join(home, ".config", "systemd", "user")

    for d in (bin_dest_dir, ui_dest_dir, local_bin_dir, systemd_user_dir):
        os.makedirs(d, exist_ok=True)

    bundled_bin = os.path.join(plugin_dir, "bin", "simp")
    bundled_ui = os.path.join(plugin_dir, "ui")
    dest_bin = os.path.join(bin_dest_dir, "simp")
    binary_updated = False

    # 2. If `simp-decky.zip` includes the bundled `bin/simp` + `ui/`, install/update them into userland
    # ONLY if `~/.local/share/simp/bin/simp` does not exist or has a strictly older semver than `bundled_bin`.
    bundled_is_newer = False
    if os.path.isfile(bundled_bin):
        if not os.path.isfile(dest_bin):
            bundled_is_newer = True
        else:
            bundled_ver = _binary_version_tuple(bundled_bin)
            dest_ver = _binary_version_tuple(dest_bin)
            if bundled_ver > (0, 0, 0, 0, 0) and dest_ver > (0, 0, 0, 0, 0):
                bundled_is_newer = bundled_ver > dest_ver
            else:
                bundled_is_newer = False

    if os.path.isfile(bundled_bin) and bundled_is_newer:
        if _sha256_file(bundled_bin) != _sha256_file(dest_bin):
            binary_updated = True
            _run_as_user(
                ["systemctl", "--user", "stop", "simp.service"],
                user,
                home,
                uid,
                gid,
            )
            subprocess.run(
                ["pkill", "-f", "simp --daemon"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            subprocess.run(
                ["pkill", "-f", "simp-widevine-worker"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            subprocess.run(
                ["pkill", "-f", "18888/?worker=apple"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            tmp_dest = dest_bin + ".new"
            shutil.copy2(bundled_bin, tmp_dest)
            os.chmod(tmp_dest, 0o755)
            os.replace(tmp_dest, dest_bin)

        if os.path.isfile(os.path.join(bundled_ui, "index.html")):
            shutil.copytree(bundled_ui, ui_dest_dir, dirs_exist_ok=True)
            binary_updated = True

    # Once userland has a valid `dest_bin`, clean up any `plugin_dir/bin` and `plugin_dir/ui` from `simp-decky.zip`
    # so an older bundled binary can never overwrite a future self-update.
    if os.path.isfile(dest_bin) and os.path.isdir(os.path.join(plugin_dir, "bin")):
        shutil.rmtree(os.path.join(plugin_dir, "bin"), ignore_errors=True)
        shutil.rmtree(os.path.join(plugin_dir, "ui"), ignore_errors=True)

    if os.path.isfile(dest_bin):
        symlink_path = os.path.join(local_bin_dir, "simp")
        try:
            if os.path.lexists(symlink_path):
                os.remove(symlink_path)
            os.symlink(dest_bin, symlink_path)
        except Exception:
            pass

    # 3. Ensure `~/.config/systemd/user/simp.service` is present and up to date
    unit_path = os.path.join(systemd_user_dir, "simp.service")
    with open(unit_path, "w", encoding="utf-8") as f:
        f.write(SERVICE_UNIT_TEMPLATE)

    _chown_tree(install_root, uid, gid)
    _chown_tree(os.path.join(home, ".config", "systemd"), uid, gid)

    # 4. Start or restart `simp.service` under target user's systemd session
    _run_as_user(["systemctl", "--user", "daemon-reload"], user, home, uid, gid)
    _run_as_user(["systemctl", "--user", "enable", "simp.service"], user, home, uid, gid)
    if binary_updated or not _is_daemon_listening():
        _run_as_user(
            ["systemctl", "--user", "restart", "simp.service"],
            user,
            home,
            uid,
            gid,
        )
    else:
        _run_as_user(
            ["systemctl", "--user", "start", "simp.service"],
            user,
            home,
            uid,
            gid,
        )

    # 5. Fallback direct spawn if user systemd bus wasn't reachable yet
    if not _is_daemon_listening() and os.path.isfile(dest_bin):
        env = os.environ.copy()
        env["HOME"] = home
        env["USER"] = user
        env["XDG_RUNTIME_DIR"] = f"/run/user/{uid}"
        env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path=/run/user/{uid}/bus"
        env["SIMP_UI_DIR"] = ui_dest_dir
        if os.geteuid() == 0:
            subprocess.Popen(
                ["sudo", "-u", user, "-E", dest_bin, "--daemon"],
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        else:
            subprocess.Popen(
                [dest_bin, "--daemon"],
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )


class Plugin:
    """
    All-in-One Decky Loader lifecycle supervisor for SIMP (org.simp.player).
    Automatically provisions/updates `~/.local/share/simp/` from the Decky plugin bundle
    and supervises `simp.service` across Gaming Mode boots and plugin reloads.
    """

    _watch_task = None

    async def _watch_staged_updates_loop(self):
        loop = asyncio.get_running_loop()
        while True:
            await asyncio.sleep(5.0)
            try:
                def _check_sync():
                    plugin_dir = os.environ.get("DECKY_PLUGIN_DIR") or os.path.dirname(
                        os.path.realpath(__file__)
                    )
                    _user, home, uid, gid = _resolve_target_user()
                    install_root = os.path.join(home, ".local", "share", "simp")
                    if os.path.isdir(install_root):
                        _chown_tree(install_root, uid, gid)
                    _sync_staged_decky_plugin(plugin_dir, home, uid, gid)

                await loop.run_in_executor(None, _check_sync)
            except asyncio.CancelledError:
                break
            except Exception:
                pass

    async def _main(self):
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _provision_and_start_userland)
        if self._watch_task is None or self._watch_task.done():
            self._watch_task = asyncio.create_task(self._watch_staged_updates_loop())

    async def restart_daemon(self) -> bool:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _provision_and_start_userland)
        return _is_daemon_listening()

    async def sync_decky_plugin(self) -> dict:
        def _do_sync():
            plugin_dir = os.environ.get("DECKY_PLUGIN_DIR") or os.path.dirname(
                os.path.realpath(__file__)
            )
            _user, home, uid, gid = _resolve_target_user()
            synced = _sync_staged_decky_plugin(plugin_dir, home, uid, gid)
            return {"ok": True, "synced": synced}

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _do_sync)

    async def _unload(self):
        if self._watch_task and not self._watch_task.done():
            self._watch_task.cancel()
        # Audio daemon intentionally stays alive in userland across QAM reloads
        pass
