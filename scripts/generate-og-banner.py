#!/usr/bin/env python3
"""
Generate the 1280x640 GitHub Open Graph social preview banner for SIMP.
Uses librsvg + libcairo via ctypes to render crisp anti-aliased vector graphics
combined with `ui/public/simp-icon-dark.png`.
"""

import base64
import ctypes
import ctypes.util
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICON_PATH = ROOT / "ui" / "public" / "simp-icon-dark.png"
OUT_SVG = ROOT / "docs" / "open-graph-banner.svg"
OUT_PNG = ROOT / "docs" / "open-graph-banner.png"


def render_svg_to_png(svg_bytes: bytes, out_path: Path, width: int = 1280, height: int = 640) -> None:
    cairo = ctypes.CDLL(ctypes.util.find_library("cairo"))
    rsvg = ctypes.CDLL(ctypes.util.find_library("rsvg-2"))

    # Cairo signatures
    cairo.cairo_image_surface_create.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int]
    cairo.cairo_image_surface_create.restype = ctypes.c_void_p
    cairo.cairo_create.argtypes = [ctypes.c_void_p]
    cairo.cairo_create.restype = ctypes.c_void_p
    cairo.cairo_surface_write_to_png.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    cairo.cairo_surface_write_to_png.restype = ctypes.c_int
    cairo.cairo_destroy.argtypes = [ctypes.c_void_p]
    cairo.cairo_surface_destroy.argtypes = [ctypes.c_void_p]

    # Rsvg signatures
    rsvg.rsvg_handle_new_from_data.argtypes = [
        ctypes.c_char_p,
        ctypes.c_size_t,
        ctypes.POINTER(ctypes.c_void_p),
    ]
    rsvg.rsvg_handle_new_from_data.restype = ctypes.c_void_p
    rsvg.rsvg_handle_render_cairo.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    rsvg.rsvg_handle_render_cairo.restype = ctypes.c_int

    err = ctypes.c_void_p(None)
    handle = rsvg.rsvg_handle_new_from_data(svg_bytes, len(svg_bytes), ctypes.byref(err))
    if not handle:
        raise RuntimeError("rsvg_handle_new_from_data failed to parse SVG")

    # CAIRO_FORMAT_ARGB32 = 0
    surface = cairo.cairo_image_surface_create(0, width, height)
    cr = cairo.cairo_create(surface)
    ok = rsvg.rsvg_handle_render_cairo(handle, cr)
    if not ok:
        raise RuntimeError("rsvg_handle_render_cairo failed")

    status = cairo.cairo_surface_write_to_png(surface, str(out_path).encode("utf-8"))
    cairo.cairo_destroy(cr)
    cairo.cairo_surface_destroy(surface)
    if status != 0:
        raise RuntimeError(f"cairo_surface_write_to_png failed with status {status}")


def build_waveform_svg(x0: float, y_center: float, width: float, num_bars: int = 60, progress: float = 0.62) -> str:
    bars = []
    step = width / num_bars
    bar_w = max(4.0, step * 0.56)
    for i in range(num_bars):
        t = i / max(1, num_bars - 1)
        env = (
            0.35
            + 0.35 * abs(math.sin(i * 0.43 + 0.5))
            + 0.20 * abs(math.cos(i * 0.91 - 0.3))
            + 0.10 * math.sin(i * 1.7)
        )
        edge = min(1.0, min(t * 8.0, (1.0 - t) * 8.0) + 0.25)
        amp = max(0.16, min(0.98, env * edge))
        top_h = round(amp * 22.0, 1)
        bot_h = round(amp * 11.0, 1)
        bx = round(x0 + i * step, 1)

        if t <= progress:
            top_fill = "url(#wavePlayedGrad)"
            bot_fill = "rgba(56, 189, 248, 0.32)"
        else:
            top_fill = "#232634"
            bot_fill = "#161822"

        bars.append(
            f'<rect x="{bx}" y="{round(y_center - top_h - 1, 1)}" width="{bar_w:.1f}" height="{top_h}" rx="2" fill="{top_fill}"/>'
        )
        bars.append(
            f'<rect x="{bx}" y="{round(y_center + 2, 1)}" width="{bar_w:.1f}" height="{bot_h}" rx="2" fill="{bot_fill}"/>'
        )
    return "\n      ".join(bars)


