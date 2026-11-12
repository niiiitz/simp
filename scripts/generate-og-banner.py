#!/usr/bin/env python3
"""
Generate the 1280x640 GitHub Open Graph social preview & README hero banner for IMP (SIMP).
Uses librsvg + libcairo via ctypes to render crisp anti-aliased vector graphics
matching the live PlayerView UI design language (`Demoscene 64K` backdrop, top pill bar,
tight chest-up crop of the IMP mascot in the left artwork square, amber waveform capsule
with circular playhead knob, and 7-button transport row).
"""

import base64
import ctypes
import ctypes.util
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMP_CROP_SOURCE = (
    ROOT
    / "reference_documentation"
    / "artwork_archive"
    / "imp_layers"
    / "refined_pose_b_chin_up_chest_out.jpg"
)
ICON_PATH = (
    IMP_CROP_SOURCE
    if IMP_CROP_SOURCE.exists()
    else (ROOT / "ui" / "public" / "simp-icon-dark.png")
)
OUT_SVG = ROOT / "docs" / "open-graph-banner.svg"
OUT_PNG = ROOT / "docs" / "open-graph-banner.png"


def render_svg_to_png(svg_bytes: bytes, out_path: Path, width: int = 1280, height: int = 640) -> None:
    cairo = ctypes.CDLL(ctypes.util.find_library("cairo"))
    rsvg = ctypes.CDLL(ctypes.util.find_library("rsvg-2"))

    cairo.cairo_image_surface_create.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int]
    cairo.cairo_image_surface_create.restype = ctypes.c_void_p
    cairo.cairo_create.argtypes = [ctypes.c_void_p]
    cairo.cairo_create.restype = ctypes.c_void_p
    cairo.cairo_surface_write_to_png.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    cairo.cairo_surface_write_to_png.restype = ctypes.c_int
    cairo.cairo_destroy.argtypes = [ctypes.c_void_p]
    cairo.cairo_surface_destroy.argtypes = [ctypes.c_void_p]

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


def build_amber_waveform_svg(
    x0: float, y_center: float, width: float, num_bars: int = 118, progress: float = 0.36
) -> str:
    bars = []
    step = width / num_bars
    bar_w = max(2.8, step * 0.62)
    comment_dots = {6, 18, 29, 34, 42, 57, 73, 88, 103}
    for i in range(num_bars):
        t = i / max(1, num_bars - 1)
        env = (
            0.38
            + 0.34 * abs(math.sin(i * 0.37 + 0.4))
            + 0.18 * abs(math.cos(i * 0.83 - 0.2))
            + 0.10 * abs(math.sin(i * 1.55))
        )
        edge = min(1.0, min(t * 10.0, (1.0 - t) * 10.0) + 0.32)
        amp = max(0.22, min(0.96, env * edge))
        bar_h = round(amp * 26.0, 1)
        bx = round(x0 + i * step, 1)
        by = round(y_center - bar_h / 2.0, 1)

        if t <= progress:
            fill = "#f97316" if (i % 3 != 0) else "#fb923c"
            opacity = "0.95"
        else:
            fill = "#6b3818"
            opacity = "0.68"

        bars.append(
            f'<rect x="{bx}" y="{by}" width="{bar_w:.1f}" height="{bar_h}" rx="1.4" fill="{fill}" opacity="{opacity}"/>'
        )
        if i in comment_dots:
            bars.append(
                f'<circle cx="{round(bx + bar_w / 2.0, 1)}" cy="{round(y_center + 14.5, 1)}" r="1.7" fill="#fbbf24" opacity="0.85"/>'
            )
    return "\n      ".join(bars)


