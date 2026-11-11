//! SIMP "Smol Engine" — Dual-Target Rust + `wasm32-unknown-unknown` 640x360 Software Framebuffer
//!
//! Zero-dependency, zero-per-frame-allocation 16-bit / demoscene software renderer powering
//! the Wave 3 Moodboard visualizers (`a` through `h`) and hardware-inspired transition wipes.

use std::sync::Mutex;

pub const CANVAS_W: usize = 640;
pub const CANVAS_H: usize = 360;
pub const FRAME_PIXELS: usize = CANVAS_W * CANVAS_H;

pub const ART_SIZE: usize = 128;
pub const ART_PIXELS: usize = ART_SIZE * ART_SIZE;

struct EngineState {
    frame: [u32; FRAME_PIXELS],
    art: [u32; ART_PIXELS],
    has_art: bool,
    art_palette: [u32; 4],
    bands: [u8; 16],
    solitaire_trail_x: f32,
    solitaire_trail_y: f32,
    solitaire_vx: f32,
    solitaire_vy: f32,
}

static STATE: Mutex<EngineState> = Mutex::new(EngineState {
    frame: [0; FRAME_PIXELS],
    art: [0; ART_PIXELS],
    has_art: false,
    art_palette: [0; 4],
    bands: [0; 16],
    solitaire_trail_x: 0.0,
    solitaire_trail_y: 0.0,
    solitaire_vx: 0.0,
    solitaire_vy: 0.0,
});

#[inline(always)]
pub const fn rgba(r: u8, g: u8, b: u8, a: u8) -> u32 {
    ((a as u32) << 24) | ((b as u32) << 16) | ((g as u32) << 8) | (r as u32)
}

#[inline(always)]
pub const fn rgb(r: u8, g: u8, b: u8) -> u32 {
    rgba(r, g, b, 255)
}

#[inline(always)]
fn unpack_rgb(c: u32) -> (u8, u8, u8) {
    (
        (c & 0xFF) as u8,
        ((c >> 8) & 0xFF) as u8,
        ((c >> 16) & 0xFF) as u8,
    )
}

#[inline(always)]
fn lerp_color(c0: u32, c1: u32, t: f32) -> u32 {
    let t = t.clamp(0.0, 1.0);
    let (r0, g0, b0) = unpack_rgb(c0);
    let (r1, g1, b1) = unpack_rgb(c1);
    let r = (r0 as f32 + (r1 as f32 - r0 as f32) * t) as u8;
    let g = (g0 as f32 + (g1 as f32 - g0 as f32) * t) as u8;
    let b = (b0 as f32 + (b1 as f32 - b0 as f32) * t) as u8;
    rgb(r, g, b)
}

#[inline(always)]
fn put_px(frame: &mut [u32; FRAME_PIXELS], x: i32, y: i32, color: u32) {
    if x >= 0 && x < CANVAS_W as i32 && y >= 0 && y < CANVAS_H as i32 {
        frame[(y as usize) * CANVAS_W + (x as usize)] = color;
    }
}

fn fill_rect(frame: &mut [u32; FRAME_PIXELS], x0: i32, y0: i32, w: i32, h: i32, color: u32) {
    let sx = x0.clamp(0, CANVAS_W as i32);
    let ex = (x0 + w).clamp(0, CANVAS_W as i32);
    let sy = y0.clamp(0, CANVAS_H as i32);
    let ey = (y0 + h).clamp(0, CANVAS_H as i32);
    if sx >= ex || sy >= ey {
        return;
    }
    for y in sy..ey {
        let row = (y as usize) * CANVAS_W;
        frame[row + (sx as usize)..row + (ex as usize)].fill(color);
    }
}

fn fill_rect_blend(
    frame: &mut [u32; FRAME_PIXELS],
    x0: i32,
    y0: i32,
    w: i32,
    h: i32,
    color: u32,
    alpha: f32,
) {
    let sx = x0.clamp(0, CANVAS_W as i32);
    let ex = (x0 + w).clamp(0, CANVAS_W as i32);
    let sy = y0.clamp(0, CANVAS_H as i32);
    let ey = (y0 + h).clamp(0, CANVAS_H as i32);
    for y in sy..ey {
        let row = (y as usize) * CANVAS_W;
        for x in sx..ex {
            let idx = row + (x as usize);
            frame[idx] = lerp_color(frame[idx], color, alpha);
        }
    }
}

fn fill_circle(frame: &mut [u32; FRAME_PIXELS], cx: i32, cy: i32, r: i32, color: u32) {
    if r <= 0 {
        return;
    }
    let r2 = r * r;
    let sy = (cy - r).max(0);
    let ey = (cy + r).min(CANVAS_H as i32 - 1);
    let sx = (cx - r).max(0);
    let ex = (cx + r).min(CANVAS_W as i32 - 1);
    for y in sy..=ey {
        let dy = y - cy;
        let dy2 = dy * dy;
        let row = (y as usize) * CANVAS_W;
        for x in sx..=ex {
            let dx = x - cx;
            if dx * dx + dy2 <= r2 {
                frame[row + (x as usize)] = color;
            }
        }
    }
}

fn draw_circle_ring(
    frame: &mut [u32; FRAME_PIXELS],
    cx: i32,
    cy: i32,
    r: i32,
    thickness: i32,
    color: u32,
) {
    if r <= 0 {
        return;
    }
    let r_outer2 = r * r;
    let r_inner = (r - thickness.max(1)).max(0);
    let r_inner2 = r_inner * r_inner;
    let sy = (cy - r).max(0);
    let ey = (cy + r).min(CANVAS_H as i32 - 1);
    let sx = (cx - r).max(0);
    let ex = (cx + r).min(CANVAS_W as i32 - 1);
    for y in sy..=ey {
        let dy = y - cy;
        let dy2 = dy * dy;
        let row = (y as usize) * CANVAS_W;
        for x in sx..=ex {
            let dx = x - cx;
            let d2 = dx * dx + dy2;
            if d2 <= r_outer2 && d2 >= r_inner2 {
                frame[row + (x as usize)] = color;
            }
        }
    }
}

