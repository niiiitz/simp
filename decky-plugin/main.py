import asyncio
import subprocess


class Plugin:
    """
    Minimal Decky Loader lifecycle shim for SIMP (org.simp.player).
    All audio decoding, library queries, and real-time state sync bypass Python
    entirely and flow over the local Rust daemon WebSocket (ws://127.0.0.1:18888/ws).
    """

    async def _main(self):
        # Ensure the userland systemd daemon is active when Decky loads the plugin
        try:
            subprocess.run(
                ["systemctl", "--user", "start", "simp.service"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            pass

    async def _unload(self):
        # Audio daemon intentionally stays alive across QAM reloads
        pass