def generate_svg(include_template_guides: bool = False) -> str:
    icon_b64 = base64.b64encode(ICON_PATH.read_bytes()).decode("ascii")
    waveform_bars = build_waveform_svg(x0=448, y_center=382, width=704, num_bars=60, progress=0.62)
    playhead_x = round(448 + 704 * 0.62, 1)

    template_overlay = ""
    if include_template_guides:
        # 40pt at 96dpi is ~53.3px; show 40pt red guide lines matching GitHub's template
        template_overlay = """
  <!-- GitHub 40pt (53.3px) safe zone verification overlay -->
  <g opacity="0.85">
    <rect x="0" y="0" width="1280" height="53.3" fill="rgba(255, 60, 80, 0.14)"/>
    <rect x="0" y="586.7" width="1280" height="53.3" fill="rgba(255, 60, 80, 0.14)"/>
    <rect x="0" y="53.3" width="53.3" height="533.4" fill="rgba(255, 60, 80, 0.14)"/>
    <rect x="1226.7" y="53.3" width="53.3" height="533.4" fill="rgba(255, 60, 80, 0.14)"/>
    <line x1="0" y1="53.3" x2="1280" y2="53.3" stroke="#e11d48" stroke-width="2.5"/>
    <line x1="0" y1="586.7" x2="1280" y2="586.7" stroke="#e11d48" stroke-width="2.5"/>
    <line x1="53.3" y1="0" x2="53.3" y2="640" stroke="#e11d48" stroke-width="2.5"/>
    <line x1="1226.7" y1="0" x2="1226.7" y2="640" stroke="#e11d48" stroke-width="2.5"/>
  </g>
"""

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="1280" height="640" viewBox="0 0 1280 640">
  <defs>
    <!-- Pure OLED Black base + ambient neon glows matching simp-icon-dark.png -->
    <radialGradient id="orangeGlow" cx="18%" cy="54%" r="46%">
      <stop offset="0%" stop-color="#ff6a00" stop-opacity="0.24"/>
      <stop offset="55%" stop-color="#a83279" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="cyanGlow" cx="76%" cy="48%" r="48%">
      <stop offset="0%" stop-color="#2aa3c4" stop-opacity="0.20"/>
      <stop offset="55%" stop-color="#0ea5e9" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <linearGradient id="cardSurface" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090910"/>
      <stop offset="55%" stop-color="#050508"/>
      <stop offset="100%" stop-color="#080b12"/>
    </linearGradient>

    <linearGradient id="cardBorderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fb923c" stop-opacity="0.55"/>
      <stop offset="35%" stop-color="#262938" stop-opacity="0.9"/>
      <stop offset="70%" stop-color="#1e293b" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.65"/>
    </linearGradient>

    <linearGradient id="artFrameGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ff7b00"/>
      <stop offset="50%" stop-color="#a855f7"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>

    <linearGradient id="wavePlayedGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#fb923c"/>
      <stop offset="45%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#67e8f9"/>
    </linearGradient>

    <linearGradient id="progressFill" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#f97316"/>
      <stop offset="40%" stop-color="#0284c7"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>

    <linearGradient id="activeBtnGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#132c38"/>
      <stop offset="100%" stop-color="#0b1a22"/>
    </linearGradient>

    <clipPath id="albumArtClip">
      <rect x="104" y="148" width="292" height="292" rx="26"/>
    </clipPath>
  </defs>

  <!-- 1. Pure OLED Black Background + Subtle Ambient Aura -->
  <rect width="1280" height="640" fill="#000000"/>
  <rect width="1280" height="640" fill="url(#orangeGlow)"/>
  <rect width="1280" height="640" fill="url(#cyanGlow)"/>

  <!-- Subtle Console Grid Lines in Outer Margin -->
  <g stroke="#12141d" stroke-width="1" opacity="0.55">
    <line x1="0" y1="120" x2="1280" y2="120"/>
    <line x1="0" y1="520" x2="1280" y2="520"/>
    <line x1="160" y1="0" x2="160" y2="640"/>
    <line x1="1120" y1="0" x2="1120" y2="640"/>
  </g>

  <!-- 2. Main Console Shell (Strictly inside 64px safe margin: x=64..1216, y=56..584) -->
  <!-- Outer soft glow -->
  <rect x="61" y="53" width="1158" height="534" rx="30"
        fill="none" stroke="#2aa3c4" stroke-opacity="0.14" stroke-width="6"/>
  <!-- Console Card Body -->
  <rect x="64" y="56" width="1152" height="528" rx="28"
        fill="url(#cardSurface)" stroke="url(#cardBorderGrad)" stroke-width="2"/>

  <!-- Top Console Navigation Bar (y=74..122) -->
  <rect x="65" y="57" width="1150" height="68" rx="27" fill="#07070c" opacity="0.9"/>
  <line x1="65" y1="125" x2="1215" y2="125" stroke="#181b26" stroke-width="1.5"/>

  <!-- Top-Left: Source Selector Pill + [SELECT] Controller Badge -->
  <g transform="translate(92, 72)">
    <rect x="0" y="0" width="328" height="38" rx="12" fill="#0d0e15" stroke="#222533" stroke-width="1.5"/>
    <!-- Pulsing status dot -->
    <circle cx="20" cy="19" r="5.5" fill="#22c55e"/>
    <circle cx="20" cy="19" r="9" fill="none" stroke="#22c55e" stroke-opacity="0.35" stroke-width="2"/>
    <text x="36" y="24" font-family="Ubuntu Sans, DejaVu Sans, sans-serif" font-size="13.5" font-weight="700" fill="#e4e4ec">
      Source: <tspan fill="#7dd3fc">UNIFIED QUEUE</tspan>
    </text>
    <!-- [SELECT] Gamepad Pill -->
    <rect x="242" y="7" width="74" height="24" rx="12" fill="#171925" stroke="#2e3346" stroke-width="1.2"/>
    <text x="279" y="23" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="11.5" font-weight="700" fill="#94a3b8">
      SELECT
    </text>
  </g>

  <!-- Top-Center: L1 | Player (Active) | Library & Queue | R1 -->
  <g transform="translate(466, 70)">
    <!-- L1 Bumper Badge -->
    <rect x="0" y="7" width="44" height="28" rx="8" fill="#161925" stroke="#334155" stroke-width="1.5"/>
    <text x="22" y="25" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="13" font-weight="700" fill="#cbd5e1">
      L1
    </text>

    <!-- Switcher Container -->
    <rect x="54" y="0" width="276" height="42" rx="14" fill="#0b0c12" stroke="#1e2230" stroke-width="1.5"/>
    <!-- Active Player Tab -->
    <rect x="59" y="4" width="118" height="34" rx="10" fill="#102630" stroke="#2aa3c4" stroke-width="1.8"/>
    <!-- Musical note icon -->
    <path d="M83 25 V15 L93 13 V23" fill="none" stroke="#67e8f9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="80.5" cy="25.5" r="2.5" fill="#67e8f9"/>
    <circle cx="90.5" cy="23.5" r="2.5" fill="#67e8f9"/>
    <text x="103" y="26" font-family="Ubuntu Sans, DejaVu Sans, sans-serif" font-size="14" font-weight="700" fill="#e0f2fe">
      Player
    </text>

    <!-- Inactive Library & Queue Tab -->
    <text x="252" y="26" text-anchor="middle" font-family="Ubuntu Sans, DejaVu Sans, sans-serif" font-size="13.5" font-weight="700" fill="#8e8e99">
      Library &amp; Queue
    </text>

    <!-- R1 Bumper Badge -->
    <rect x="340" y="7" width="44" height="28" rx="8" fill="#161925" stroke="#334155" stroke-width="1.5"/>
    <text x="362" y="25" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="13" font-weight="700" fill="#cbd5e1">
      R1
    </text>
  </g>

  <!-- Top-Right: Native Rust / OLED / Start Badges -->
  <g transform="translate(894, 72)">
    <!-- Native Rust Daemon Pill -->
    <rect x="0" y="0" width="152" height="38" rx="12" fill="#0d0e15" stroke="#222533" stroke-width="1.5"/>
    <circle cx="20" cy="19" r="5" fill="#fb923c"/>
    <text x="33" y="24" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="12.5" font-weight="700" fill="#fdba74">
      RUST &lt;1% CPU
    </text>

    <!-- Power / Start Button -->
    <rect x="162" y="0" width="132" height="38" rx="12" fill="#0d0e15" stroke="#222533" stroke-width="1.5"/>
    <!-- Vector Power glyph -->
    <path d="M184 12 V19 M179.5 14.5 A6.5 6.5 0 1 0 188.5 14.5" fill="none" stroke="#7dd3fc" stroke-width="2" stroke-linecap="round"/>
    <rect x="202" y="7" width="80" height="24" rx="12" fill="#171925" stroke="#2e3346" stroke-width="1.2"/>
    <text x="242" y="23" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="11.5" font-weight="700" fill="#cbd5e1">
      START
    </text>
  </g>

  <!-- ======================================================================= -->
  <!-- LEFT COLUMN: SIMP Neon Artwork + Controller Mode Row (X / Y / Comments) -->
  <!-- ======================================================================= -->

  <!-- Outer neon rim behind Album Art -->
  <rect x="101" y="145" width="298" height="298" rx="28" fill="none" stroke="url(#artFrameGrad)" stroke-width="2.5" opacity="0.85"/>
  <rect x="104" y="148" width="292" height="292" rx="26" fill="#050508"/>

  <!-- Embedded SIMP Artwork (ui/public/simp-icon-dark.png) -->
  <g clip-path="url(#albumArtClip)">
    <image x="104" y="148" width="292" height="292" preserveAspectRatio="xMidYMid slice"
           xlink:href="data:image/png;base64,{icon_b64}"/>
  </g>

  <!-- Subtle inner border on Album Art -->
  <rect x="104" y="148" width="292" height="292" rx="26" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1.5"/>

  <!-- Top-Left Optical Disc / Radio Corner Badge on Album Art -->
  <g transform="translate(104, 148)">
    <rect x="0" y="0" width="48" height="48" rx="14" fill="#0a0a10" fill-opacity="0.88" stroke="#ffffff" stroke-opacity="0.25" stroke-width="1.2"/>
    <circle cx="24" cy="24" r="12" fill="none" stroke="#7dd3fc" stroke-width="2"/>
    <circle cx="24" cy="24" r="3.5" fill="#7dd3fc"/>
  </g>

  <!-- Top-Right Orange Heart Badge on Album Art -->
  <g transform="translate(348, 148)">
    <rect x="0" y="0" width="48" height="48" rx="14" fill="#0a0a10" fill-opacity="0.88" stroke="#fb923c" stroke-opacity="0.45" stroke-width="1.2"/>
    <path d="M24 33 C24 33 13 25.5 13 18.5 C13 15 15.8 12.5 19 12.5 C21.2 12.5 23 13.8 24 15.5 C25 13.8 26.8 12.5 29 12.5 C32.2 12.5 35 15 35 18.5 C35 25.5 24 33 24 33 Z"
          fill="#fb923c"/>
  </g>

  <!-- Queue Mode Controller Buttons Below Artwork: [Shuffle X] [Repeat Y•Q] [Bubbles ON•12] -->
  <g transform="translate(104, 456)">
    <!-- Shuffle (X) -->
    <g transform="translate(0, 0)">
      <rect x="0" y="0" width="90" height="86" rx="18" fill="#0d1b22" stroke="#2aa3c4" stroke-width="2"/>
      <!-- Shuffle arrows icon -->
      <path d="M28 24 H36 L54 42 H62 M62 24 H54 L36 42 H28" fill="none" stroke="#bfeaf5" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="58,20 63,24 58,28" fill="none" stroke="#bfeaf5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="58,38 63,42 58,46" fill="none" stroke="#bfeaf5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <!-- X Badge -->
      <rect x="21" y="54" width="48" height="22" rx="11" fill="#141824" stroke="#2e364f" stroke-width="1.2"/>
      <text x="45" y="69" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="12.5" font-weight="700" fill="#7dd3fc">
        X
      </text>
    </g>

    <!-- Repeat (Y•Q) -->
    <g transform="translate(101, 0)">
      <rect x="0" y="0" width="90" height="86" rx="18" fill="#0d1b22" stroke="#2aa3c4" stroke-width="2"/>
      <!-- Repeat loop icon -->
      <path d="M29 29 V24 H59 M61 35 V40 H31" fill="none" stroke="#bfeaf5" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="55,20 60,24 55,28" fill="none" stroke="#bfeaf5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="35,36 30,40 35,44" fill="none" stroke="#bfeaf5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <!-- Y•Q Badge -->
      <rect x="17" y="54" width="56" height="22" rx="11" fill="#141824" stroke="#2e364f" stroke-width="1.2"/>
      <text x="45" y="69" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="12" font-weight="700" fill="#7dd3fc">
        Y•Q
      </text>
    </g>

    <!-- Timed Comment Bubbles (ON•12) -->
    <g transform="translate(202, 0)">
      <rect x="0" y="0" width="90" height="86" rx="18" fill="#18110c" stroke="#ea580c" stroke-width="2"/>
      <!-- Speech bubble icon -->
      <path d="M30 22 H60 A4 4 0 0 1 64 26 V37 A4 4 0 0 1 60 41 H42 L34 46 V41 H30 A4 4 0 0 1 26 37 V26 A4 4 0 0 1 30 22 Z"
            fill="none" stroke="#fdba74" stroke-width="2.2" stroke-linejoin="round"/>
      <circle cx="39" cy="31.5" r="1.8" fill="#fdba74"/>
      <circle cx="45" cy="31.5" r="1.8" fill="#fdba74"/>
      <circle cx="51" cy="31.5" r="1.8" fill="#fdba74"/>
      <!-- ON•12 Badge (Matches PlayerView.tsx line 371) -->
      <rect x="14" y="54" width="62" height="22" rx="11" fill="#27150c" stroke="#7c2d12" stroke-width="1.2"/>
      <text x="45" y="69" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="11.5" font-weight="700" fill="#fb923c">
        ON•12
      </text>
    </g>
  </g>

  <!-- ======================================================================= -->
  <!-- RIGHT COLUMN: Title, Platform Badges, Waveform + Comment, Transport Row -->
  <!-- ======================================================================= -->

  <!-- Platform Target Pills Row -->
  <g transform="translate(436, 148)">
    <rect x="0" y="0" width="166" height="28" rx="8" fill="#101c24" stroke="#2aa3c4" stroke-width="1.2"/>
    <text x="83" y="19" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="12" font-weight="700" fill="#7dd3fc">
      STEAMOS • DECK
    </text>

    <rect x="176" y="0" width="164" height="28" rx="8" fill="#11131c" stroke="#2e3446" stroke-width="1.2"/>
    <text x="258" y="19" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="12" font-weight="700" fill="#cbd5e1">
      BAZZITE • LINUX
    </text>

    <rect x="350" y="0" width="174" height="28" rx="8" fill="#11131c" stroke="#2e3446" stroke-width="1.2"/>
    <text x="437" y="19" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="12" font-weight="700" fill="#cbd5e1">
      STEAMVR OVERLAY
    </text>

    <rect x="534" y="0" width="212" height="28" rx="8" fill="#1c120c" stroke="#9a3412" stroke-width="1.2"/>
    <text x="640" y="19" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="12" font-weight="700" fill="#fdba74">
      MPRIS2 • OLED READY
    </text>
  </g>

  <!-- Hero Track Title: SIMP — Simple Integrated Media Player -->
  <g transform="translate(436, 232)">
    <text x="0" y="0" font-family="Ubuntu Sans, DejaVu Sans, sans-serif" font-size="54" font-weight="800" letter-spacing="-1" fill="#f8fafc">
      SIMP
    </text>
    <!-- Accent vertical bar -->
    <rect x="148" y="-40" width="4" height="44" rx="2" fill="#2aa3c4"/>
    <text x="168" y="-19" font-family="Ubuntu Sans, DejaVu Sans, sans-serif" font-size="27" font-weight="700" fill="#e2e8f0">
      Simple Integrated Media Player
    </text>
    <text x="168" y="6" font-family="Ubuntu Sans, DejaVu Sans, sans-serif" font-size="16" font-weight="500" fill="#94a3b8">
      Controller-first console UI &amp; native Rust audio daemon — no browser bloat
    </text>
  </g>

  <!-- Unified Audio Sources Subtitle Strip -->
  <g transform="translate(436, 266)">
    <text x="0" y="0" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="13.5" font-weight="700" fill="#7dd3fc">
      FLAC / MP3 / OPUS
      <tspan fill="#475569"> • </tspan>
      <tspan fill="#cbd5e1">Steam Soundtracks</tspan>
      <tspan fill="#475569"> • </tspan>
      <tspan fill="#f472b6">Apple Music</tspan>
      <tspan fill="#475569"> • </tspan>
      <tspan fill="#fb923c">SoundCloud</tspan>
      <tspan fill="#475569"> • </tspan>
      <tspan fill="#a78bfa">CD / DVD</tspan>
    </text>
  </g>

  <!-- Ephemeral Timed Comment Bubble (SoundCloud feature signature) -->
  <g transform="translate(540, 286)">
    <rect x="0" y="0" width="560" height="50" rx="14" fill="#100e18" stroke="#ea580c" stroke-opacity="0.7" stroke-width="1.5"/>
    <!-- Speech pointer triangle pointing down toward playhead -->
    <polygon points="336,50 348,50 340,59" fill="#100e18" stroke="#ea580c" stroke-width="1.5"/>
    <circle cx="26" cy="25" r="14" fill="#27150c" stroke="#ea580c" stroke-width="1.5"/>
    <!-- Vector eighth note inside avatar circle -->
    <path d="M24 30 V19 L31 17.5 V28" fill="none" stroke="#fb923c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="22.2" cy="30" r="2.2" fill="#fb923c"/>
    <circle cx="29.2" cy="28" r="2.2" fill="#fb923c"/>
    <text x="50" y="20" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="11.5" font-weight="700" fill="#fdba74">
      @deck_audiophile
    </text>
    <rect x="172" y="7" width="46" height="17" rx="5" fill="#27150c" stroke="#7c2d12" stroke-width="1"/>
    <text x="195" y="19" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="10.5" font-weight="700" fill="#fb923c">
      02:14
    </text>
    <text x="50" y="39" font-family="Ubuntu Sans, DejaVu Sans, sans-serif" font-size="13.5" font-weight="500" fill="#f1f5f9">
      “One queue for local files, Steam OSTs, Apple Music, SoundCloud &amp; CDs!”
    </text>
  </g>

  <!-- Waveform + Scrub Bar Container (x=436..1182, y=346..426) -->
  <g>
    <rect x="436" y="346" width="746" height="80" rx="18" fill="#090a10" stroke="#1c202e" stroke-width="1.5"/>

    <!-- Waveform Bars -->
    <g>
      {waveform_bars}
    </g>

    <!-- Progress Scrub Rail -->
    <rect x="448" y="397" width="704" height="7" rx="3.5" fill="#1a1d28"/>
    <rect x="448" y="397" width="436.5" height="7" rx="3.5" fill="url(#progressFill)"/>

    <!-- Timed Comment Marker Ticks on Scrub Rail -->
    <rect x="560" y="396" width="3" height="9" rx="1" fill="#fb923c"/>
    <rect x="712" y="396" width="3" height="9" rx="1" fill="#fb923c"/>
    <rect x="883" y="396" width="3" height="9" rx="1" fill="#fb923c"/>
    <rect x="1020" y="396" width="3" height="9" rx="1" fill="#fb923c"/>

    <!-- Glowing Playhead Knob -->
    <line x1="{playhead_x}" y1="354" x2="{playhead_x}" y2="408" stroke="#67e8f9" stroke-width="2" stroke-opacity="0.85"/>
    <circle cx="{playhead_x}" cy="400.5" r="8" fill="#e0f2fe" stroke="#0284c7" stroke-width="3"/>

    <!-- Elapsed & Duration Timestamps -->
    <text x="448" y="420" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="11.5" font-weight="700" fill="#7dd3fc">
      02:14
    </text>
    <text x="800" y="420" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="11" font-weight="700" fill="#64748b">
      PIPEWIRE • SYMPHONIA • 160K AAC / FLAC
    </text>
    <text x="1152" y="420" text-anchor="end" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="11.5" font-weight="700" fill="#94a3b8">
      03:36
    </text>
  </g>

  <!-- Symmetrical Controller Transport Row (y=444..542) -->
  <g transform="translate(436, 444)">
    <!-- [L2] Rewind -->
    <g transform="translate(0, 5)">
      <rect x="0" y="0" width="84" height="88" rx="18" fill="#0b0c12" stroke="#222634" stroke-width="2"/>
      <!-- Double left triangles -->
      <polygon points="41,22 27,32 41,42" fill="#d4d4dc"/>
      <polygon points="55,22 41,32 55,42" fill="#d4d4dc"/>
      <rect x="18" y="55" width="48" height="22" rx="11" fill="#151824" stroke="#2d3348" stroke-width="1.2"/>
      <text x="42" y="70" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="12.5" font-weight="700" fill="#94a3b8">
        L2
      </text>
    </g>

    <!-- [D-Pad Left] Previous -->
    <g transform="translate(98, 5)">
      <rect x="0" y="0" width="84" height="88" rx="18" fill="#0b0c12" stroke="#222634" stroke-width="2"/>
      <rect x="28" y="22" width="4" height="20" rx="1.5" fill="#d4d4dc"/>
      <polygon points="52,22 35,32 52,42" fill="#d4d4dc"/>
      <rect x="14" y="55" width="56" height="22" rx="11" fill="#151824" stroke="#2d3348" stroke-width="1.2"/>
      <!-- Crisp vector left arrow + D-PAD badge -->
      <polygon points="22,66 28,62 28,70" fill="#94a3b8"/>
      <text x="46" y="70" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="11" font-weight="700" fill="#94a3b8">
        DPAD
      </text>
    </g>

    <!-- [A] Play / Pause Center Hero Button -->
    <g transform="translate(196, 0)">
      <rect x="0" y="0" width="132" height="98" rx="24" fill="url(#activeBtnGrad)" stroke="#2aa3c4" stroke-width="2.5"/>
      <!-- Play + Pause combo icon -->
      <polygon points="48,20 48,46 70,33" fill="#e0f2fe"/>
      <rect x="76" y="21" width="5" height="24" rx="2" fill="#67e8f9"/>
      <rect x="85" y="21" width="5" height="24" rx="2" fill="#67e8f9"/>
      <!-- A • PLAY pill -->
      <rect x="16" y="60" width="100" height="25" rx="12.5" fill="#163542" stroke="#38bdf8" stroke-width="1.2"/>
      <text x="66" y="77" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="12.5" font-weight="700" fill="#bae6fd">
        A • PLAY
      </text>
    </g>

    <!-- [D-Pad Right] Next -->
    <g transform="translate(342, 5)">
      <rect x="0" y="0" width="84" height="88" rx="18" fill="#0b0c12" stroke="#222634" stroke-width="2"/>
      <polygon points="32,22 49,32 32,42" fill="#d4d4dc"/>
      <rect x="52" y="22" width="4" height="20" rx="1.5" fill="#d4d4dc"/>
      <rect x="14" y="55" width="56" height="22" rx="11" fill="#151824" stroke="#2d3348" stroke-width="1.2"/>
      <text x="38" y="70" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="11" font-weight="700" fill="#94a3b8">
        DPAD
      </text>
      <polygon points="62,66 56,62 56,70" fill="#94a3b8"/>
    </g>

    <!-- [R2] Fast-Forward -->
    <g transform="translate(440, 5)">
      <rect x="0" y="0" width="84" height="88" rx="18" fill="#0b0c12" stroke="#222634" stroke-width="2"/>
      <polygon points="29,22 43,32 29,42" fill="#d4d4dc"/>
      <polygon points="43,22 57,32 43,42" fill="#d4d4dc"/>
      <rect x="18" y="55" width="48" height="22" rx="11" fill="#151824" stroke="#2d3348" stroke-width="1.2"/>
      <text x="42" y="70" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="12.5" font-weight="700" fill="#94a3b8">
        R2
      </text>
    </g>

    <!-- Right-side Repo & Controller ABXY Card -->
    <g transform="translate(538, 5)">
      <rect x="0" y="0" width="208" height="88" rx="18" fill="#090b12" stroke="#1e293b" stroke-width="1.8"/>
      <text x="16" y="25" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="11" font-weight="700" fill="#2aa3c4">
        OPEN SOURCE • GPL-3.0
      </text>
      <text x="16" y="47" font-family="Ubuntu Sans, DejaVu Sans, sans-serif" font-size="17.5" font-weight="800" fill="#f8fafc">
        niiiitz / simp
      </text>
      <!-- Colored Controller Face Button Badges (A / B / X / Y) -->
      <g transform="translate(16, 56)">
        <rect x="0" y="0" width="40" height="22" rx="11" fill="#0f291e" stroke="#22c55e" stroke-width="1.2"/>
        <text x="20" y="15" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="11.5" font-weight="700" fill="#86efac">
          A
        </text>
        <rect x="45" y="0" width="40" height="22" rx="11" fill="#2c1216" stroke="#ef4444" stroke-width="1.2"/>
        <text x="65" y="15" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="11.5" font-weight="700" fill="#fca5a5">
          B
        </text>
        <rect x="90" y="0" width="40" height="22" rx="11" fill="#102238" stroke="#38bdf8" stroke-width="1.2"/>
        <text x="110" y="15" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="11.5" font-weight="700" fill="#7dd3fc">
          X
        </text>
        <rect x="135" y="0" width="40" height="22" rx="11" fill="#2b2110" stroke="#f59e0b" stroke-width="1.2"/>
        <text x="155" y="15" text-anchor="middle" font-family="Ubuntu Sans Mono, DejaVu Sans Mono, monospace" font-size="11.5" font-weight="700" fill="#fcd34d">
          Y
        </text>
      </g>
    </g>
  </g>
{template_overlay}
</svg>
"""


def main() -> None:
    OUT_SVG.parent.mkdir(parents=True, exist_ok=True)
    svg_clean = generate_svg(include_template_guides=False)
    OUT_SVG.write_text(svg_clean, encoding="utf-8")
    render_svg_to_png(svg_clean.encode("utf-8"), OUT_PNG)
    print(f"Wrote {OUT_SVG} and {OUT_PNG}")


if __name__ == "__main__":
    main()
