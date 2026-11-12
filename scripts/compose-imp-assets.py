#!/usr/bin/env python3
"""
Deterministic Decomposed Layer Kit & Compositor for IMP ("Interactive Media Player").

Generates strictly isolated, transparent SVG + 1024x1024 RGBA PNG layers in
`reference_documentation/artwork_archive/imp_layers/`:
  - layer_01_lightning_bolt.{svg,png}
  - layer_02_imp_head_disembodied.{svg,png}
  - layer_03a_imp_body_pose_1_balanced.{svg,png}
  - layer_03b_imp_body_pose_2_chin_up_chest_out.{svg,png}
  - layer_03c_imp_body_pose_3_groove_stride.{svg,png}
  - layer_04_classic_music_player.{svg,png}
  - layer_05_earbuds.{svg,png}
  - layer_06_earbud_cord.{svg,png}

And composites them (with configurable offsets, scales, and Bezier cord sway)
into preview composites without modifying `ui/public/` icons until promoted.
"""

import argparse
import ctypes
import ctypes.util
import json
from pathlib import Path
from typing import Dict, Tuple

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "reference_documentation" / "artwork_archive" / "imp_layers"


def render_svg_to_png(svg_str: str, out_path: Path, width: int = 1024, height: int = 1024) -> None:
    svg_bytes = svg_str.encode("utf-8")
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
        raise RuntimeError(f"rsvg_handle_new_from_data failed for {out_path}")

    surface = cairo.cairo_image_surface_create(0, width, height)
    cr = cairo.cairo_create(surface)
    ok = rsvg.rsvg_handle_render_cairo(handle, cr)
    if not ok:
        raise RuntimeError(f"rsvg_handle_render_cairo failed for {out_path}")

    status = cairo.cairo_surface_write_to_png(surface, str(out_path).encode("utf-8"))
    cairo.cairo_destroy(cr)
    cairo.cairo_surface_destroy(surface)
    if status != 0:
        raise RuntimeError(f"cairo_surface_write_to_png failed ({status}) for {out_path}")