def build_checkerboard_floor_svg() -> str:
    polys = []
    horizon_y = 398.0
    bottom_y = 584.0
    center_x = 640.0
    rows = 7
    cols = 14
    for r in range(rows):
        t0 = (r / rows) ** 1.45
        t1 = ((r + 1) / rows) ** 1.45
        y0 = horizon_y + (bottom_y - horizon_y) * t0
        y1 = horizon_y + (bottom_y - horizon_y) * t1
        spread0 = 420.0 + 520.0 * t0
        spread1 = 420.0 + 520.0 * t1
        for c in range(-cols // 2, cols // 2):
            if (r + c) % 2 == 0:
                x0_l = center_x + (c / (cols / 2)) * spread0
                x0_r = center_x + ((c + 1) / (cols / 2)) * spread0
                x1_r = center_x + ((c + 1) / (cols / 2)) * spread1
                x1_l = center_x + (c / (cols / 2)) * spread1
                alpha = round(0.06 + 0.14 * t1, 3)
                polys.append(
                    f'<polygon points="{x0_l:.1f},{y0:.1f} {x0_r:.1f},{y0:.1f} {x1_r:.1f},{y1:.1f} {x1_l:.1f},{y1:.1f}" '
                    f'fill="#dc2626" fill-opacity="{alpha}"/>'
                )
    return "\n      ".join(polys)


def generate_svg() -> str:
    mime = "image/jpeg" if ICON_PATH.suffix.lower() in (".jpg", ".jpeg") else "image/png"
    icon_b64 = base64.b64encode(ICON_PATH.read_bytes()).decode("ascii")

    scrubber_x = 406.0
    scrubber_y = 342.0
    scrubber_w = 758.0
    scrubber_h = 44.0
    progress = 0.34
    waveform_bars = build_amber_waveform_svg(
        x0=scrubber_x + 14.0,
        y_center=scrubber_y + scrubber_h / 2.0,
        width=scrubber_w - 28.0,
        num_bars=116,
        progress=progress,
    )
    playhead_x = round(scrubber_x + 14.0 + (scrubber_w - 28.0) * progress, 1)
    playhead_y = round(scrubber_y + scrubber_h / 2.0, 1)
    floor_svg = build_checkerboard_floor_svg()

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="1280" height="640" viewBox="0 0 1280 640">
  <defs>
    <radialGradient id="redSphereGlow" cx="24%" cy="32%" r="32%">
      <stop offset="0%" stop-color="#dc2626" stop-opacity="0.22"/>
      <stop offset="65%" stop-color="#7f1d1d" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <radialGradient id="prismGlow" cx="72%" cy="34%" r="30%">
      <stop offset="0%" stop-color="#ef4444" stop-opacity="0.16"/>
      <stop offset="55%" stop-color="#1d4ed8" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <linearGradient id="prismLeftFace" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#dc2626" stop-opacity="0.38"/>
      <stop offset="100%" stop-color="#7f1d1d" stop-opacity="0.18"/>
    </linearGradient>

    <linearGradient id="prismRightFace" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1d4ed8" stop-opacity="0.36"/>
      <stop offset="100%" stop-color="#1e3a8a" stop-opacity="0.16"/>
    </linearGradient>

    <linearGradient id="heroPlayBg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#361908"/>
      <stop offset="100%" stop-color="#1f0e05"/>
    </linearGradient>

    <linearGradient id="blueBadgeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#3b82f6"/>
    </linearGradient>

    <!-- Main Left Cover Art Square Clip (x=104, y=224, 268x268, rx=22) -->
    <clipPath id="albumArtClip">
      <rect x="104" y="224" width="268" height="268" rx="22"/>
    </clipPath>

    <!-- Top-Left Mini Cover Art Clip (x=118, y=71, 24x24, rx=6) -->
    <clipPath id="miniArtClip">
      <rect x="118" y="71" width="24" height="24" rx="6"/>
    </clipPath>

    <!-- Main Console Viewport Clip -->
    <clipPath id="consoleClip">
      <rect x="56" y="48" width="1168" height="544" rx="24"/>
    </clipPath>
  </defs>

  <!-- 1. Outer Pure OLED Black Canvas -->
  <rect width="1280" height="640" fill="#000000"/>

  <!-- 2. Main Console Viewport (x=56..1224, y=48..592) -->
  <g clip-path="url(#consoleClip)">
    <rect x="56" y="48" width="1168" height="544" rx="24" fill="#040407"/>
    <rect x="56" y="48" width="1168" height="544" fill="url(#redSphereGlow)"/>
    <rect x="56" y="48" width="1168" height="544" fill="url(#prismGlow)"/>

    <!-- Demoscene 64K Background Scene: Perspective Red/Black Checkerboard Floor -->
    <g opacity="0.85">
      {floor_svg}
    </g>

    <!-- Demoscene 64K Background Wireframe Globe (Left-Center behind Title/Art) -->
    <g stroke="#ef4444" stroke-width="1" fill="none" opacity="0.22" transform="translate(310, 232)">
      <circle cx="0" cy="0" r="118"/>
      <ellipse cx="0" cy="0" rx="118" ry="42"/>
      <ellipse cx="0" cy="0" rx="118" ry="82"/>
      <ellipse cx="0" cy="0" rx="46" ry="118"/>
      <ellipse cx="0" cy="0" rx="88" ry="118"/>
      <line x1="-118" y1="0" x2="118" y2="0"/>
      <line x1="0" y1="-118" x2="0" y2="118"/>
    </g>

    <!-- Demoscene 64K 3D Shaded Prism + Red Orbital Ring (Upper Right) -->
    <g transform="translate(838, 224)">
      <polygon points="0,-108 -96,52 -12,76" fill="url(#prismLeftFace)" stroke="#f87171" stroke-opacity="0.35" stroke-width="1.2"/>
      <polygon points="0,-108 -12,76 92,42" fill="url(#prismRightFace)" stroke="#60a5fa" stroke-opacity="0.35" stroke-width="1.2"/>
      <ellipse cx="0" cy="-6" rx="148" ry="36" transform="rotate(-14)" fill="none" stroke="#ef4444" stroke-opacity="0.55" stroke-width="3"/>
    </g>

    <!-- ===================================================================
         TOP NAVIGATION BAR (Matches Live PlayerView Header)
         =================================================================== -->
    <rect x="56" y="48" width="1168" height="68" fill="#050509" fill-opacity="0.92"/>
    <line x1="56" y1="116" x2="1224" y2="116" stroke="#14141d" stroke-width="1"/>

    <!-- Top-Left Pill: [ ⚙ | Mini-Art | ☁️ IMP — Interactive Media Player ] -->
    <rect x="78" y="62" width="296" height="42" rx="13" fill="#0c0c14" stroke="#1f1f2b" stroke-width="1.2"/>
    <!-- Gear Icon -->
    <g transform="translate(98, 83)" stroke="#9ca3af" stroke-width="1.8" fill="none">
      <circle cx="0" cy="0" r="4.5"/>
      <path d="M 0 -7.5 L 0 -5.5 M 0 5.5 L 0 7.5 M -7.5 0 L -5.5 0 M 5.5 0 L 7.5 0 M -5.3 -5.3 L -3.9 -3.9 M 3.9 3.9 L 5.3 5.3 M -5.3 5.3 L -3.9 3.9 M 3.9 -3.9 L 5.3 -5.3"/>
    </g>
    <!-- Mini Cropped Art inside Top-Left Pill -->
    <g clip-path="url(#miniArtClip)">
      <image x="110" y="68" width="40" height="40" preserveAspectRatio="xMidYMin slice"
             xlink:href="data:{mime};base64,{icon_b64}"/>
    </g>
    <!-- Cloud/Bolt Badge + Title -->
    <path d="M 152 86 C 149 86, 147 84, 147 81.5 C 147 79.2, 148.8 77.4, 151 77.2 C 151.8 74.8, 154 73, 156.8 73 C 160.2 73, 163 75.8, 163 79.2 C 164.8 79.6, 166 81.2, 166 83 C 166 84.7, 164.7 86, 163 86 Z"
          fill="#e4e4ec"/>
    <text x="173" y="87" fill="#f4f4f8" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
          font-size="13" font-weight="800">IMP — Interactive Media</text>

    <!-- Top-Center Segmented Pill: [ Player | Library & Queue ] -->
    <rect x="496" y="60" width="288" height="46" rx="14" fill="#090910" stroke="#1c1c28" stroke-width="1.2"/>
    <!-- Active Tab: Player -->
    <rect x="502" y="65" width="114" height="36" rx="10" fill="#10212b" stroke="#2aa3c4" stroke-width="1.5"/>
    <!-- Vector Musical Note Icon -->
    <g transform="translate(524, 76)" fill="#a78bfa">
      <path d="M 4 11 A 2.5 2.2 0 1 1 1.5 8.8 L 1.5 2 L 11 0 L 11 9.5 A 2.5 2.2 0 1 1 8.5 7.3 L 8.5 2.8 L 3.5 3.8 L 3.5 11 Z"/>
    </g>
    <text x="568" y="88" text-anchor="middle" fill="#f4f4f8"
          font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
          font-size="13" font-weight="800">Player</text>
    <!-- Inactive Tab: Library & Queue (Stacked Cards Vector Icon) -->
    <g transform="translate(628, 76)">
      <rect x="0" y="3" width="9" height="9" rx="1.8" fill="#34d399"/>
      <rect x="3" y="1.5" width="9" height="9" rx="1.8" fill="#60a5fa"/>
      <rect x="6" y="0" width="9" height="9" rx="1.8" fill="#f472b6"/>
    </g>
    <text x="713" y="88" text-anchor="middle" fill="#9ca3af"
          font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
          font-size="13" font-weight="700">Library &amp; Queue</text>

    <!-- Top-Right Cluster: Volume [ 🔊 | 80% ▾ ] + Brightness [ 🔆 100% ▾ ] + Menu [ ☰ ] -->
    <!-- Volume Split Pill -->
    <rect x="954" y="62" width="96" height="42" rx="13" fill="#0c0c14" stroke="#1f1f2b" stroke-width="1.2"/>
    <path d="M 966 63 L 996 63 L 996 103 L 966 103 A 12 12 0 0 1 955 91 L 955 75 A 12 12 0 0 1 966 63 Z" fill="#10212b"/>
    <polygon points="971,80 976,80 981,75 981,91 976,86 971,86" fill="#e0f2fe"/>
    <path d="M 984 79 Q 987 83 984 87" fill="none" stroke="#60a5fa" stroke-width="1.6" stroke-linecap="round"/>
    <line x1="996" y1="62" x2="996" y2="104" stroke="#1f1f2b" stroke-width="1.2"/>
    <text x="1022" y="87" text-anchor="middle" fill="#e4e4ec"
          font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
          font-size="12" font-weight="800">80% ▾</text>

    <!-- Brightness Pill -->
    <rect x="1058" y="62" width="92" height="42" rx="13" fill="#0c0c14" stroke="#1f1f2b" stroke-width="1.2"/>
    <circle cx="1076" cy="83" r="4.5" fill="#f59e0b"/>
    <text x="1116" y="87" text-anchor="middle" fill="#e4e4ec"
          font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
          font-size="12" font-weight="800">100% ▾</text>

    <!-- Hamburger Settings Button [ ☰ ] -->
    <rect x="1158" y="62" width="44" height="42" rx="13" fill="#0c0c14" stroke="#1f1f2b" stroke-width="1.2"/>
    <g stroke="#d4d4dc" stroke-width="1.8" stroke-linecap="round">
      <line x1="1173" y1="77" x2="1187" y2="77"/>
      <line x1="1173" y1="83" x2="1187" y2="83"/>
      <line x1="1173" y1="89" x2="1187" y2="89"/>
    </g>

    <!-- ===================================================================
         LEFT COLUMN: TRACK/HERO HEADER + TIGHT CROPPED IMP ARTWORK CARD
         =================================================================== -->
    <text x="104" y="168" fill="#ffffff"
          font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
          font-size="31" font-weight="900" letter-spacing="-0.4">IMP</text>
    <text x="176" y="167" fill="#9ca3af"
          font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
          font-size="19" font-weight="700">— Interactive Media Player (SIMP)</text>

    <text x="104" y="198" fill="#d4d4dc"
          font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
          font-size="15.5" font-weight="600">
      <tspan text-decoration="underline" fill="#f4f4f8">Native Rust Audio &amp; Video</tspan>
      <tspan fill="#71717a"> • </tspan>
      <tspan fill="#e4e4ec">SteamOS • Linux • macOS • Windows • SteamVR</tspan>
      <tspan fill="#71717a"> • </tspan>
      <tspan fill="#6ee7b7">&lt; 1% CPU</tspan>
    </text>

    <!-- Background Demoscene Faded Text Behind Middle Area -->
    <text x="586" y="218" text-anchor="middle" fill="#60a5fa" opacity="0.28"
          font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
          font-size="25" font-weight="900" letter-spacing="2">INTERACTIVE MEDIA</text>
    <text x="584" y="219" text-anchor="middle" fill="#ef4444" opacity="0.32"
          font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
          font-size="25" font-weight="900" letter-spacing="2">INTERACTIVE MEDIA</text>

    <!-- Left Cover Art Card (x=104, y=224, 268x268, rx=22)
         Cropped tightly on Pose B's chest-up, broccoli crown, earbud + cord, and golden lightning bolt -->
    <rect x="102" y="222" width="272" height="272" rx="24" fill="#050508"/>
    <g clip-path="url(#albumArtClip)">
      <rect x="104" y="224" width="268" height="268" fill="#000000"/>
      <!-- Tight zoom & crop matching user's reference screenshot -->
      <image x="-74" y="184" width="628" height="628"
             xlink:href="data:{mime};base64,{icon_b64}"/>
    </g>
    <rect x="104" y="224" width="268" height="268" rx="22"
          fill="none" stroke="#1e1e2a" stroke-width="2"/>

    <!-- ===================================================================
         RIGHT AREA: FLOATING COMMENT BUBBLE + AMBER WAVEFORM CAPSULE + 7-BTN TRANSPORT
         =================================================================== -->
    <!-- Floating Timed Comment Card (Aligned above waveform scrubber) -->
    <rect x="534" y="256" width="576" height="72" rx="14"
          fill="#0c0c12" fill-opacity="0.94" stroke="#78350f" stroke-opacity="0.75" stroke-width="1.4"/>
    <!-- Comment Avatar Circle -->
    <circle cx="578" cy="292" r="18" fill="#1e1b2e" stroke="#fb923c" stroke-width="1.5"/>
    <text x="578" y="297" text-anchor="middle" fill="#fdba74"
          font-family="system-ui, -apple-system, sans-serif" font-size="15" font-weight="900">♪</text>
    <text x="608" y="283" fill="#fdba74"
          font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
          font-size="12.5" font-weight="800">@deck_audiophile</text>
    <!-- Timestamp Pill inside Comment Card -->
    <rect x="736" y="269" width="54" height="20" rx="6" fill="#2e1608" stroke="#9a3412" stroke-width="1"/>
    <text x="763" y="283" text-anchor="middle" fill="#fdba74"
          font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
          font-size="11" font-weight="800">02:14</text>
    <text x="608" y="309" fill="#f4f4f8"
          font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
          font-size="13.5" font-weight="600">“Local FLAC, Apple Music, SoundCloud, IA &amp; CDs in one queue!”</text>

    <!-- Full-Width Capsule Waveform Scrubber -->
    <rect x="{scrubber_x}" y="{scrubber_y}" width="{scrubber_w}" height="{scrubber_h}" rx="22"
          fill="#0d0d14" fill-opacity="0.92" stroke="#222230" stroke-width="1.4"/>
    <g>
      {waveform_bars}
    </g>
    <!-- Large Circular Silver/Grey Playhead Knob with Orange Ring -->
    <circle cx="{playhead_x}" cy="{playhead_y}" r="18" fill="#a1a1aa" stroke="#f97316" stroke-width="3"/>

    <!-- Left & Right Timestamp Pills Under Waveform -->
    <rect x="406" y="395" width="56" height="22" rx="6" fill="#090910" fill-opacity="0.88"/>
    <text x="434" y="410" text-anchor="middle" fill="#e4e4ec"
          font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
          font-size="12.5" font-weight="800">01:12</text>

    <rect x="1108" y="395" width="56" height="22" rx="6" fill="#090910" fill-opacity="0.88"/>
    <text x="1136" y="410" text-anchor="middle" fill="#9ca3af"
          font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
          font-size="12.5" font-weight="800">03:36</text>

    <!-- ===================================================================
         7-BUTTON TRANSPORT ROW (Centered under Waveform Scrubber)
         =================================================================== -->
    <!-- 1. Shuffle [ 🔀 ] -->
    <g transform="translate(502, 434)">
      <rect width="68" height="66" rx="16" fill="#0e0e16" stroke="#232332" stroke-width="1.4"/>
      <rect x="21" y="20" width="26" height="26" rx="6" fill="url(#blueBadgeGrad)"/>
      <path d="M 26 28 L 31 28 L 39 38 L 43 38 M 26 38 L 31 38 L 39 28 L 43 28"
            fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
    </g>

    <!-- 2. Seek Back [ ⏪ ] -->
    <g transform="translate(580, 434)">
      <rect width="68" height="66" rx="16" fill="#0e0e16" stroke="#232332" stroke-width="1.4"/>
      <rect x="21" y="20" width="26" height="26" rx="6" fill="url(#blueBadgeGrad)"/>
      <polygon points="34,27 26,33 34,39" fill="#ffffff"/>
      <polygon points="42,27 34,33 42,39" fill="#ffffff"/>
    </g>

    <!-- 3. Previous Track [ ⏮ ] -->
    <g transform="translate(658, 434)">
      <rect width="68" height="66" rx="16" fill="#0e0e16" stroke="#232332" stroke-width="1.4"/>
      <rect x="23" y="24" width="2.8" height="18" rx="1" fill="#ffffff"/>
      <polygon points="35,24 26,33 35,42" fill="#ffffff"/>
      <polygon points="44,24 35,33 44,42" fill="#ffffff"/>
    </g>

    <!-- 4. Center Hero Play/Pause Button (Dual Orange + Cyan Focus Ring) -->
    <g transform="translate(736, 426)">
      <rect x="-3" y="-3" width="98" height="88" rx="22" fill="none" stroke="#2aa3c4" stroke-width="2.4"/>
      <rect width="92" height="82" rx="19" fill="url(#heroPlayBg)" stroke="#f97316" stroke-width="2.2"/>
      <rect x="38" y="30" width="5.5" height="22" rx="1.8" fill="#fb923c"/>
      <rect x="48.5" y="30" width="5.5" height="22" rx="1.8" fill="#fb923c"/>
    </g>

    <!-- 5. Next Track [ ⏭ ] -->
    <g transform="translate(838, 434)">
      <rect width="68" height="66" rx="16" fill="#0e0e16" stroke="#232332" stroke-width="1.4"/>
      <polygon points="24,24 33,33 24,42" fill="#ffffff"/>
      <polygon points="33,24 42,33 33,42" fill="#ffffff"/>
      <rect x="42.2" y="24" width="2.8" height="18" rx="1" fill="#ffffff"/>
    </g>

    <!-- 6. Seek Forward [ ⏩ ] -->
    <g transform="translate(916, 434)">
      <rect width="68" height="66" rx="16" fill="#0e0e16" stroke="#232332" stroke-width="1.4"/>
      <rect x="21" y="20" width="26" height="26" rx="6" fill="url(#blueBadgeGrad)"/>
      <polygon points="26,27 34,33 26,39" fill="#ffffff"/>
      <polygon points="34,27 42,33 34,39" fill="#ffffff"/>
    </g>

    <!-- 7. Repeat [ 🔁 ] -->
    <g transform="translate(994, 434)">
      <rect width="68" height="66" rx="16" fill="#0e0e16" stroke="#232332" stroke-width="1.4"/>
      <rect x="21" y="20" width="26" height="26" rx="6" fill="url(#blueBadgeGrad)"/>
      <path d="M 27 30 L 40 30 L 40 34 M 41 36 L 28 36 L 28 32"
            fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </g>

    <!-- ===================================================================
         BOTTOM-CENTER CAPTION PILL (Matches Synced Lyric Pill Container Style)
         =================================================================== -->
    <rect x="424" y="520" width="432" height="54" rx="14"
          fill="#07070c" fill-opacity="0.92" stroke="#181824" stroke-width="1.2"/>
    <text x="640" y="542" text-anchor="middle" fill="#67e8f9"
          font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
          font-size="14.5" font-weight="800">Controller-First Console &amp; Desktop Media Player</text>
    <text x="640" y="562" text-anchor="middle" fill="#9ca3af"
          font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
          font-size="12" font-weight="600">github.com/niiiitz/simp • GPL-3.0</text>
  </g>

  <!-- Outer Console Frame Border -->
  <rect x="56" y="48" width="1168" height="544" rx="24"
        fill="none" stroke="#1e2230" stroke-width="2"/>
</svg>
"""


def main() -> None:
    OUT_SVG.parent.mkdir(parents=True, exist_ok=True)
    svg_str = generate_svg()
    svg_bytes = svg_str.encode("utf-8")
    OUT_SVG.write_bytes(svg_bytes)
    render_svg_to_png(svg_bytes, OUT_PNG, width=1280, height=640)
    print(f"Wrote {OUT_SVG} and {OUT_PNG}")


if __name__ == "__main__":
    main()