fn draw_line(
    frame: &mut [u32; FRAME_PIXELS],
    mut x0: i32,
    mut y0: i32,
    x1: i32,
    y1: i32,
    thickness: i32,
    color: u32,
) {
    let dx = (x1 - x0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let dy = -(y1 - y0).abs();
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx + dy;
    let half = (thickness - 1).max(0) / 2;
    let mut steps = 0;
    loop {
        if half == 0 {
            put_px(frame, x0, y0, color);
        } else {
            for oy in -half..=half {
                for ox in -half..=half {
                    put_px(frame, x0 + ox, y0 + oy, color);
                }
            }
        }
        if x0 == x1 && y0 == y1 || steps > 1024 {
            break;
        }
        steps += 1;
        let e2 = 2 * err;
        if e2 >= dy {
            err += dy;
            x0 += sx;
        }
        if e2 <= dx {
            err += dx;
            y0 += sy;
        }
    }
}

/// Embedded 5x7 uppercase bitmap font for crisp 16-bit WarioWare/Arcade/DDR/Solitaire overlays.
fn glyph_5x7(ch: char) -> [u8; 7] {
    match ch.to_ascii_uppercase() {
        'A' => [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
        'B' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
        'C' => [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
        'D' => [0b11100, 0b10010, 0b10001, 0b10001, 0b10001, 0b10010, 0b11100],
        'E' => [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
        'F' => [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
        'G' => [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
        'H' => [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
        'I' => [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
        'J' => [0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100],
        'K' => [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
        'L' => [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
        'M' => [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
        'N' => [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
        'O' | '0' => [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
        'P' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
        'Q' => [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
        'R' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
        'S' | '5' => [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
        'T' => [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
        'U' => [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
        'V' => [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
        'W' => [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
        'X' => [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
        'Y' => [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
        'Z' => [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
        '1' => [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
        '2' => [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
        '3' => [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
        '4' => [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
        '6' => [0b01110, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
        '7' => [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
        '8' => [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
        '9' => [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
        '!' => [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100],
        '-' => [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
        ':' => [0b00000, 0b00100, 0b00100, 0b00000, 0b00100, 0b00100, 0b00000],
        _ => [0; 7],
    }
}

fn draw_text_5x7(
    frame: &mut [u32; FRAME_PIXELS],
    text: &str,
    x0: i32,
    y0: i32,
    scale: i32,
    color: u32,
) {
    let s = scale.max(1);
    let mut cx = x0;
    for ch in text.chars() {
        let rows = glyph_5x7(ch);
        for (ry, bits) in rows.iter().enumerate() {
            for rx in 0..5 {
                if (bits >> (4 - rx)) & 1 == 1 {
                    fill_rect(frame, cx + rx * s, y0 + (ry as i32) * s, s, s, color);
                }
            }
        }
        cx += 6 * s;
    }
}

// ============================================================================
// SCENE 0 (a): RHYTHM STAGE & MICRO-PARTY (DDR, Miku Lasers, Mode-7 Miis, WarioWare)
// ============================================================================
fn render_scene_rhythm(
    state: &mut EngineState,
    time_sec: f32,
    rms: f32,
    peak: f32,
    onset: f32,
    bpm: f32,
) {
    let frame = &mut state.frame;
    let horizon_y: i32 = 168;

    // 1. Concert Backdrop Sky & Stage Truss
    for y in 0..horizon_y {
        let t = y as f32 / horizon_y as f32;
        let c = lerp_color(rgb(8, 6, 22), rgb(28, 12, 54), t);
        let row = (y as usize) * CANVAS_W;
        frame[row..row + CANVAS_W].fill(c);
    }

    // 2. Hatsune Miku Sweeping Laser Cones (Cyan #00F5D4, Magenta #FF2A85, Violet #9B5DE5)
    let laser_colors = [
        rgb(0, 245, 212),
        rgb(255, 42, 133),
        rgb(56, 189, 248),
        rgb(155, 93, 229),
        rgb(0, 245, 212),
    ];
    for (i, &lcol) in laser_colors.iter().enumerate() {
        let emitters_x = 90 + (i as i32) * 115;
        let sweep = (time_sec * (1.5 + i as f32 * 0.25) + i as f32 * 1.3).sin();
        let target_x = emitters_x + (sweep * 145.0) as i32;
        let band_v = state.bands[(i * 3) & 15] as f32 / 255.0;
        let half_w = 12 + (band_v * 26.0) as i32;
        for y in 16..horizon_y {
            let py = (y - 16) as f32 / (horizon_y - 16) as f32;
            let cx = emitters_x as f32 + (target_x as f32 - emitters_x as f32) * py;
            let w = (2.0 + half_w as f32 * py) as i32;
            let sx = (cx as i32 - w).clamp(0, CANVAS_W as i32);
            let ex = (cx as i32 + w).clamp(0, CANVAS_W as i32);
            let row = (y as usize) * CANVAS_W;
            let alpha = (0.14 + band_v * 0.22) * (1.0 - py * 0.35);
            for x in sx..ex {
                frame[row + x as usize] = lerp_color(frame[row + x as usize], lcol, alpha);
            }
        }
    }

    // 3. Mode-7 Affine Perspective Dancefloor Checkerboard
    let beat_phase = time_sec * (bpm.max(90.0) / 60.0);
    let forward_scroll = time_sec * 3.8;
    for y in horizon_y..(CANVAS_H as i32) {
        let dy = (y - horizon_y + 1) as f32;
        let inv_z = 92.0 / dy;
        let row = (y as usize) * CANVAS_W;
        let fog = (dy / (CANVAS_H as f32 - horizon_y as f32)).clamp(0.0, 1.0);
        for x in 0..(CANVAS_W as i32) {
            let dx = (x - (CANVAS_W as i32 / 2)) as f32;
            let u = dx * inv_z * 0.045 + (time_sec * 0.35).sin() * 0.8;
            let v = inv_z * 1.4 + forward_scroll;
            let iu = u.floor() as i32;
            let iv = v.floor() as i32;
            let tile_idx = ((iu + iv) & 3).unsigned_abs() as usize;
            let band_energy = state.bands[((iu.unsigned_abs() as usize) * 3 + (iv.unsigned_abs() as usize)) & 15] as f32 / 255.0;
            let base = if (iu ^ iv) & 1 == 0 {
                let tile_col = match tile_idx {
                    0 => rgb(0, 225, 198),
                    1 => rgb(255, 48, 138),
                    2 => rgb(250, 204, 21),
                    _ => rgb(139, 92, 246),
                };
                lerp_color(rgb(18, 16, 40), tile_col, (0.28 + band_energy * 0.58) * fog)
            } else {
                rgb(10, 9, 24)
            };
            frame[row + x as usize] = base;
        }
    }

    // 4. Crowd of Jumping / Dancing Pixel Miis with Glowsticks on the Mode-7 Floor
    let mii_shirts = [
        rgb(255, 75, 110),
        rgb(0, 240, 200),
        rgb(250, 204, 21),
        rgb(56, 189, 248),
        rgb(168, 85, 247),
        rgb(52, 211, 153),
        rgb(251, 146, 60),
    ];
    for m in 0..9i32 {
        let depth_row = if m % 2 == 0 { 0 } else { 1 };
        let base_y = if depth_row == 0 { 248 } else { 292 };
        let scale = if depth_row == 0 { 2 } else { 3 };
        let base_x = 76 + m * 60 + ((time_sec * 2.0 + m as f32).sin() * 6.0) as i32;
        let band_amp = state.bands[((m as usize) * 2) & 15] as f32 / 255.0;
        let jump_h = ((beat_phase * std::f32::consts::PI + m as f32 * 0.7).sin().abs()
            * (10.0 + band_amp * 22.0 + onset * 14.0)) as i32;
        let my = base_y - jump_h;
        let shirt = mii_shirts[(m as usize) % mii_shirts.len()];

        // Shadow on floor
        fill_rect_blend(frame, base_x - 5 * scale, base_y + 8 * scale, 10 * scale, 2 * scale, rgb(0, 0, 0), 0.55);
        // Legs
        fill_rect(frame, base_x - 3 * scale, my + 3 * scale, 2 * scale, 5 * scale, rgb(30, 41, 59));
        fill_rect(frame, base_x + 1 * scale, my + 3 * scale, 2 * scale, 5 * scale, rgb(30, 41, 59));
        // Torso
        fill_rect(frame, base_x - 4 * scale, my - 3 * scale, 8 * scale, 6 * scale, shirt);
        // Head & Hair
        fill_circle(frame, base_x, my - 6 * scale, 3 * scale, rgb(253, 224, 195));
        fill_rect(frame, base_x - 3 * scale, my - 9 * scale, 6 * scale, 2 * scale, rgb(35, 25, 20));
        // Waving Glowsticks
        let arm_wave = ((beat_phase * 3.14159 + m as f32).sin() * 4.0) as i32;
        draw_line(
            frame,
            base_x - 4 * scale,
            my - 2 * scale,
            base_x - 8 * scale,
            my - (6 + arm_wave) * scale,
            scale,
            rgb(0, 255, 220),
        );
        draw_line(
            frame,
            base_x + 4 * scale,
            my - 2 * scale,
            base_x + 8 * scale,
            my - (6 - arm_wave) * scale,
            scale,
            rgb(255, 50, 160),
        );
    }

    // 5. DDR Rhythm Arrow Lane (Right-Side Arcade Column)
    let lane_x0 = 492;
    fill_rect_blend(frame, lane_x0 - 10, 18, 136, 324, rgb(6, 8, 18), 0.76);
    let arrow_cols = [
        rgb(56, 189, 248),
        rgb(250, 204, 21),
        rgb(52, 211, 153),
        rgb(251, 113, 133),
    ];
    // Receptor row at y = 44
    for a in 0..4 {
        let ax = lane_x0 + (a as i32) * 32;
        let pulse = if onset > 0.35 && ((beat_phase as i32 + a as i32) & 1 == 0) {
            4
        } else {
            0
        };
        draw_circle_ring(frame, ax + 10, 44, 10 + pulse, 2, arrow_cols[a]);
    }
    // Scrolling DDR note arrows rising toward y = 44
    for n in 0..7 {
        let col = (n * 3 + (beat_phase as usize / 4)) & 3;
        let ax = lane_x0 + (col as i32) * 32;
        let raw_y = 330.0 - ((time_sec * 145.0 + (n as f32) * 46.0) % 286.0);
        let ny = raw_y as i32;
        fill_circle(frame, ax + 10, ny, 9, arrow_cols[col]);
        fill_circle(frame, ax + 10, ny, 4, rgb(255, 255, 255));
    }

    // 6. WarioWare Micro-Prompt Flash on Beat Peaks
    if onset > 0.28 || peak > 0.55 || ((beat_phase as i32) % 8 == 0) {
        let prompts = ["JUMP!", "DANCE!", "VIBE!", "HYYPE!", "POSE!"];
        let p_idx = ((beat_phase as usize) / 4) % prompts.len();
        let prompt = prompts[p_idx];
        let bx = 36;
        let by = 34;
        fill_rect(frame, bx - 4, by - 4, 138, 34, rgb(250, 204, 21));
        fill_rect(frame, bx, by, 130, 26, rgb(18, 12, 34));
        draw_text_5x7(frame, prompt, bx + 12, by + 6, 2, rgb(0, 245, 212));
    }
    let _ = rms;
}

// ============================================================================
// SCENE 1 (b): MIDNIGHT MOUNTAIN PARALLAX (Moon, Lightning, Forest, Lake, Sleet)
// ============================================================================
fn render_scene_midnight(
    state: &mut EngineState,
    time_sec: f32,
    rms: f32,
    _peak: f32,
    onset: f32,
) {
    let frame = &mut state.frame;
    let lake_y: i32 = 246;
    let bass = (state.bands[0] as f32 + state.bands[1] as f32) / 510.0;
    let lightning = if onset > 0.42 || bass > 0.72 {
        ((onset + bass) * 0.65).clamp(0.0, 0.85)
    } else {
        0.0
    };

    // 1. Night Sky Gradient (flashes icy violet-white during sheet lightning)
    for y in 0..lake_y {
        let t = y as f32 / lake_y as f32;
        let sky_top = lerp_color(rgb(5, 8, 22), rgb(140, 165, 220), lightning * 0.7);
        let sky_bot = lerp_color(rgb(18, 28, 58), rgb(200, 220, 255), lightning);
        let c = lerp_color(sky_top, sky_bot, t);
        let row = (y as usize) * CANVAS_W;
        frame[row..row + CANVAS_W].fill(c);
    }

    // 2. Glowing Full Moon + Halo
    let moon_x = 490;
    let moon_y = 66;
    fill_circle(frame, moon_x, moon_y, 38, lerp_color(rgb(28, 42, 82), rgb(180, 210, 255), 0.35));
    fill_circle(frame, moon_x, moon_y, 26, rgb(242, 246, 255));
    fill_circle(frame, moon_x - 7, moon_y - 5, 5, rgb(212, 222, 242));

    // 3. Sheet Lightning Bolt Branching on Bass/Onset Hits
    if lightning > 0.15 {
        let mut lx = 180 + ((time_sec * 97.0) as i32 % 240);
        let mut ly = 0;
        for seg in 0..9 {
            let nx = lx + (((seg * 37 + (time_sec * 60.0) as i32) % 31) - 15);
            let ny = ly + 22;
            draw_line(frame, lx, ly, nx, ny, 2, rgb(235, 245, 255));
            lx = nx;
            ly = ny;
        }
    }

    // 4. Distant Jagged Mountain Silhouettes (Parallax Layer 1)
    let scroll_mtn = (time_sec * 12.0) as i32;
    for x in 0..(CANVAS_W as i32) {
        let wx = x + scroll_mtn;
        let h1 = (((wx as f32 * 0.012).sin() * 42.0)
            + ((wx as f32 * 0.031).cos() * 24.0)
            + ((wx as f32 * 0.07).sin() * 9.0)) as i32;
        let peak_y = (142 - h1).clamp(48, lake_y);
        let mtn_col = lerp_color(rgb(14, 20, 42), rgb(64, 82, 130), lightning * 0.5);
        for y in peak_y..lake_y {
            put_px(frame, x, y, mtn_col);
        }
    }

    // 5. Two Parallax Pine Forest Layers (Layer 2 Mid & Layer 3 Near)
    for layer in 0..2 {
        let speed = if layer == 0 { 32.0 } else { 68.0 };
        let tree_col = if layer == 0 {
            rgb(9, 16, 32)
        } else {
            rgb(4, 9, 18)
        };
        let spacing = if layer == 0 { 26 } else { 36 };
        let base_h = if layer == 0 { 48 } else { 74 };
        let offset = (time_sec * speed) as i32;
        for tx_idx in -2..(CANVAS_W as i32 / spacing + 3) {
            let world_idx = tx_idx + (offset / spacing);
            let tx = tx_idx * spacing - (offset % spacing);
            let jitter = ((world_idx * 17) & 15) - 7;
            let th = base_h + jitter;
            let top_y = lake_y - th;
            for ty in top_y..lake_y {
                let prog = (ty - top_y) as f32 / (th.max(1) as f32);
                let branch_tier = ((prog * 4.0).fract() * 0.65 + prog * 0.55) * (spacing as f32 * 0.55);
                let hw = branch_tier as i32;
                for x in (tx - hw)..=(tx + hw) {
                    put_px(frame, x, ty, tree_col);
                }
            }
        }
    }

    // 6. Shimmering Midnight Lake Scanline Reflection (y = 246..360)
    for y in lake_y..(CANVAS_H as i32) {
        let dy = y - lake_y;
        let mirror_y = (lake_y - 1 - dy * 2).clamp(0, lake_y - 1);
        let ripple = ((y as f32 * 0.35 + time_sec * 9.0).sin() * (2.5 + rms * 8.0)) as i32;
        let dst_row = (y as usize) * CANVAS_W;
        let src_row = (mirror_y as usize) * CANVAS_W;
        for x in 0..(CANVAS_W as i32) {
            let sx = (x + ripple).clamp(0, CANVAS_W as i32 - 1) as usize;
            let reflected = frame[src_row + sx];
            let lake_tint = lerp_color(reflected, rgb(8, 24, 48), 0.48);
            frame[dst_row + x as usize] = lake_tint;
        }
        // Shimmering moonlight water ripples
        if dy % 3 == 0 {
            let glint_w = (28.0 - (dy as f32 * 0.18)).max(4.0) as i32;
            let gx = moon_x + (((dy as f32 * 0.5 + time_sec * 6.0).sin()) * 14.0) as i32;
            fill_rect_blend(frame, gx - glint_w, y, glint_w * 2, 1, rgb(220, 238, 255), 0.55);
        }
    }

    // 7. Wind-Driven Sleet Particles
    for p in 0..85u32 {
        let seed = p.wrapping_mul(1103515245).wrapping_add(12345);
        let px = ((seed % 640) as f32 - time_sec * (240.0 + (p % 5) as f32 * 25.0)).rem_euclid(640.0) as i32;
        let py = (((seed >> 8) % 360) as f32 + time_sec * (190.0 + (p % 4) as f32 * 20.0)).rem_euclid(360.0) as i32;
        draw_line(frame, px, py, px - 6, py + 5, 1, rgb(186, 214, 245));
    }
}

// ============================================================================
// SCENE 2 (c): COSMIC WARP & 50s FLYING SAUCER ON A STRING
// ============================================================================
fn render_scene_cosmos(
    state: &mut EngineState,
    time_sec: f32,
    rms: f32,
    peak: f32,
    onset: f32,
) {
    let frame = &mut state.frame;
    let cx = (CANVAS_W / 2) as i32;
    let cy = (CANVAS_H / 2) as i32;

    // 1. Deep Cosmos & Swirling Nebula Plasma Field
    for y in (0..CANVAS_H).step_by(2) {
        let fy = (y as f32 - cy as f32) * 0.012;
        for x in (0..CANVAS_W).step_by(2) {
            let fx = (x as f32 - cx as f32) * 0.012;
            let r2 = fx * fx + fy * fy;
            let swirl = (fx * 2.2 + time_sec * 0.7).sin() + (fy * 2.2 - time_sec * 0.5).cos();
            let neb = ((swirl + (r2 * 1.8 - time_sec).sin()) * 0.25 + 0.5).clamp(0.0, 1.0);
            let c = lerp_color(
                rgb(4, 3, 14),
                lerp_color(rgb(48, 16, 88), rgb(14, 116, 144), neb),
                neb * (0.45 + rms * 0.35),
            );
            let row0 = y * CANVAS_W + x;
            let row1 = (y + 1) * CANVAS_W + x;
            frame[row0] = c;
            frame[row0 + 1] = c;
            frame[row1] = c;
            frame[row1 + 1] = c;
        }
    }

    // 2. Black Hole Event Horizon & Accretion Ring
    let bh_x = 185;
    let bh_y = 148;
    let bh_r = 28 + (rms * 14.0) as i32;
    draw_circle_ring(frame, bh_x, bh_y, bh_r + 14, 5, rgb(251, 146, 60));
    draw_circle_ring(frame, bh_x, bh_y, bh_r + 7, 4, rgb(250, 204, 21));
    fill_circle(frame, bh_x, bh_y, bh_r, rgb(0, 0, 0));

    // God Particle / Big Bang Radial Shockwave on Onset
    let bang_r = ((time_sec * 160.0) % 260.0) as i32;
    if onset > 0.25 || peak > 0.45 {
        draw_circle_ring(frame, bh_x, bh_y, bang_r, 2, rgb(103, 232, 249));
    }

    // 3. Warp-Speed Radial Starfield Streaks
    for s in 0..110 {
        let angle = (s as f32) * 2.39996 + (s as f32 * 0.13);
        let speed = 90.0 + (s % 7) as f32 * 32.0 + rms * 140.0;
        let dist = ((time_sec * speed + (s * 29) as f32) % 340.0).max(8.0);
        let sx0 = cx + (angle.cos() * dist) as i32;
        let sy0 = cy + (angle.sin() * dist * 0.65) as i32;
        let streak = 1.0 + (dist / 95.0) * (1.0 + rms * 1.8);
        let sx1 = cx + (angle.cos() * (dist + streak * 6.0)) as i32;
        let sy1 = cy + (angle.sin() * (dist + streak * 6.0) * 0.65) as i32;
        draw_line(frame, sx0, sy0, sx1, sy1, 1, rgb(226, 232, 240));
    }

    // 4. 1950s B-Movie Tin Flying Saucer Visibly Attached to a Wobbling String!
    let anchor_x = 425 + ((time_sec * 0.85).sin() * 70.0) as i32;
    let swing = (time_sec * 2.6).sin() * 28.0;
    let bob = (time_sec * 5.2).cos() * 14.0 - onset * 16.0;
    let ufo_x = anchor_x + swing as i32;
    let ufo_y = (162.0 + bob) as i32;

    // Visible taut white string from top frame edge (y=0) to top eyelet of saucer!
    draw_line(frame, anchor_x, 0, ufo_x, ufo_y - 26, 2, rgb(235, 235, 225));
    // Little metal eyelet loop where the string is tied
    draw_circle_ring(frame, ufo_x, ufo_y - 24, 4, 2, rgb(180, 190, 200));

    // Tractor Beam cone beneath the saucer
    let beam_alpha = 0.16 + (state.bands[2] as f32 / 255.0) * 0.25;
    for by in (ufo_y + 14)..(CANVAS_H as i32) {
        let prog = (by - (ufo_y + 14)) as f32 / (CANVAS_H as i32 - ufo_y) as f32;
        let hw = (14.0 + prog * 68.0) as i32;
        fill_rect_blend(frame, ufo_x - hw, by, hw * 2, 1, rgb(52, 211, 153), beam_alpha * (1.0 - prog * 0.6));
    }

    // Glass dome & tin saucer hull
    fill_circle(frame, ufo_x, ufo_y - 8, 22, rgb(125, 211, 252));
    fill_rect(frame, ufo_x - 48, ufo_y - 6, 96, 12, rgb(148, 163, 184));
    fill_rect(frame, ufo_x - 62, ufo_y - 2, 124, 8, rgb(203, 213, 225));
    fill_rect(frame, ufo_x - 38, ufo_y + 6, 76, 6, rgb(100, 116, 139));
    // Blinking 50s rim lights
    for l in -3..=3 {
        let lx = ufo_x + l * 16;
        let blink = ((time_sec * 8.0) as i32 + l).rem_euclid(3) == 0;
        let lcol = if blink {
            rgb(251, 113, 133)
        } else {
            rgb(250, 204, 21)
        };
        fill_circle(frame, lx, ufo_y + 2, 3, lcol);
    }
}

// ============================================================================
// SCENE 3 (d): CORAL REEF, WATER CAUSTICS, BUBBLES, SEAHORSE, STARFISH & CRAB
// ============================================================================
fn render_scene_reef(
    state: &mut EngineState,
    time_sec: f32,
    rms: f32,
    _peak: f32,
    onset: f32,
) {
    let frame = &mut state.frame;
    let sand_y: i32 = 304;

    // 1. Underwater Depth Gradient + 2D Wave-Interference Water Caustics Shader
    for y in 0..sand_y {
        let depth = y as f32 / sand_y as f32;
        let base = lerp_color(rgb(6, 78, 112), rgb(4, 28, 58), depth);
        let row = (y as usize) * CANVAS_W;
        let wave_y = (y as f32 * 0.045 + time_sec * 1.8).sin();
        for x in 0..(CANVAS_W as i32) {
            let caustic = ((x as f32 * 0.035 + wave_y * 2.2 + time_sec * 2.1).sin()
                * (y as f32 * 0.03 - x as f32 * 0.02 + time_sec * 1.4).cos())
                .max(0.0);
            let shaft = ((x as f32 * 0.015 + y as f32 * 0.006 - time_sec * 0.6).sin()).max(0.0);
            let glow = (caustic * 0.35 + shaft * 0.22) * (1.0 - depth * 0.65);
            frame[row + x as usize] = lerp_color(base, rgb(103, 232, 249), glow);
        }
    }

    // 2. Sandy Ocean Floor with Caustic Ripples
    for y in sand_y..(CANVAS_H as i32) {
        let row = (y as usize) * CANVAS_W;
        let c = lerp_color(rgb(194, 158, 108), rgb(146, 112, 72), (y - sand_y) as f32 / 56.0);
        frame[row..row + CANVAS_W].fill(c);
    }

    // 3. Swaying Kelp & Pixel Coral Formations
    let coral_cols = [
        rgb(251, 113, 133),
        rgb(250, 204, 21),
        rgb(192, 132, 252),
        rgb(249, 115, 22),
    ];
    for c in 0..8i32 {
        let cx = 48 + c * 78;
        let col = coral_cols[(c as usize) % coral_cols.len()];
        let band = state.bands[((c as usize) * 2) & 15] as f32 / 255.0;
        let h = 42 + (c % 3) * 18 + (band * 24.0) as i32;
        for by in 0..h {
            let sway = ((time_sec * 2.4 + by as f32 * 0.08 + c as f32).sin() * 7.0) as i32;
            fill_circle(frame, cx + sway, sand_y - by, 8 - (by / 14).min(5), col);
            if by > 16 && by % 14 == 0 {
                fill_circle(frame, cx + sway - 12, sand_y - by - 6, 5, col);
                fill_circle(frame, cx + sway + 12, sand_y - by - 4, 5, col);
            }
        }
    }

    // 4. Starfish Resting on Coral/Sand
    let sf_x = 138;
    let sf_y = 324;
    for arm in 0..5 {
        let ang = (arm as f32) * 1.2566 + time_sec * 0.25;
        let ax = sf_x + (ang.cos() * 18.0) as i32;
        let ay = sf_y + (ang.sin() * 12.0) as i32;
        draw_line(frame, sf_x, sf_y, ax, ay, 5, rgb(249, 115, 22));
    }
    fill_circle(frame, sf_x, sf_y, 6, rgb(253, 186, 116));

    // 5. Drifting Pixel Seahorses
    for sh in 0..2 {
        let sx = 190 + sh * 250 + ((time_sec * 1.1 + sh as f32 * 2.0).sin() * 18.0) as i32;
        let sy = 135 + sh * 35 + ((time_sec * 2.0 + sh as f32).cos() * 16.0) as i32;
        let scol = if sh == 0 {
            rgb(250, 204, 21)
        } else {
            rgb(244, 114, 182)
        };
        // Head & Snout
        fill_circle(frame, sx, sy - 14, 7, scol);
        fill_rect(frame, sx + 5, sy - 16, 9, 4, scol);
        // S-curved Body & Curled Tail
        fill_circle(frame, sx - 3, sy - 3, 8, scol);
        fill_circle(frame, sx - 1, sy + 7, 6, scol);
        draw_circle_ring(frame, sx + 3, sy + 16, 6, 3, scol);
        // Eye
        put_px(frame, sx + 2, sy - 15, rgb(15, 23, 42));
    }

    // 6. Sidestepping Snapping Crab on the Ocean Floor!
    let crab_x = 340 + ((time_sec * 1.7).sin() * 95.0) as i32;
    let crab_y = 318 - (onset * 10.0) as i32;
    let claw_open = ((time_sec * 8.0).sin() > 0.0) || onset > 0.25;
    // Legs
    for leg in -3..=3 {
        if leg != 0 {
            let step = (((time_sec * 12.0 + leg as f32).sin()) * 3.0) as i32;
            draw_line(
                frame,
                crab_x + leg * 5,
                crab_y,
                crab_x + leg * 9,
                crab_y + 10 + step,
                2,
                rgb(220, 38, 38),
            );
        }
    }
    // Shell
    fill_rect(frame, crab_x - 16, crab_y - 8, 32, 14, rgb(239, 68, 68));
    // Stalk eyes
    fill_rect(frame, crab_x - 7, crab_y - 14, 3, 6, rgb(254, 226, 226));
    fill_rect(frame, crab_x + 5, crab_y - 14, 3, 6, rgb(254, 226, 226));
    // Big Snapping Claws
    let spread = if claw_open { 6 } else { 1 };
    fill_circle(frame, crab_x - 22, crab_y - 12 - spread, 6, rgb(239, 68, 68));
    fill_circle(frame, crab_x - 22, crab_y - 6 + spread, 5, rgb(220, 38, 38));
    fill_circle(frame, crab_x + 22, crab_y - 12 - spread, 6, rgb(239, 68, 68));
    fill_circle(frame, crab_x + 22, crab_y - 6 + spread, 5, rgb(220, 38, 38));

    // 7. Audio-Reactive Rising Bubble Streams
    for b in 0..48 {
        let bx_base = ((b * 73) % 610) + 15;
        let speed = 55.0 + (b % 6) as f32 * 18.0 + rms * 45.0;
        let by = sand_y - ((time_sec * speed + (b * 31) as f32) as i32 % (sand_y - 12));
        let bx = bx_base + ((time_sec * 3.5 + b as f32).sin() * 8.0) as i32;
        let br = 3 + (b % 5) as i32;
        draw_circle_ring(frame, bx, by, br, 1, rgb(186, 230, 253));
        put_px(frame, bx - br / 2, by - br / 2, rgb(255, 255, 255));
    }
}

// ============================================================================
// SCENE 4 (e): RETRO ARCADE REMIX (Pac-Man, Joust, Pong, DK, Space Invaders, Missile Command)
// ============================================================================
fn render_scene_arcade(
    state: &mut EngineState,
    time_sec: f32,
    rms: f32,
    _peak: f32,
    onset: f32,
) {
    let frame = &mut state.frame;
    frame.fill(rgb(6, 6, 14));

    // Arcade Score Header
    draw_text_5x7(frame, "1UP   HIGH SCORE   2UP", 170, 12, 2, rgb(251, 113, 133));
    draw_text_5x7(frame, "042800    999900", 184, 30, 2, rgb(250, 204, 21));

    // 1. SPACE INVADERS FORMATION (Top Tier y = 56..115)
    let inv_shift = ((time_sec * 2.5).sin() * 48.0) as i32;
    for row in 0..2 {
        let icol = if row == 0 {
            rgb(52, 211, 153)
        } else {
            rgb(56, 189, 248)
        };
        for col in 0..8 {
            let ix = 110 + col * 56 + inv_shift;
            let iy = 62 + row * 28;
            fill_rect(frame, ix - 8, iy - 4, 16, 8, icol);
            fill_rect(frame, ix - 12, iy, 24, 6, icol);
            let leg_alt = ((time_sec * 6.0) as i32 + col) & 1;
            fill_rect(frame, ix - 10 + leg_alt * 3, iy + 6, 4, 4, icol);
            fill_rect(frame, ix + 6 - leg_alt * 3, iy + 6, 4, 4, icol);
            put_px(frame, ix - 4, iy - 1, rgb(0, 0, 0));
            put_px(frame, ix + 4, iy - 1, rgb(0, 0, 0));
        }
    }

    // 2. DONKEY KONG RED STEEL GIRDERS + PAC-MAN & GHOSTS + JOUST (Middle Tier y = 140..235)
    // Red DK Girders
    fill_rect(frame, 60, 152, 520, 6, rgb(225, 29, 72));
    fill_rect(frame, 60, 224, 520, 6, rgb(225, 29, 72));
    for gx in (68..572).step_by(24) {
        draw_line(frame, gx, 152, gx + 10, 158, 1, rgb(251, 113, 133));
        draw_line(frame, gx, 224, gx + 10, 230, 1, rgb(251, 113, 133));
    }

    // Pac-Man Chomping Pellets Along the Girder Corridor
    let pac_x = 90 + ((time_sec * 110.0) as i32 % 440);
    let pac_y = 190;
    for dot_x in (90..540).step_by(24) {
        if dot_x > pac_x + 10 {
            fill_circle(frame, dot_x, pac_y, 3, rgb(254, 240, 138));
        }
    }
    fill_circle(frame, pac_x, pac_y, 13, rgb(250, 204, 21));
    if ((time_sec * 12.0) as i32) & 1 == 0 {
        fill_rect(frame, pac_x + 4, pac_y - 5, 11, 10, rgb(6, 6, 14));
    }
    // Chasing Ghosts (Blinky & Inky)
    let ghost_cols = [rgb(239, 68, 68), rgb(56, 189, 248)];
    for (g, &gcol) in ghost_cols.iter().enumerate() {
        let gx = (pac_x - 36 - (g as i32) * 32).max(74);
        fill_circle(frame, gx, pac_y - 3, 11, gcol);
        fill_rect(frame, gx - 11, pac_y - 3, 22, 12, gcol);
        fill_circle(frame, gx - 4, pac_y - 4, 3, rgb(255, 255, 255));
        fill_circle(frame, gx + 4, pac_y - 4, 3, rgb(255, 255, 255));
    }

    // Joust Ostrich Rider Flapping Above the Upper Girder
    let joust_x = 520 - ((time_sec * 95.0) as i32 % 420);
    let joust_y = 132 - ((time_sec * 9.0).sin().abs() * 14.0) as i32;
    fill_circle(frame, joust_x, joust_y, 8, rgb(251, 146, 60));
    draw_line(frame, joust_x - 18, joust_y - 2, joust_x + 6, joust_y - 2, 2, rgb(248, 250, 252));

    // 3. PONG PADDLES ON LEFT & RIGHT EDGES VOLLEYING THE WAVEFORM BALL
    let ball_t = (time_sec * 1.4).sin();
    let ball_x = 320 + (ball_t * 276.0) as i32;
    let ball_y = 188 + ((time_sec * 3.7).cos() * 88.0) as i32;
    fill_rect(frame, 28, (ball_y - 24).clamp(60, 290), 8, 48, rgb(248, 250, 252));
    fill_rect(frame, 604, (ball_y - 24).clamp(60, 290), 8, 48, rgb(248, 250, 252));
    fill_rect(frame, ball_x - 4, ball_y - 4, 8, 8, rgb(250, 204, 21));

    // 4. MISSILE COMMAND CITIES & COUNTER-BATTERY EXPLOSIONS (Bottom Tier y = 240..360)
    fill_rect(frame, 0, 336, CANVAS_W as i32, 24, rgb(234, 179, 8));
    for city in 0..4 {
        let cx = 130 + city * 125;
        fill_rect(frame, cx - 18, 322, 36, 14, rgb(56, 189, 248));
        fill_rect(frame, cx - 10, 314, 20, 8, rgb(103, 232, 249));
    }
    for m in 0..4 {
        let tx = 120 + m * 130;
        let ty = 264 + ((m * 19) % 30);
        draw_line(frame, 320, 334, tx, ty, 1, rgb(56, 189, 248));
        let blast_r = (8.0 + (state.bands[(m * 3) as usize] as f32 / 255.0) * 24.0 + onset * 14.0) as i32;
        let bcol = if ((time_sec * 15.0) as i32 + m) & 1 == 0 {
            rgb(251, 113, 133)
        } else {
            rgb(250, 204, 21)
        };
        fill_circle(frame, tx, ty, blast_r, bcol);
    }
    let _ = rms;
}

// ============================================================================
// SCENE 5 (g): Y2K / VAPORWAVE ODYSSEY (Greek Bust, Fiji Water, Tron Grid, Dolphins, Solitaire)
// ============================================================================
fn render_scene_vaporwave(
    state: &mut EngineState,
    time_sec: f32,
    rms: f32,
    _peak: f32,
    onset: f32,
) {
    let frame = &mut state.frame;
    let horizon_y: i32 = 186;

    // 1. Vaporwave Sunset Gradient & Outrun Striped Sun
    for y in 0..horizon_y {
        let t = y as f32 / horizon_y as f32;
        let c = lerp_color(rgb(46, 16, 101), rgb(244, 114, 182), t);
        let row = (y as usize) * CANVAS_W;
        frame[row..row + CANVAS_W].fill(c);
    }
    let sun_y = 128;
    for y in (sun_y - 54)..(sun_y + 54) {
        if y < horizon_y && (y < sun_y || (y / 4) % 2 == 0) {
            let dy = y - sun_y;
            let hw = ((54 * 54 - dy * dy).max(0) as f32).sqrt() as i32;
            let scol = lerp_color(rgb(250, 204, 21), rgb(244, 63, 94), (y - (sun_y - 54)) as f32 / 108.0);
            fill_rect(frame, 320 - hw, y, hw * 2, 1, scol);
        }
    }

    // 2. Neon Tron Lightcycle Perspective Grid & Racing Lightcycles
    let grid_scroll = time_sec * 4.5;
    for y in horizon_y..(CANVAS_H as i32) {
        let dy = (y - horizon_y + 1) as f32;
        let inv_z = 85.0 / dy;
        let row = (y as usize) * CANVAS_W;
        frame[row..row + CANVAS_W].fill(rgb(12, 6, 28));
        let v = inv_z + grid_scroll;
        let is_hline = (v.fract() < 0.09) || y == horizon_y;
        for x in 0..(CANVAS_W as i32) {
            let u = (x - 320) as f32 * inv_z * 0.032;
            if is_hline || (u.fract().abs() < 0.06) {
                frame[row + x as usize] = rgb(0, 245, 212);
            }
        }
    }
    // Two Tron Lightcycles + Neon Ribbons
    let lc1_x = 180 + ((time_sec * 2.2).sin() * 90.0) as i32;
    let lc2_x = 460 + ((time_sec * 2.2).cos() * 90.0) as i32;
    fill_rect(frame, lc1_x - 45, 258, 45, 6, rgb(56, 189, 248));
    fill_rect(frame, lc1_x, 255, 22, 10, rgb(224, 242, 254));
    fill_rect(frame, lc2_x, 288, 45, 6, rgb(251, 146, 60));
    fill_rect(frame, lc2_x - 22, 285, 22, 10, rgb(254, 243, 199));

    // 3. Classical Marble Greek God Bust (Left Foreground)
    let bust_x = 92;
    let bust_y = 148 + ((time_sec * 1.6).sin() * 8.0) as i32;
    fill_circle(frame, bust_x, bust_y - 26, 22, rgb(226, 232, 240));
    fill_circle(frame, bust_x + 4, bust_y - 26, 18, rgb(248, 250, 252));
    // Classical curls & pedestal shoulders
    for c in -3..=3 {
        fill_circle(frame, bust_x + c * 6, bust_y - 44, 6, rgb(203, 213, 225));
    }
    fill_rect(frame, bust_x - 10, bust_y - 6, 20, 14, rgb(203, 213, 225));
    fill_rect(frame, bust_x - 30, bust_y + 8, 60, 18, rgb(226, 232, 240));
    fill_rect(frame, bust_x - 24, bust_y + 26, 48, 8, rgb(148, 163, 184));

    // 4. Floating Fiji Water Bottle (Right Foreground)
    let fiji_x = 544;
    let fiji_y = 145 + ((time_sec * 1.9 + 1.2).cos() * 9.0) as i32;
    fill_rect(frame, fiji_x - 9, fiji_y - 44, 18, 10, rgb(30, 58, 138)); // Blue cap
    fill_rect(frame, fiji_x - 22, fiji_y - 34, 44, 72, rgb(125, 211, 252)); // Bottle body
    fill_rect(frame, fiji_x - 18, fiji_y - 16, 36, 36, rgb(14, 165, 233)); // Label
    draw_text_5x7(frame, "FIJI", fiji_x - 12, fiji_y - 8, 1, rgb(255, 255, 255));
    fill_circle(frame, fiji_x + 8, fiji_y + 8, 6, rgb(244, 63, 94)); // Pink hibiscus flower

    // 5. Leaping 16-Bit Dolphins Arcing Over the Horizon
    for d in 0..2 {
        let phase = (time_sec * 1.4 + d as f32 * 3.14).rem_euclid(6.283);
        let dx = 220 + d * 180 + (phase.cos() * 55.0) as i32;
        let dy = horizon_y - (phase.sin().max(0.0) * 72.0) as i32;
        if phase.sin() > 0.05 {
            fill_circle(frame, dx, dy, 10, rgb(103, 232, 249));
            fill_circle(frame, dx + 10, dy + 3, 6, rgb(165, 243, 252));
            draw_line(frame, dx - 14, dy + 8, dx, dy, 5, rgb(56, 189, 248));
        }
    }

    // 6. Windows 95 Solitaire Bouncing Card Cascade
    if state.solitaire_vx == 0.0 {
        state.solitaire_trail_x = 64.0;
        state.solitaire_trail_y = 42.0;
        state.solitaire_vx = 3.4;
        state.solitaire_vy = -2.0;
    }
    state.solitaire_trail_x += state.solitaire_vx * (1.0 + rms);
    state.solitaire_trail_y += state.solitaire_vy;
    state.solitaire_vy += 0.38;
    if state.solitaire_trail_y > 295.0 {
        state.solitaire_trail_y = 295.0;
        state.solitaire_vy = -(6.8 + onset * 4.5);
    }
    if state.solitaire_trail_x > 560.0 || state.solitaire_trail_x < 40.0 {
        state.solitaire_vx = -state.solitaire_vx;
    }
    for trail in (0..6).rev() {
        let cx = (state.solitaire_trail_x - trail as f32 * state.solitaire_vx * 2.2) as i32;
        let cy = (state.solitaire_trail_y - trail as f32 * 6.0) as i32;
        fill_rect(frame, cx, cy, 38, 52, rgb(15, 23, 42));
        fill_rect(frame, cx + 1, cy + 1, 36, 50, rgb(248, 250, 252));
        draw_text_5x7(frame, "A", cx + 4, cy + 4, 1, rgb(220, 38, 38));
        fill_circle(frame, cx + 19, cy + 26, 6, rgb(220, 38, 38));
    }
}

// ============================================================================
// SCENE 6 (h): 16-BIT DARK FANTASY SANCTUM (River Travelers, Mist, Knights, Dinosaurs, Orb/Portal)
// ============================================================================
fn render_scene_sanctum(
    state: &mut EngineState,
    time_sec: f32,
    track_progress: f32,
    rms: f32,
    _peak: f32,
    onset: f32,
) {
    let frame = &mut state.frame;
    let river_y: i32 = 258;
    let cycle_pos = if track_progress > 0.01 {
        track_progress
    } else {
        (time_sec * 0.025).fract()
    };

    // 1. Gothic Midnight Sky & Ruined Castle Arches
    for y in 0..river_y {
        let t = y as f32 / river_y as f32;
        let c = lerp_color(rgb(7, 5, 18), rgb(26, 16, 48), t);
        let row = (y as usize) * CANVAS_W;
        frame[row..row + CANVAS_W].fill(c);
    }
    // Ruined Castle Stone Arches & Flickering Torches
    for arch in 0..5 {
        let ax = 64 + arch * 128;
        fill_rect(frame, ax - 14, 96, 28, river_y - 96, rgb(18, 16, 30));
        // Flickering Torchlight on Pillar
        let flicker = ((time_sec * 11.0 + arch as f32).sin() * 4.0) as i32;
        fill_circle(frame, ax, 164, 16 + flicker, rgba(251, 146, 60, 90));
        fill_circle(frame, ax, 164, 6, rgb(250, 204, 21));
    }

    // 2. Flock of Bats Rising Past the Ruins
    for b in 0..9 {
        let bx = ((b * 83 + (time_sec * 65.0) as i32) % 620) + 10;
        let by = 52 + ((b * 29) % 85) - ((time_sec * 4.0 + b as f32).sin() * 12.0) as i32;
        let wing = ((time_sec * 16.0 + b as f32).sin() * 5.0) as i32;
        draw_line(frame, bx - 7, by + wing, bx, by, 2, rgb(9, 7, 16));
        draw_line(frame, bx, by, bx + 7, by + wing, 2, rgb(9, 7, 16));
    }

    // 3. Knights & 16-Bit Dinosaur Silhouette on the Castle Battlement
    let dino_x = 165;
    let dino_y = 218;
    // T-Rex Silhouette
    fill_rect(frame, dino_x - 18, dino_y - 28, 28, 22, rgb(12, 10, 22));
    fill_rect(frame, dino_x - 6, dino_y - 46, 26, 18, rgb(12, 10, 22)); // Jaw/Head
    put_px(frame, dino_x + 12, dino_y - 40, rgb(239, 68, 68)); // Glowing red eye
    draw_line(frame, dino_x - 36, dino_y - 10, dino_x - 14, dino_y - 16, 6, rgb(12, 10, 22)); // Tail
    // Armored Knight with Rune Blade Facing the Dinosaur
    let kx = 242;
    fill_rect(frame, kx - 6, dino_y - 22, 12, 22, rgb(148, 163, 184));
    fill_circle(frame, kx, dino_y - 28, 6, rgb(203, 213, 225));
    draw_line(frame, kx + 4, dino_y - 16, kx - 14, dino_y - 34, 2, rgb(56, 189, 248));

    // 4. The Inner Sanctum: Swirling Dimensional Portal & Levitating Mana Orb (Right Hero)
    let orb_x = 468;
    let orb_y = 166 + ((time_sec * 2.4).sin() * 8.0) as i32;
    let portal_r = 44 + (rms * 24.0 + onset * 14.0) as i32;
    draw_circle_ring(frame, orb_x, orb_y, portal_r + 10, 4, rgb(139, 92, 246));
    draw_circle_ring(frame, orb_x, orb_y, portal_r, 5, rgb(56, 189, 248));
    fill_circle(frame, orb_x, orb_y, 20 + (onset * 8.0) as i32, rgb(0, 245, 212));
    fill_circle(frame, orb_x - 5, orb_y - 5, 7, rgb(255, 255, 255));

    // 5. Midnight River, Cloaked Travelers in a Boat & Rolling Mist
    for y in river_y..(CANVAS_H as i32) {
        let row = (y as usize) * CANVAS_W;
        let t = (y - river_y) as f32 / (CANVAS_H as i32 - river_y) as f32;
        frame[row..row + CANVAS_W].fill(lerp_color(rgb(12, 18, 38), rgb(5, 8, 18), t));
    }
    // Cloaked Travelers on River Boat
    let boat_x = 120 + ((cycle_pos * 260.0) as i32 % 280);
    let boat_y = river_y + 22;
    fill_rect(frame, boat_x - 34, boat_y, 68, 10, rgb(45, 28, 18));
    // Two dark-cloaked figures + glowing lantern at the prow
    fill_circle(frame, boat_x - 12, boat_y - 12, 9, rgb(20, 18, 34));
    fill_circle(frame, boat_x + 8, boat_y - 14, 10, rgb(20, 18, 34));
    fill_circle(frame, boat_x + 32, boat_y - 8, 5, rgb(250, 204, 21));

    // Rolling Mist Bands Across the River
    for m in 0..4 {
        let my = river_y - 8 + m * 14;
        let mx = ((time_sec * (22.0 + m as f32 * 8.0)) as i32 + m * 140) % 520;
        fill_rect_blend(frame, mx - 80, my, 220, 8, rgb(148, 163, 184), 0.18);
    }
}

// ============================================================================
// PER-SCENE TRANSITION WIPES
// ============================================================================
fn apply_transition_wipe(
    frame: &mut [u32; FRAME_PIXELS],
    scene_id: u32,
    trans_progress: f32,
    time_sec: f32,
) {
    let t = trans_progress.clamp(0.0, 1.0);
    if t <= 0.01 {
        return;
    }
    let intensity = (t * std::f32::consts::PI).sin();
    match scene_id % 7 {
        0 => {
            // Arcade Curtain + Strobe Wipe
            let curtain_w = ((CANVAS_W as f32 * 0.5) * intensity) as i32;
            fill_rect(frame, 0, 0, curtain_w, CANVAS_H as i32, rgb(18, 8, 36));
            fill_rect(
                frame,
                CANVAS_W as i32 - curtain_w,
                0,
                curtain_w,
                CANVAS_H as i32,
                rgb(18, 8, 36),
            );
        }
        1 => {
            // Rolling Mist & Sleet Wipe
            for y in 0..(CANVAS_H as i32) {
                let shift = (((y as f32 * 0.15 + time_sec * 20.0).sin()) * 45.0 * intensity) as i32;
                fill_rect_blend(
                    frame,
                    0,
                    y,
                    (CANVAS_W as i32 - shift).max(0),
                    1,
                    rgb(186, 214, 245),
                    intensity * 0.55,
                );
            }
        }
        2 => {
            // Hyperspace Star-Streak Event Horizon Zoom
            let r = ((1.0 - intensity) * 220.0) as i32;
            draw_circle_ring(frame, 320, 180, r.max(8), (28.0 * intensity) as i32, rgb(103, 232, 249));
        }
        3 => {
            // Rising Bubble Wall + Water Ripple
            let wall_y = (CANVAS_H as f32 * (1.0 - intensity)) as i32;
            for b in 0..32 {
                let bx = (b * 22) % (CANVAS_W as i32);
                fill_circle(frame, bx, wall_y + ((b * 13) % 40), 12, rgb(125, 211, 252));
            }
        }
        4 => {
            // CRT Degauss Intermission Collapse
            let band_h = ((CANVAS_H as f32 * 0.42) * intensity) as i32;
            fill_rect(frame, 0, 0, CANVAS_W as i32, band_h, rgb(0, 0, 0));
            fill_rect(
                frame,
                0,
                CANVAS_H as i32 - band_h,
                CANVAS_W as i32,
                band_h,
                rgb(0, 0, 0),
            );
        }
        5 => {
            // VHS Tracking Glitch Bar
            let bar_y = ((time_sec * 260.0) as i32).rem_euclid(CANVAS_H as i32 - 36);
            fill_rect_blend(frame, 0, bar_y, CANVAS_W as i32, 36, rgb(244, 114, 182), intensity * 0.75);
        }
        _ => {
            // SNES 16-Bit Pixel Mosaic / Portal Iris Wipe
            let radius = ((1.0 - intensity * 0.85) * 340.0) as i32;
            draw_circle_ring(frame, 320, 180, radius.max(12), 24, rgb(139, 92, 246));
        }
    }
}

// ============================================================================
// EXPORTED C-ABI / WASM ENTRYPOINTS
// ============================================================================

#[no_mangle]
pub extern "C" fn viz_frame_ptr() -> *const u32 {
    let state = STATE.lock().unwrap();
    state.frame.as_ptr()
}

#[no_mangle]
pub extern "C" fn viz_art_ptr() -> *mut u32 {
    let mut state = STATE.lock().unwrap();
    state.art.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn viz_notify_art_loaded(has_art: u32) {
    let mut state = STATE.lock().unwrap();
    state.has_art = has_art != 0;
    if state.has_art {
        // Sample 4 quadrant colors from the 128x128 art buffer
        let q = [
            state.art[32 * ART_SIZE + 32],
            state.art[32 * ART_SIZE + 96],
            state.art[96 * ART_SIZE + 32],
            state.art[96 * ART_SIZE + 96],
        ];
        state.art_palette = q;
    }
}

#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn viz_set_bands(
    b0: u8,
    b1: u8,
    b2: u8,
    b3: u8,
    b4: u8,
    b5: u8,
    b6: u8,
    b7: u8,
    b8: u8,
    b9: u8,
    b10: u8,
    b11: u8,
    b12: u8,
    b13: u8,
    b14: u8,
    b15: u8,
) {
    let mut state = STATE.lock().unwrap();
    state.bands = [
        b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, b13, b14, b15,
    ];
}

#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn viz_render_frame(
    scene_id: u32,
    time_sec: f32,
    track_progress: f32,
    rms: f32,
    peak: f32,
    onset: f32,
    bpm: f32,
    trans_progress: f32,
) {
    let mut state = STATE.lock().unwrap();
    match scene_id % 7 {
        0 => render_scene_rhythm(&mut state, time_sec, rms, peak, onset, bpm),
        1 => render_scene_midnight(&mut state, time_sec, rms, peak, onset),
        2 => render_scene_cosmos(&mut state, time_sec, rms, peak, onset),
        3 => render_scene_reef(&mut state, time_sec, rms, peak, onset),
        4 => render_scene_arcade(&mut state, time_sec, rms, peak, onset),
        5 => render_scene_vaporwave(&mut state, time_sec, rms, peak, onset),
        _ => render_scene_sanctum(&mut state, time_sec, track_progress, rms, peak, onset),
    }
    if trans_progress > 0.01 {
        apply_transition_wipe(&mut state.frame, scene_id, trans_progress, time_sec);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_all_seven_moodboard_scenes_render_non_black_pixels() {
        viz_set_bands(180, 160, 140, 120, 110, 100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50);
        for scene_id in 0..7 {
            viz_render_frame(scene_id, 12.5, 0.42, 0.45, 0.65, 0.5, 128.0, 0.25);
            let state = STATE.lock().unwrap();
            let non_black = state
                .frame
                .iter()
                .filter(|&&px| (px & 0x00FF_FFFF) != 0)
                .count();
            assert!(
                non_black > 20_000,
                "scene {scene_id} rendered too few lit pixels ({non_black})"
            );
        }
    }
}