def wrap_svg(inner: str, bg_color: str | None = None) -> str:
    bg_rect = (
        f'<rect x="0" y="0" width="1024" height="1024" rx="180" fill="{bg_color}"/>'
        if bg_color
        else ""
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="boltGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fff033"/>
      <stop offset="55%" stop-color="#facc15"/>
      <stop offset="100%" stop-color="#f59e0b"/>
    </linearGradient>
    <linearGradient id="broccoliGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#62d944"/>
      <stop offset="55%" stop-color="#2ea836"/>
      <stop offset="100%" stop-color="#15681c"/>
    </linearGradient>
    <linearGradient id="impFurGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4ade80"/>
      <stop offset="55%" stop-color="#16a34a"/>
      <stop offset="100%" stop-color="#065f46"/>
    </linearGradient>
    <linearGradient id="impChestGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#86efac"/>
      <stop offset="100%" stop-color="#22c55e"/>
    </linearGradient>
    <linearGradient id="cyanFade" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#22d3ee"/>
      <stop offset="100%" stop-color="#0891b2"/>
    </linearGradient>
    <linearGradient id="ipodCaseGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="45%" stop-color="#cbd5e1"/>
      <stop offset="100%" stop-color="#64748b"/>
    </linearGradient>
    <linearGradient id="ipodScreenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#082f49"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="12" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  {bg_rect}
  {inner}
</svg>"""


# ------------------------------------------------------------------------------
# Layer 01: Standalone Electric Lightning Bolt Emblem
# ------------------------------------------------------------------------------
def layer_01_lightning_bolt_inner() -> str:
    return """
  <g id="layer_01_lightning_bolt" filter="url(#neonGlow)">
    <path d="M 595 92 L 265 545 L 478 545 L 392 932 L 772 446 L 542 446 Z"
          fill="url(#boltGrad)" stroke="#ffffff" stroke-width="14" stroke-linejoin="round"/>
    <path d="M 565 152 L 325 518 L 495 518 L 434 832 L 708 474 L 522 474 Z"
          fill="none" stroke="#fef08a" stroke-width="5" stroke-opacity="0.75" stroke-linejoin="round"/>
  </g>
"""


# ------------------------------------------------------------------------------
# Broccoli Hair + Green Monkey-Imp Head Generator (Reusable across Head & Poses)
# ------------------------------------------------------------------------------
def build_imp_head_group(
    cx: float = 512.0,
    cy: float = 310.0,
    scale: float = 1.0,
    chin_tilt_deg: float = 0.0,
    confident_smirk: bool = True,
) -> Tuple[str, Dict[str, Tuple[float, float]]]:
    """
    Returns (svg_group_str, ear_anchors_dict) where ear_anchors_dict contains
    `ear_l` and `ear_r` in 1024x1024 canvas coordinates.
    """
    # Compute transformed ear anchor coordinates
    import math

    rad = math.radians(chin_tilt_deg)
    cos_a, sin_a = math.cos(rad), math.sin(rad)

    def tx_pt(dx: float, dy: float) -> Tuple[float, float]:
        sx, sy = dx * scale, dy * scale
        rx = sx * cos_a - sy * sin_a
        ry = sx * sin_a + sy * cos_a
        return (round(cx + rx, 1), round(cy + ry, 1))

    ear_l = tx_pt(-148.0, 26.0)
    ear_r = tx_pt(142.0, 18.0)

    chin_path = (
        "M -118 10 C -115 112, -55 156, 12 152 C 84 148, 128 96, 124 4"
        if not confident_smirk
        else "M -118 6 C -112 104, -46 144, 22 138 C 94 132, 134 80, 128 -6"
    )
    smirk_path = (
        "M -32 86 Q 16 106 64 78"
        if not confident_smirk
        else "M -24 76 Q 28 102 76 62"
    )

    svg = f"""
  <g transform="translate({cx},{cy}) rotate({chin_tilt_deg}) scale({scale})">
    <!-- Pointed Green Monkey-Imp Ears -->
    <path d="M -126 -12 C -195 -42, -224 8, -182 54 C -158 78, -134 66, -118 44 Z"
          fill="url(#impFurGrad)" stroke="#ffffff" stroke-width="10" stroke-linejoin="round"/>
    <path d="M -142 6 C -175 -10, -188 18, -162 40" fill="none" stroke="#22d3ee" stroke-width="6" stroke-linecap="round"/>

    <path d="M 122 -18 C 192 -48, 220 2, 178 48 C 154 72, 130 60, 114 38 Z"
          fill="url(#impFurGrad)" stroke="#ffffff" stroke-width="10" stroke-linejoin="round"/>
    <path d="M 138 0 C 170 -16, 184 12, 158 34" fill="none" stroke="#22d3ee" stroke-width="6" stroke-linecap="round"/>

    <!-- Shaved Cyan Temple Fade Sides (v3/v5 signature) -->
    <path d="M -130 -58 L -98 -52 L -106 24 L -136 16 Z" fill="url(#cyanFade)" stroke="#ffffff" stroke-width="6"/>
    <path d="M 126 -62 L 94 -56 L 102 18 L 132 10 Z" fill="url(#cyanFade)" stroke="#ffffff" stroke-width="6"/>

    <!-- Green Monkey-Imp Head Silhouette & Chin -->
    <path d="{chin_path} L 116 -58 L -114 -58 Z"
          fill="#07120e" stroke="#22d3ee" stroke-width="9" stroke-linejoin="round"/>

    <!-- Emerald Cheek / Brow Highlight & Confident Expressive Eyes + Smirk -->
    <path d="M -78 4 Q -42 -18 -14 0" fill="none" stroke="#4ade80" stroke-width="8" stroke-linecap="round"/>
    <path d="M 18 -4 Q 54 -24 84 -4" fill="none" stroke="#4ade80" stroke-width="8" stroke-linecap="round"/>
    <ellipse cx="-44" cy="22" rx="12" ry="15" fill="#4ade80"/>
    <circle cx="-40" cy="18" r="5" fill="#ffffff"/>
    <ellipse cx="52" cy="18" rx="12" ry="15" fill="#4ade80"/>
    <circle cx="56" cy="14" r="5" fill="#ffffff"/>
    <path d="{smirk_path}" fill="none" stroke="#4ade80" stroke-width="7" stroke-linecap="round"/>
    <path d="M 58 68 L 68 82 L 74 65" fill="#ffffff"/>

    <!-- Signature Green Broccoli-Floret Crown (No Horns) -->
    <path d="M -146 -56
             C -178 -96, -162 -154, -116 -166
             C -112 -214, -52 -242, -4 -222
             C 36 -248, 102 -232, 118 -184
             C 168 -178, 188 -122, 154 -76
             C 172 -42, 142 -12, 108 -28
             C 78 -6, 32 -10, 4 -30
             C -28 -8, -78 -10, -104 -32
             C -134 -16, -162 -32, -146 -56 Z"
          fill="url(#broccoliGrad)" stroke="#05080c" stroke-width="14" stroke-linejoin="round"/>

    <!-- Broccoli Floret Leafy Arcs -->
    <path d="M -112 -128 A 28 28 0 1 1 -64 -148" fill="none" stroke="#86efac" stroke-width="9" stroke-linecap="round"/>
    <path d="M -38 -176 A 32 32 0 1 1 22 -172" fill="none" stroke="#86efac" stroke-width="9" stroke-linecap="round"/>
    <path d="M 48 -148 A 28 28 0 1 1 98 -116" fill="none" stroke="#86efac" stroke-width="9" stroke-linecap="round"/>
    <path d="M -82 -78 A 24 24 0 1 0 -32 -74" fill="none" stroke="#14532d" stroke-width="8" stroke-linecap="round"/>
    <path d="M 14 -86 A 26 26 0 1 0 68 -80" fill="none" stroke="#14532d" stroke-width="8" stroke-linecap="round"/>
    <path d="M -18 -122 A 22 22 0 1 1 26 -118" fill="none" stroke="#bbf7d0" stroke-width="7" stroke-linecap="round"/>
  </g>
"""
    return svg, {"ear_l": ear_l, "ear_r": ear_r}


def layer_02_imp_head_disembodied_inner() -> Tuple[str, Dict[str, Tuple[float, float]]]:
    svg, anchors = build_imp_head_group(cx=512.0, cy=490.0, scale=1.55, chin_tilt_deg=-6.0, confident_smirk=True)
    return f'<g id="layer_02_imp_head_disembodied">{svg}</g>', anchors


# ------------------------------------------------------------------------------
# Layer 03 (a, b, c): Full-Body Green Monkey-Imp Posture Variations
# ------------------------------------------------------------------------------
def build_fullbody_pose(pose_id: str) -> Tuple[str, Dict[str, Tuple[float, float]]]:
    """
    pose_id:
      - 'pose_1_balanced': Classic balanced stance
      - 'pose_2_chin_up_chest_out': Self-assured chin-up & chest-out hero stance
      - 'pose_3_groove_stride': Dynamic leaning-into-the-beat groove stance
    Returns (svg_inner, anchors) with `ear_l`, `ear_r`, `right_hand_mp3` in 1024x1024 coords.
    """
    if pose_id == "pose_1_balanced":
        head_svg, ear_anchors = build_imp_head_group(
            cx=490.0, cy=285.0, scale=1.02, chin_tilt_deg=-2.0, confident_smirk=False
        )
        # Viewer-left = character's right hand holding the MP3 player
        right_hand = (290.0, 560.0)
        body_svg = f"""
  <g id="layer_03a_imp_body_pose_1_balanced">
    <!-- Whip Tail with Pointed Imp Spade Tip -->
    <path d="M 555 645 C 690 665, 785 555, 745 435 C 720 360, 810 315, 855 365"
          fill="none" stroke="url(#impFurGrad)" stroke-width="22" stroke-linecap="round"/>
    <path d="M 555 645 C 690 665, 785 555, 745 435 C 720 360, 810 315, 855 365"
          fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-opacity="0.65"/>
    <path d="M 845 340 L 895 375 L 845 398 L 858 368 Z" fill="#22d3ee" stroke="#ffffff" stroke-width="6" stroke-linejoin="round"/>

    <!-- Legs & Stylized Sneakers/Feet -->
    <path d="M 445 655 L 415 845 L 355 865" fill="none" stroke="url(#impFurGrad)" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M 545 655 L 580 845 L 640 865" fill="none" stroke="url(#impFurGrad)" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"/>
    <ellipse cx="378" cy="872" rx="48" ry="22" fill="#0f172a" stroke="#ffffff" stroke-width="8"/>
    <ellipse cx="618" cy="872" rx="48" ry="22" fill="#0f172a" stroke="#ffffff" stroke-width="8"/>

    <!-- Balanced Torso -->
    <path d="M 415 435 C 395 525, 415 635, 440 668 L 555 668 C 580 635, 595 525, 568 435 Z"
          fill="url(#impFurGrad)" stroke="#ffffff" stroke-width="12" stroke-linejoin="round"/>
    <ellipse cx="495" cy="545" rx="52" ry="74" fill="url(#impChestGrad)" opacity="0.88"/>

    <!-- Character's Left Arm (Viewer Right — Relaxed on Hip) -->
    <path d="M 565 452 C 635 485, 655 565, 585 615"
          fill="none" stroke="url(#impFurGrad)" stroke-width="34" stroke-linecap="round"/>
    <circle cx="582" cy="618" r="22" fill="url(#impFurGrad)" stroke="#ffffff" stroke-width="8"/>

    <!-- Character's Right Arm (Viewer Left — Extended Holding Classic MP3 Player) -->
    <path d="M 418 455 C 355 488, 332 548, {right_hand[0]} {right_hand[1]}"
          fill="none" stroke="url(#impFurGrad)" stroke-width="34" stroke-linecap="round"/>
    <circle cx="{right_hand[0]}" cy="{right_hand[1]}" r="24" fill="url(#impFurGrad)" stroke="#ffffff" stroke-width="8"/>

    {head_svg}
  </g>
"""
        anchors = {**ear_anchors, "right_hand_mp3": right_hand}
        return body_svg, anchors

    if pose_id == "pose_2_chin_up_chest_out":
        # Self-assured chin up (-11 deg tilt) and proud puffed-out chest!
        head_svg, ear_anchors = build_imp_head_group(
            cx=505.0, cy=268.0, scale=1.06, chin_tilt_deg=-11.0, confident_smirk=True
        )
        right_hand = (268.0, 522.0)
        body_svg = f"""
  <g id="layer_03b_imp_body_pose_2_chin_up_chest_out">
    <!-- High-Poised Confident Whip Tail -->
    <path d="M 548 642 C 705 638, 808 505, 762 378 C 736 305, 825 255, 878 308"
          fill="none" stroke="url(#impFurGrad)" stroke-width="24" stroke-linecap="round"/>
    <path d="M 548 642 C 705 638, 808 505, 762 378 C 736 305, 825 255, 878 308"
          fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-opacity="0.7"/>
    <path d="M 868 282 L 918 315 L 866 340 L 880 310 Z" fill="#22d3ee" stroke="#ffffff" stroke-width="6" stroke-linejoin="round"/>

    <!-- Wide Heroic Power Stance Legs -->
    <path d="M 438 650 L 388 852 L 328 872" fill="none" stroke="url(#impFurGrad)" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M 548 650 L 605 852 L 665 872" fill="none" stroke="url(#impFurGrad)" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>
    <ellipse cx="352" cy="878" rx="52" ry="24" fill="#0f172a" stroke="#ffffff" stroke-width="8"/>
    <ellipse cx="642" cy="878" rx="52" ry="24" fill="#0f172a" stroke="#ffffff" stroke-width="8"/>

    <!-- Proud Puffed-Out Chest, Arching Hero Torso & Subtle Ken-Doll Pelvic Contour -->
    <path d="M 412 415
             C 372 485, 392 595, 435 662
             Q 495 688, 555 662
             C 618 575, 632 465, 575 408 Z"
          fill="url(#impFurGrad)" stroke="#ffffff" stroke-width="13" stroke-linejoin="round"/>
    <ellipse cx="496" cy="656" rx="34" ry="18" fill="url(#impFurGrad)" stroke="#14532d" stroke-width="4"/>
    <!-- Prominent Forward Chest Plate Highlight -->
    <path d="M 442 438 C 415 505, 432 592, 475 632 C 555 632, 592 545, 562 435 Z"
          fill="url(#impChestGrad)" stroke="#22d3ee" stroke-width="5"/>
    <path d="M 458 488 Q 515 512 552 478" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.75"/>

    <!-- Character's Left Arm (Viewer Right — Confident Fist on Hip, Elbow Out) -->
    <path d="M 578 432 C 668 468, 678 555, 592 605"
          fill="none" stroke="url(#impFurGrad)" stroke-width="36" stroke-linecap="round"/>
    <circle cx="588" cy="608" r="24" fill="url(#impFurGrad)" stroke="#ffffff" stroke-width="8"/>

    <!-- Character's Right Arm (Viewer Left — Raised Proudly Presenting Classic MP3 Player) -->
    <path d="M 412 432 C 338 455, 312 495, {right_hand[0]} {right_hand[1]}"
          fill="none" stroke="url(#impFurGrad)" stroke-width="36" stroke-linecap="round"/>
    <circle cx="{right_hand[0]}" cy="{right_hand[1]}" r="25" fill="url(#impFurGrad)" stroke="#ffffff" stroke-width="8"/>

    {head_svg}
  </g>
"""
        anchors = {**ear_anchors, "right_hand_mp3": right_hand}
        return body_svg, anchors

    # pose_3_groove_stride: Dynamic mid-stride / leaning into the beat with chin up
    head_svg, ear_anchors = build_imp_head_group(
        cx=528.0, cy=276.0, scale=1.05, chin_tilt_deg=-14.0, confident_smirk=True
    )
    right_hand = (278.0, 505.0)
    body_svg = f"""
  <g id="layer_03c_imp_body_pose_3_groove_stride">
    <!-- Whipping Groove Tail -->
    <path d="M 525 648 C 675 695, 815 595, 795 455 C 782 375, 865 345, 905 395"
          fill="none" stroke="url(#impFurGrad)" stroke-width="23" stroke-linecap="round"/>
    <path d="M 895 370 L 942 405 L 892 428 L 906 398 Z" fill="#22d3ee" stroke="#ffffff" stroke-width="6" stroke-linejoin="round"/>

    <!-- Dynamic Mid-Stride Groove Legs -->
    <path d="M 442 648 C 405 735, 355 805, 315 858" fill="none" stroke="url(#impFurGrad)" stroke-width="38" stroke-linecap="round"/>
    <path d="M 538 648 C 595 725, 645 785, 685 842" fill="none" stroke="url(#impFurGrad)" stroke-width="38" stroke-linecap="round"/>
    <ellipse cx="305" cy="868" rx="50" ry="23" transform="rotate(-14 305 868)" fill="#0f172a" stroke="#ffffff" stroke-width="8"/>
    <ellipse cx="695" cy="852" rx="50" ry="23" transform="rotate(18 695 852)" fill="#0f172a" stroke="#ffffff" stroke-width="8"/>

    <!-- Forward-Leaning Chest-Out Groove Torso -->
    <path d="M 432 418 C 392 492, 405 595, 438 655 L 548 655 C 605 582, 628 478, 588 412 Z"
          fill="url(#impFurGrad)" stroke="#ffffff" stroke-width="13" stroke-linejoin="round"/>
    <path d="M 458 442 C 435 508, 445 588, 482 628 C 552 628, 595 548, 572 438 Z"
          fill="url(#impChestGrad)" stroke="#22d3ee" stroke-width="5"/>

    <!-- Left Arm Swinging Back with the Beat -->
    <path d="M 588 438 C 675 462, 715 525, 675 588"
          fill="none" stroke="url(#impFurGrad)" stroke-width="35" stroke-linecap="round"/>
    <circle cx="675" cy="588" r="23" fill="url(#impFurGrad)" stroke="#ffffff" stroke-width="8"/>

    <!-- Right Arm Raised Holding Classic MP3 Player -->
    <path d="M 432 435 C 355 448, 322 478, {right_hand[0]} {right_hand[1]}"
          fill="none" stroke="url(#impFurGrad)" stroke-width="35" stroke-linecap="round"/>
    <circle cx="{right_hand[0]}" cy="{right_hand[1]}" r="25" fill="url(#impFurGrad)" stroke="#ffffff" stroke-width="8"/>

    {head_svg}
  </g>
"""
    anchors = {**ear_anchors, "right_hand_mp3": right_hand}
    return body_svg, anchors


# ------------------------------------------------------------------------------
# Layer 04: Standalone Classic Click-Wheel MP3 Player (iPod Classic Homage)
# ------------------------------------------------------------------------------
def build_classic_mp3_player_layer(
    cx: float = 268.0,
    cy: float = 522.0,
    scale: float = 1.0,
    tilt_deg: float = -12.0,
) -> Tuple[str, Tuple[float, float]]:
    """
    Returns (svg_group, jack_anchor_xy) where jack_anchor_xy is the 3.5mm
    headphone jack on the top bezel of the player.
    """
    import math

    rad = math.radians(tilt_deg)
    # Top-right headphone jack offset in local player coords: (+28, -96)
    dx, dy = 28.0 * scale, -96.0 * scale
    jx = round(cx + dx * math.cos(rad) - dy * math.sin(rad), 1)
    jy = round(cy + dx * math.sin(rad) + dy * math.cos(rad), 1)

    svg = f"""
  <g id="layer_04_classic_music_player" transform="translate({cx},{cy}) rotate({tilt_deg}) scale({scale})">
    <!-- 3.5mm Headphone Plug Collar at Top -->
    <rect x="20" y="-108" width="16" height="16" rx="4" fill="#ffffff" stroke="#0f172a" stroke-width="3"/>
    <!-- Anodized Silver/Slate Classic Body -->
    <rect x="-64" y="-92" width="128" height="184" rx="22"
          fill="url(#ipodCaseGrad)" stroke="#ffffff" stroke-width="8"/>
    <rect x="-58" y="-86" width="116" height="172" rx="18"
          fill="none" stroke="#0f172a" stroke-width="2" stroke-opacity="0.35"/>

    <!-- Backlit Color LCD Screen -->
    <rect x="-48" y="-76" width="96" height="68" rx="8"
          fill="url(#ipodScreenGrad)" stroke="#38bdf8" stroke-width="4"/>
    <!-- Mini Now Playing Bar on Screen -->
    <rect x="-38" y="-64" width="28" height="28" rx="4" fill="#fb923c"/>
    <line x1="-2" y1="-56" x2="36" y2="-56" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
    <line x1="-2" y1="-44" x2="26" y2="-44" stroke="#38bdf8" stroke-width="4" stroke-linecap="round"/>
    <line x1="-38" y1="-22" x2="38" y2="-22" stroke="#334155" stroke-width="5" stroke-linecap="round"/>
    <line x1="-38" y1="-22" x2="14" y2="-22" stroke="#22d3ee" stroke-width="5" stroke-linecap="round"/>

    <!-- Iconic Capacitive Click Wheel -->
    <circle cx="0" cy="38" r="40" fill="#0f172a" stroke="#ffffff" stroke-width="5"/>
    <circle cx="0" cy="38" r="14" fill="url(#ipodCaseGrad)" stroke="#38bdf8" stroke-width="3"/>
    <!-- MENU / >> / << / >|| labels -->
    <line x1="-10" y1="8" x2="10" y2="8" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/>
    <polygon points="24,34 32,38 24,42" fill="#94a3b8"/>
    <polygon points="-24,34 -32,38 -24,42" fill="#94a3b8"/>
    <polygon points="-4,64 4,68 -4,72" fill="#38bdf8"/>
  </g>
"""
    return svg, (jx, jy)


# ------------------------------------------------------------------------------
# Layer 05: Standalone Sleek White Wired Earbuds (Left + Right Earpieces)
# ------------------------------------------------------------------------------
def build_earbuds_layer(
    ear_l: Tuple[float, float],
    ear_r: Tuple[float, float],
    scale: float = 1.0,
) -> Tuple[str, Tuple[float, float], Tuple[float, float]]:
    """
    Renders the left and right white wired earbud capsules + stems at `ear_l` and `ear_r`,
    and returns `(svg_str, stem_tip_l, stem_tip_r)` where the cord attaches.
    """
    lx, ly = ear_l
    rx, ry = ear_r
    stem_l = (round(lx + 6.0 * scale, 1), round(ly + 42.0 * scale, 1))
    stem_r = (round(rx - 6.0 * scale, 1), round(ry + 42.0 * scale, 1))

    svg = f"""
  <g id="layer_05_earbuds">
    <!-- Left Earbud Capsule & Stem -->
    <g transform="translate({lx},{ly}) scale({scale})">
      <circle cx="0" cy="0" r="13" fill="#ffffff" stroke="#0f172a" stroke-width="3"/>
      <path d="M -5 6 L 6 42" stroke="#ffffff" stroke-width="10" stroke-linecap="round"/>
    </g>
    <!-- Right Earbud Capsule & Stem -->
    <g transform="translate({rx},{ry}) scale({scale})">
      <circle cx="0" cy="0" r="13" fill="#ffffff" stroke="#0f172a" stroke-width="3"/>
      <path d="M 5 6 L -6 42" stroke="#ffffff" stroke-width="10" stroke-linecap="round"/>
    </g>
  </g>
"""
    return svg, stem_l, stem_r


# ------------------------------------------------------------------------------
# Layer 06: Standalone Parametric Bezier White Earbud Cord (Tunable Sway!)
# ------------------------------------------------------------------------------
def build_earbud_cord_layer(
    stem_l: Tuple[float, float],
    stem_r: Tuple[float, float],
    jack_xy: Tuple[float, float],
    sway: float = 0.0,
    slack: float = 0.0,
) -> str:
    """
    Connects `stem_l` and `stem_r` (with inline remote/mic capsule on the left cord)
    to a Y-splitter junction, then loops down with tunable `sway` (-1.0..+1.0) and
    `slack` (-1.0..+1.0) into `jack_xy` on the classic MP3 player in the right hand.
    """
    lx, ly = stem_l
    rx, ry = stem_r
    jx, jy = jack_xy

    sway_px = sway * 85.0
    slack_px = slack * 65.0

    # Y-split junction sits below the chin and shifts with sway
    split_x = round((lx + rx) * 0.5 - 24.0 + sway_px * 0.55, 1)
    split_y = round(max(ly, ry) + 145.0 + slack_px * 0.45, 1)

    # Inline mic midpoint along the left earbud branch
    mic_x = round(lx * 0.55 + split_x * 0.45 - 12.0 + sway_px * 0.2, 1)
    mic_y = round(ly * 0.55 + split_y * 0.45 + 18.0, 1)

    # Lower loop control point between Y-splitter and the MP3 player headphone jack
    loop_cx1 = round(split_x - 35.0 + sway_px, 1)
    loop_cy1 = round(split_y + 115.0 + slack_px, 1)
    loop_cx2 = round(jx + 45.0 + sway_px * 0.7, 1)
    loop_cy2 = round(jy - 95.0 + slack_px * 0.6, 1)

    return f"""
  <g id="layer_06_earbud_cord">
    <!-- Left Earbud Branch -> Y-Splitter -->
    <path d="M {lx} {ly} Q {mic_x} {mic_y} {split_x} {split_y}"
          fill="none" stroke="#ffffff" stroke-width="7.5" stroke-linecap="round"/>
    <!-- Inline Remote / Mic Capsule -->
    <rect x="{mic_x - 7}" y="{mic_y - 18}" width="14" height="36" rx="7"
          transform="rotate(-18 {mic_x} {mic_y})"
          fill="#ffffff" stroke="#0f172a" stroke-width="2.5"/>
    <!-- Right Earbud Branch -> Y-Splitter -->
    <path d="M {rx} {ry} C {rx - 12} {ry + 85}, {split_x + 48} {split_y - 38}, {split_x} {split_y}"
          fill="none" stroke="#ffffff" stroke-width="7.5" stroke-linecap="round"/>
    <!-- Y-Splitter Bead -->
    <rect x="{split_x - 6}" y="{split_y - 8}" width="12" height="18" rx="5" fill="#e2e8f0" stroke="#0f172a" stroke-width="2"/>
    <!-- Main Cord from Y-Splitter -> MP3 Player Jack in Right Hand -->
    <path d="M {split_x} {split_y} C {loop_cx1} {loop_cy1}, {loop_cx2} {loop_cy2}, {jx} {jy}"
          fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/>
  </g>
"""


def generate_all_layers_and_composites(sway: float = 0.0, slack: float = 0.0) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest: Dict[str, dict] = {}

    # 1. Layer 01: Lightning Bolt
    l1_inner = layer_01_lightning_bolt_inner()
    l1_svg = wrap_svg(l1_inner, bg_color=None)
    (OUT_DIR / "layer_01_lightning_bolt.svg").write_text(l1_svg, encoding="utf-8")
    render_svg_to_png(l1_svg, OUT_DIR / "layer_01_lightning_bolt.png")
    manifest["layer_01_lightning_bolt"] = {"svg": "layer_01_lightning_bolt.svg", "png": "layer_01_lightning_bolt.png"}

    # 2. Layer 02: Disembodied IMP Head/Bust (without earbuds baked in)
    l2_inner, l2_anchors = layer_02_imp_head_disembodied_inner()
    l2_svg = wrap_svg(l2_inner, bg_color=None)
    (OUT_DIR / "layer_02_imp_head_disembodied.svg").write_text(l2_svg, encoding="utf-8")
    render_svg_to_png(l2_svg, OUT_DIR / "layer_02_imp_head_disembodied.png")
    manifest["layer_02_imp_head_disembodied"] = {
        "svg": "layer_02_imp_head_disembodied.svg",
        "png": "layer_02_imp_head_disembodied.png",
        "anchors": l2_anchors,
    }

    # 3. Layer 03a/b/c: Full-Body Posture Variations (without earbuds or MP3 player baked in)
    poses = [
        ("layer_03a_imp_body_pose_1_balanced", "pose_1_balanced", "composite_pose_1_balanced_1024"),
        ("layer_03b_imp_body_pose_2_chin_up_chest_out", "pose_2_chin_up_chest_out", "composite_pose_2_chin_up_chest_out_1024"),
        ("layer_03c_imp_body_pose_3_groove_stride", "pose_3_groove_stride", "composite_pose_3_groove_stride_1024"),
    ]

    for layer_name, pose_id, comp_name in poses:
        body_inner, anchors = build_fullbody_pose(pose_id)
        body_svg = wrap_svg(body_inner, bg_color=None)
        (OUT_DIR / f"{layer_name}.svg").write_text(body_svg, encoding="utf-8")
        render_svg_to_png(body_svg, OUT_DIR / f"{layer_name}.png")
        manifest[layer_name] = {
            "svg": f"{layer_name}.svg",
            "png": f"{layer_name}.png",
            "anchors": anchors,
        }

        # Compose full scene: Bolt + Body Pose + Standalone MP3 Player in Right Hand + Standalone Earbuds + Swaying Cord
        hx, hy = anchors["right_hand_mp3"]
        mp3_inner, jack_xy = build_classic_mp3_player_layer(cx=hx - 18.0, cy=hy - 12.0, scale=0.88, tilt_deg=-14.0)
        eb_inner, stem_l, stem_r = build_earbuds_layer(anchors["ear_l"], anchors["ear_r"], scale=1.0)
        cord_inner = build_earbud_cord_layer(stem_l, stem_r, jack_xy, sway=sway, slack=slack)

        comp_svg = wrap_svg(
            l1_inner + body_inner + mp3_inner + eb_inner + cord_inner,
            bg_color="#05070b",
        )
        (OUT_DIR / f"{comp_name}.svg").write_text(comp_svg, encoding="utf-8")
        render_svg_to_png(comp_svg, OUT_DIR / f"{comp_name}.png")

    # 4. Standalone Layer 04 (Classic MP3 Player centered at high scale + at Pose 2 hand coords)
    mp3_standalone_inner, _ = build_classic_mp3_player_layer(cx=512.0, cy=512.0, scale=2.4, tilt_deg=-8.0)
    mp3_standalone_svg = wrap_svg(mp3_standalone_inner, bg_color=None)
    (OUT_DIR / "layer_04_classic_music_player.svg").write_text(mp3_standalone_svg, encoding="utf-8")
    render_svg_to_png(mp3_standalone_svg, OUT_DIR / "layer_04_classic_music_player.png")

    # 5. Standalone Layer 05 (Earbuds) & Layer 06 (Cord) aligned to Pose 2
    p2_anchors = manifest["layer_03b_imp_body_pose_2_chin_up_chest_out"]["anchors"]
    _, p2_jack = build_classic_mp3_player_layer(
        cx=p2_anchors["right_hand_mp3"][0] - 18.0,
        cy=p2_anchors["right_hand_mp3"][1] - 12.0,
        scale=0.88,
        tilt_deg=-14.0,
    )
    eb_p2_inner, p2_stem_l, p2_stem_r = build_earbuds_layer(p2_anchors["ear_l"], p2_anchors["ear_r"], scale=1.0)
    eb_p2_svg = wrap_svg(eb_p2_inner, bg_color=None)
    (OUT_DIR / "layer_05_earbuds.svg").write_text(eb_p2_svg, encoding="utf-8")
    render_svg_to_png(eb_p2_svg, OUT_DIR / "layer_05_earbuds.png")

    cord_p2_inner = build_earbud_cord_layer(p2_stem_l, p2_stem_r, p2_jack, sway=sway, slack=slack)
    cord_p2_svg = wrap_svg(cord_p2_inner, bg_color=None)
    (OUT_DIR / "layer_06_earbud_cord.svg").write_text(cord_p2_svg, encoding="utf-8")
    render_svg_to_png(cord_p2_svg, OUT_DIR / "layer_06_earbud_cord.png")

    # 6. Composite Head/Bust Badge (Bolt + Disembodied Head + Earbuds + Cord to bottom-right mini MP3 player)
    head_eb_inner, h_stem_l, h_stem_r = build_earbuds_layer(l2_anchors["ear_l"], l2_anchors["ear_r"], scale=1.35)
    head_mp3_inner, h_jack = build_classic_mp3_player_layer(cx=770.0, cy=815.0, scale=0.95, tilt_deg=-10.0)
    head_cord_inner = build_earbud_cord_layer(h_stem_l, h_stem_r, h_jack, sway=0.25, slack=0.1)
    head_comp_svg = wrap_svg(l1_inner + l2_inner + head_mp3_inner + head_eb_inner + head_cord_inner, bg_color="#05070b")
    (OUT_DIR / "composite_head_badge_1024.svg").write_text(head_comp_svg, encoding="utf-8")
    render_svg_to_png(head_comp_svg, OUT_DIR / "composite_head_badge_1024.png")

    (OUT_DIR / "layer_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Generated 8 isolated SVG+PNG layers and 4 composites in {OUT_DIR}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compose modular IMP mascot & hardware layers")
    parser.add_argument("--cord-sway", type=float, default=0.0, help="Horizontal cord sway (-1.0 to +1.0)")
    parser.add_argument("--cord-slack", type=float, default=0.0, help="Vertical cord slack (-1.0 to +1.0)")
    args = parser.parse_args()
    generate_all_layers_and_composites(sway=args.cord_sway, slack=args.cord_slack)
