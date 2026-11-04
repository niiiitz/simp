use anyhow::{anyhow, Result};

/// Metadata extracted from an encrypted fMP4 initialization segment (`moov` / `tenc`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackEncryptionInfo {
    /// Encryption scheme (`b"cbcs"`, `b"cenc"`, etc.) from `schm` box.
    pub scheme_type: [u8; 4],
    /// `default_IsProtected` from `tenc` box (`1` = encrypted).
    pub is_protected: u8,
    /// `default_Per_Sample_IV_Size` from `tenc` box (`0`, `8`, or `16`).
    pub per_sample_iv_size: u8,
    /// 16-byte default Key ID (`KID`) from `tenc` box.
    pub default_kid: [u8; 16],
    /// Constant IV (`default_constant_IV`) when `per_sample_iv_size == 0` (standard for `cbcs` audio).
    pub constant_iv: Vec<u8>,
    /// Pattern encryption `(crypt_byte_block, skip_byte_block)` (`(0, 0)` for full-sample `cbcs` audio).
    pub crypt_byte_block: u8,
    pub skip_byte_block: u8,
}

impl Default for TrackEncryptionInfo {
    fn default() -> Self {
        Self {
            scheme_type: *b"cbcs",
            is_protected: 1,
            per_sample_iv_size: 0,
            default_kid: [0u8; 16],
            constant_iv: vec![0u8; 16],
            crypt_byte_block: 0,
            skip_byte_block: 0,
        }
    }
}

/// Sample sizes (`trun`) and per-sample IVs (`senc`) extracted from a media segment (`moof`).
#[derive(Debug, Clone, Default)]
pub struct MoofFragmentInfo {
    /// Byte sizes of each audio sample in `mdat`.
    pub sample_sizes: Vec<u32>,
    /// Optional per-sample IVs parsed from the `senc` box.
    pub sample_ivs: Vec<Vec<u8>>,
}

/// Scans an fMP4 buffer (init segment or media segment) for a Widevine `pssh` box
/// (`system_id == edef8ba9-79d6-4ace-a3c8-27dcd51d21ed`) and returns the full `pssh` box bytes.
pub fn find_widevine_pssh_in_mp4(data: &[u8]) -> Option<Vec<u8>> {
    let mut offset = 0usize;
    while offset + 8 <= data.len() {
        let size = u32::from_be_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ]) as usize;
        let box_type = &data[offset + 4..offset + 8];
        let box_end = if size == 0 {
            data.len()
        } else if size >= 8 && offset + size <= data.len() {
            offset + size
        } else {
            break;
        };

        if box_type == b"pssh" && box_end - offset >= 32 {
            let sys_id = &data[offset + 12..offset + 28];
            if sys_id == &crate::sinks::apple_native::hls::WIDEVINE_SYSTEM_ID {
                return Some(data[offset..box_end].to_vec());
            }
        } else if is_container_box(box_type) && box_end - offset > 8 {
            if let Some(found) = find_widevine_pssh_in_mp4(&data[offset + 8..box_end]) {
                return Some(found);
            }
        }

        offset = box_end;
    }
    None
}

fn is_container_box(box_type: &[u8]) -> bool {
    matches!(
        box_type,
        b"moov"
            | b"trak"
            | b"mdia"
            | b"minf"
            | b"stbl"
            | b"sinf"
            | b"schi"
            | b"moof"
            | b"traf"
            | b"mvex"
            | b"edts"
    )
}

/// Extracts `TrackEncryptionInfo` (`schm` + `tenc` box fields) from an fMP4 init segment.
pub fn parse_init_segment_tenc(data: &[u8]) -> Option<TrackEncryptionInfo> {
    let mut info = TrackEncryptionInfo::default();
    let mut found_tenc = false;
    scan_tenc_recursive(data, &mut info, &mut found_tenc);
    if found_tenc {
        Some(info)
    } else {
        None
    }
}

fn scan_tenc_recursive(data: &[u8], info: &mut TrackEncryptionInfo, found_tenc: &mut bool) {
    let mut offset = 0usize;
    while offset + 8 <= data.len() {
        let size = u32::from_be_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ]) as usize;
        let box_type = &data[offset + 4..offset + 8];
        let box_end = if size == 0 {
            data.len()
        } else if size >= 8 && offset + size <= data.len() {
            offset + size
        } else {
            break;
        };
        let payload = &data[offset + 8..box_end];

        if box_type == b"schm" && payload.len() >= 8 {
            info.scheme_type.copy_from_slice(&payload[4..8]);
        } else if box_type == b"tenc" && payload.len() >= 24 {
            let version = payload[0];
            if version >= 1 {
                let pattern = payload[5];
                info.crypt_byte_block = (pattern >> 4) & 0x0F;
                info.skip_byte_block = pattern & 0x0F;
            }
            info.is_protected = payload[6];
            info.per_sample_iv_size = payload[7];
            info.default_kid.copy_from_slice(&payload[8..24]);
            if info.per_sample_iv_size == 0 && payload.len() >= 25 {
                let iv_len = payload[24] as usize;
                if payload.len() >= 25 + iv_len {
                    info.constant_iv = payload[25..25 + iv_len].to_vec();
                }
            }
            *found_tenc = true;
        } else if box_type == b"stsd" && payload.len() > 8 {
            // `stsd` has 8 bytes of version/flags + entry_count before sample entries (`enca`/`mp4a`)
            scan_sample_entries_for_tenc(&payload[8..], info, found_tenc);
        } else if is_container_box(box_type) {
            scan_tenc_recursive(payload, info, found_tenc);
        }

        offset = box_end;
    }
}

fn scan_sample_entries_for_tenc(
    data: &[u8],
    info: &mut TrackEncryptionInfo,
    found_tenc: &mut bool,
) {
    let mut offset = 0usize;
    while offset + 8 <= data.len() {
        let size = u32::from_be_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ]) as usize;
        let box_type = &data[offset + 4..offset + 8];
        if size < 8 || offset + size > data.len() {
            break;
        }
        // AudioSampleEntry (`enca` / `mp4a`) has a 28-byte fixed header after the 8-byte box header
        if (box_type == b"enca" || box_type == b"mp4a") && size > 36 {
            scan_tenc_recursive(&data[offset + 36..offset + size], info, found_tenc);
        }
        offset += size;
    }
}

/// Rewrites an encrypted fMP4 initialization segment (`enca` -> `mp4a` / original format from `frma`)
/// so standard decoders (`Symphonia` `IsoMp4Reader`) accept the stream once `mdat` samples are decrypted.
pub fn rewrite_init_segment_enca_to_clear(init_bytes: &[u8]) -> Vec<u8> {
    let mut out = init_bytes.to_vec();
    // Replace any `enca` FourCC sample entry header with `mp4a`
    // (preserving identical box lengths so all parent box offsets remain valid!)
    let mut i = 0usize;
    while i + 8 <= out.len() {
        if &out[i + 4..i + 8] == b"enca" {
            let box_size = u32::from_be_bytes([out[i], out[i + 1], out[i + 2], out[i + 3]]) as usize;
            if box_size >= 36 && i + box_size <= out.len() {
                out[i + 4..i + 8].copy_from_slice(b"mp4a");
                // Also neutralize `sinf` box inside the sample entry into a `free` padding box
                // so strict decoders never reject the presence of `sinf` on a clear `mp4a` track.
                neutralize_child_box_to_free(&mut out[i + 36..i + box_size], b"sinf");
            }
        }
        i += 1;
    }
    out
}

fn neutralize_child_box_to_free(buf: &mut [u8], target_type: &[u8; 4]) {
    let mut offset = 0usize;
    while offset + 8 <= buf.len() {
        let size = u32::from_be_bytes([
            buf[offset],
            buf[offset + 1],
            buf[offset + 2],
            buf[offset + 3],
        ]) as usize;
        if size < 8 || offset + size > buf.len() {
            break;
        }
        if &buf[offset + 4..offset + 8] == target_type {
            buf[offset + 4..offset + 8].copy_from_slice(b"free");
        }
        offset += size;
    }
}

/// Parses `trun` (sample sizes) and `senc` (per-sample IVs) from a `moof` box in a media segment.
pub fn parse_moof_fragment(segment_bytes: &[u8], per_sample_iv_size: u8) -> MoofFragmentInfo {
    let mut info = MoofFragmentInfo::default();
    parse_moof_recursive(segment_bytes, per_sample_iv_size, &mut info);
    info
}

fn parse_moof_recursive(data: &[u8], per_sample_iv_size: u8, info: &mut MoofFragmentInfo) {
    let mut offset = 0usize;
    while offset + 8 <= data.len() {
        let size = u32::from_be_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ]) as usize;
        let box_type = &data[offset + 4..offset + 8];
        let box_end = if size == 0 {
            data.len()
        } else if size >= 8 && offset + size <= data.len() {
            offset + size
        } else {
            break;
        };
        let payload = &data[offset + 8..box_end];

        if box_type == b"trun" && payload.len() >= 8 {
            let flags = u32::from_be_bytes([0, payload[1], payload[2], payload[3]]);
            let sample_count =
                u32::from_be_bytes([payload[4], payload[5], payload[6], payload[7]]) as usize;
            let mut cursor = 8usize;
            if (flags & 0x000001) != 0 {
                cursor += 4; // data_offset
            }
            if (flags & 0x000004) != 0 {
                cursor += 4; // first_sample_flags
            }
            let has_duration = (flags & 0x000100) != 0;
            let has_size = (flags & 0x000200) != 0;
            let has_flags = (flags & 0x000400) != 0;
            let has_cts = (flags & 0x000800) != 0;

            for _ in 0..sample_count {
                if has_duration {
                    cursor += 4;
                }
                if has_size {
                    if cursor + 4 <= payload.len() {
                        let sz = u32::from_be_bytes([
                            payload[cursor],
                            payload[cursor + 1],
                            payload[cursor + 2],
                            payload[cursor + 3],
                        ]);
                        info.sample_sizes.push(sz);
                    }
                    cursor += 4;
                }
                if has_flags {
                    cursor += 4;
                }
                if has_cts {
                    cursor += 4;
                }
            }
        } else if box_type == b"senc" && payload.len() >= 8 && per_sample_iv_size > 0 {
            let flags = u32::from_be_bytes([0, payload[1], payload[2], payload[3]]);
            let sample_count =
                u32::from_be_bytes([payload[4], payload[5], payload[6], payload[7]]) as usize;
            let has_subsamples = (flags & 0x000002) != 0;
            let mut cursor = 8usize;
            let iv_len = per_sample_iv_size as usize;

            for _ in 0..sample_count {
                if cursor + iv_len > payload.len() {
                    break;
                }
                let mut iv = payload[cursor..cursor + iv_len].to_vec();
                if iv.len() == 8 {
                    iv.resize(16, 0);
                }
                info.sample_ivs.push(iv);
                cursor += iv_len;
                if has_subsamples {
                    if cursor + 2 > payload.len() {
                        break;
                    }
                    let sub_count =
                        u16::from_be_bytes([payload[cursor], payload[cursor + 1]]) as usize;
                    cursor += 2 + sub_count * 6;
                }
            }
        } else if box_type == b"moof" || box_type == b"traf" {
            parse_moof_recursive(payload, per_sample_iv_size, info);
        }

        offset = box_end;
    }
}

/// Pure-Rust AES-128 implementation (FIPS-197) for in-memory `cbcs` (`AES-128-CBC`) audio sample decryption.
/// Zero external C or Rust crypto crate dependencies required.
pub struct Aes128 {
    round_keys: [[u8; 16]; 11],
}

const SBOX: [u8; 256] = [
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
];

const INV_SBOX: [u8; 256] = [
    0x52, 0x09, 0x6a, 0xd5, 0x30, 0x36, 0xa5, 0x38, 0xbf, 0x40, 0xa3, 0x9e, 0x81, 0xf3, 0xd7, 0xfb,
    0x7c, 0xe3, 0x39, 0x82, 0x9b, 0x2f, 0xff, 0x87, 0x34, 0x8e, 0x43, 0x44, 0xc4, 0xde, 0xe9, 0xcb,
    0x54, 0x7b, 0x94, 0x32, 0xa6, 0xc2, 0x23, 0x3d, 0xee, 0x4c, 0x95, 0x0b, 0x42, 0xfa, 0xc3, 0x4e,
    0x08, 0x2e, 0xa1, 0x66, 0x28, 0xd9, 0x24, 0xb2, 0x76, 0x5b, 0xa2, 0x49, 0x6d, 0x8b, 0xd1, 0x25,
    0x72, 0xf8, 0xf6, 0x64, 0x86, 0x68, 0x98, 0x16, 0xd4, 0xa4, 0x5c, 0xcc, 0x5d, 0x65, 0xb6, 0x92,
    0x6c, 0x70, 0x48, 0x50, 0xfd, 0xed, 0xb9, 0xda, 0x5e, 0x15, 0x46, 0x57, 0xa7, 0x8d, 0x9d, 0x84,
    0x90, 0xd8, 0xab, 0x00, 0x8c, 0xbc, 0xd3, 0x0a, 0xf7, 0xe4, 0x58, 0x05, 0xb8, 0xb3, 0x45, 0x06,
    0xd0, 0x2c, 0x1e, 0x8f, 0xca, 0x3f, 0x0f, 0x02, 0xc1, 0xaf, 0xbd, 0x03, 0x01, 0x13, 0x8a, 0x6b,
    0x3a, 0x91, 0x11, 0x41, 0x4f, 0x67, 0xdc, 0xea, 0x97, 0xf2, 0xcf, 0xce, 0xf0, 0xb4, 0xe6, 0x73,
    0x96, 0xac, 0x74, 0x22, 0xe7, 0xad, 0x35, 0x85, 0xe2, 0xf9, 0x37, 0xe8, 0x1c, 0x75, 0xdf, 0x6e,
    0x47, 0xf1, 0x1a, 0x71, 0x1d, 0x29, 0xc5, 0x89, 0x6f, 0xb7, 0x62, 0x0e, 0xaa, 0x18, 0xbe, 0x1b,
    0xfc, 0x56, 0x3e, 0x4b, 0xc6, 0xd2, 0x79, 0x20, 0x9a, 0xdb, 0xc0, 0xfe, 0x78, 0xcd, 0x5a, 0xf4,
    0x1f, 0xdd, 0xa8, 0x33, 0x88, 0x07, 0xc7, 0x31, 0xb1, 0x12, 0x10, 0x59, 0x27, 0x80, 0xec, 0x5f,
    0x60, 0x51, 0x7f, 0xa9, 0x19, 0xb5, 0x4a, 0x0d, 0x2d, 0xe5, 0x7a, 0x9f, 0x93, 0xc9, 0x9c, 0xef,
    0xa0, 0xe0, 0x3b, 0x4d, 0xae, 0x2a, 0xf5, 0xb0, 0xc8, 0xeb, 0xbb, 0x3c, 0x83, 0x53, 0x99, 0x61,
    0x17, 0x2b, 0x04, 0x7e, 0xba, 0x77, 0xd6, 0x26, 0xe1, 0x69, 0x14, 0x63, 0x55, 0x21, 0x0c, 0x7d,
];

const RCON: [u8; 10] = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

#[inline]
fn gmul(mut a: u8, mut b: u8) -> u8 {
    let mut p = 0u8;
    for _ in 0..8 {
        if (b & 1) != 0 {
            p ^= a;
        }
        let hi = (a & 0x80) != 0;
        a <<= 1;
        if hi {
            a ^= 0x1b;
        }
        b >>= 1;
    }
    p
}

impl Aes128 {
    pub fn new(key: &[u8; 16]) -> Self {
        let mut round_keys = [[0u8; 16]; 11];
        round_keys[0].copy_from_slice(key);

        for r in 1..=10 {
            let prev = round_keys[r - 1];
            let mut temp = [
                SBOX[prev[13] as usize] ^ RCON[r - 1],
                SBOX[prev[14] as usize],
                SBOX[prev[15] as usize],
                SBOX[prev[12] as usize],
            ];
            let mut cur = [0u8; 16];
            for word in 0..4 {
                let offset = word * 4;
                for i in 0..4 {
                    cur[offset + i] = prev[offset + i] ^ temp[i];
                }
                temp.copy_from_slice(&cur[offset..offset + 4]);
            }
            round_keys[r] = cur;
        }

        Self { round_keys }
    }

    pub fn encrypt_block(&self, block: &mut [u8; 16]) {
        for i in 0..16 {
            block[i] ^= self.round_keys[0][i];
        }
        for r in 1..=10 {
            // SubBytes
            for b in block.iter_mut() {
                *b = SBOX[*b as usize];
            }
            // ShiftRows
            let t = *block;
            block[1] = t[5];
            block[5] = t[9];
            block[9] = t[13];
            block[13] = t[1];

            block[2] = t[10];
            block[6] = t[14];
            block[10] = t[2];
            block[14] = t[6];

            block[3] = t[15];
            block[7] = t[3];
            block[11] = t[7];
            block[15] = t[11];

            // MixColumns (rounds 1..=9)
            if r < 10 {
                for c in 0..4 {
                    let idx = c * 4;
                    let s0 = block[idx];
                    let s1 = block[idx + 1];
                    let s2 = block[idx + 2];
                    let s3 = block[idx + 3];
                    block[idx] = gmul(0x02, s0) ^ gmul(0x03, s1) ^ s2 ^ s3;
                    block[idx + 1] = s0 ^ gmul(0x02, s1) ^ gmul(0x03, s2) ^ s3;
                    block[idx + 2] = s0 ^ s1 ^ gmul(0x02, s2) ^ gmul(0x03, s3);
                    block[idx + 3] = gmul(0x03, s0) ^ s1 ^ s2 ^ gmul(0x02, s3);
                }
            }
            // AddRoundKey
            for i in 0..16 {
                block[i] ^= self.round_keys[r][i];
            }
        }
    }

    pub fn decrypt_block(&self, block: &mut [u8; 16]) {
        for i in 0..16 {
            block[i] ^= self.round_keys[10][i];
        }
        for r in (0..10).rev() {
            // InvShiftRows
            let t = *block;
            block[1] = t[13];
            block[5] = t[1];
            block[9] = t[5];
            block[13] = t[9];

            block[2] = t[10];
            block[6] = t[14];
            block[10] = t[2];
            block[14] = t[6];

            block[3] = t[7];
            block[7] = t[11];
            block[11] = t[15];
            block[15] = t[3];

            // InvSubBytes
            for b in block.iter_mut() {
                *b = INV_SBOX[*b as usize];
            }
            // AddRoundKey
            for i in 0..16 {
                block[i] ^= self.round_keys[r][i];
            }
            // InvMixColumns (rounds 9..=1)
            if r > 0 {
                for c in 0..4 {
                    let idx = c * 4;
                    let s0 = block[idx];
                    let s1 = block[idx + 1];
                    let s2 = block[idx + 2];
                    let s3 = block[idx + 3];
                    block[idx] = gmul(0x0e, s0) ^ gmul(0x0b, s1) ^ gmul(0x0d, s2) ^ gmul(0x09, s3);
                    block[idx + 1] =
                        gmul(0x09, s0) ^ gmul(0x0e, s1) ^ gmul(0x0b, s2) ^ gmul(0x0d, s3);
                    block[idx + 2] =
                        gmul(0x0d, s0) ^ gmul(0x09, s1) ^ gmul(0x0e, s2) ^ gmul(0x0b, s3);
                    block[idx + 3] =
                        gmul(0x0b, s0) ^ gmul(0x0d, s1) ^ gmul(0x09, s2) ^ gmul(0x0e, s3);
                }
            }
        }
    }
}

/// Decrypts a single `cbcs` (`AES-128-CBC`) audio sample in place.
/// Per ISO/IEC 23001-7 `cbcs` specification:
/// - When `crypt_byte_block == 0 && skip_byte_block == 0` (standard for AAC audio), all complete 16-byte blocks
///   are decrypted with AES-128-CBC using the sample IV, and any trailing `< 16` byte remainder is left in the clear.
/// - When `crypt_byte_block > 0`, applies the `(crypt, skip)` 16-byte block pattern.
pub fn decrypt_cbcs_sample_in_place(
    sample: &mut [u8],
    cipher: &Aes128,
    iv: &[u8; 16],
    crypt_byte_block: u8,
    skip_byte_block: u8,
) {
    let mut prev_cipher = *iv;
    let total_blocks = sample.len() / 16;
    let crypt_len = crypt_byte_block as usize;
    let skip_len = skip_byte_block as usize;
    let pattern_len = crypt_len + skip_len;

    for blk_idx in 0..total_blocks {
        let should_decrypt = if pattern_len == 0 || skip_len == 0 {
            true
        } else {
            (blk_idx % pattern_len) < crypt_len
        };
        if should_decrypt {
            let start = blk_idx * 16;
            let mut block = [0u8; 16];
            block.copy_from_slice(&sample[start..start + 16]);
            let saved_ciphertext = block;
            cipher.decrypt_block(&mut block);
            for i in 0..16 {
                block[i] ^= prev_cipher[i];
            }
            sample[start..start + 16].copy_from_slice(&block);
            prev_cipher = saved_ciphertext;
        }
    }
}

/// Encrypts a single `cbcs` (`AES-128-CBC`) sample in place (used by unit tests to verify round-trip decryption).
pub fn encrypt_cbcs_sample_in_place(
    sample: &mut [u8],
    cipher: &Aes128,
    iv: &[u8; 16],
    crypt_byte_block: u8,
    skip_byte_block: u8,
) {
    let mut prev_cipher = *iv;
    let total_blocks = sample.len() / 16;
    let crypt_len = crypt_byte_block as usize;
    let skip_len = skip_byte_block as usize;
    let pattern_len = crypt_len + skip_len;

    for blk_idx in 0..total_blocks {
        let should_encrypt = if pattern_len == 0 || skip_len == 0 {
            true
        } else {
            (blk_idx % pattern_len) < crypt_len
        };
        if should_encrypt {
            let start = blk_idx * 16;
            let mut block = [0u8; 16];
            for i in 0..16 {
                block[i] = sample[start + i] ^ prev_cipher[i];
            }
            cipher.encrypt_block(&mut block);
            sample[start..start + 16].copy_from_slice(&block);
            prev_cipher = block;
        }
    }
}

/// Decrypts a single `cenc` (`AES-128-CTR`, `ISO-23001-7` used by Apple Music `28:ctrp256` streams)
/// audio sample in place using an 8-byte or 16-byte initialization vector.
/// Since AES-CTR is a symmetric stream cipher, encryption and decryption are identical!
pub fn crypt_cenc_ctr_sample_in_place(sample: &mut [u8], cipher: &Aes128, iv: &[u8; 16]) {
    let mut counter = *iv;
    let mut offset = 0usize;
    while offset < sample.len() {
        let mut keystream = counter;
        cipher.encrypt_block(&mut keystream);
        let chunk_len = (sample.len() - offset).min(16);
        for i in 0..chunk_len {
            sample[offset + i] ^= keystream[i];
        }
        // Increment the 64-bit big-endian block counter in the lower 8 bytes (`counter[8..16]`)
        let lo = u64::from_be_bytes([
            counter[8],
            counter[9],
            counter[10],
            counter[11],
            counter[12],
            counter[13],
            counter[14],
            counter[15],
        ])
        .wrapping_add(1);
        counter[8..16].copy_from_slice(&lo.to_be_bytes());
        offset += chunk_len;
    }
}

/// Decrypts an entire fMP4 media segment (`moof` + `mdat`) in place using a 16-byte AES content key
/// and the `TrackEncryptionInfo` parsed from the initialization segment.
/// Automatically dispatches `cenc` (`AES-128-CTR` for `28:ctrp256`) or `cbcs` (`AES-128-CBC` for `30:cbcp256`).
pub fn decrypt_fmp4_media_segment_in_place(
    segment_bytes: &mut [u8],
    content_key: &[u8; 16],
    tenc: &TrackEncryptionInfo,
) -> Result<usize> {
    let moof_info = parse_moof_fragment(segment_bytes, tenc.per_sample_iv_size);
    if moof_info.sample_sizes.is_empty() {
        return Err(anyhow!("No trun sample sizes found in media segment moof box"));
    }

    // Locate the `mdat` box payload
    let mut offset = 0usize;
    let mut mdat_payload_range: Option<(usize, usize)> = None;
    while offset + 8 <= segment_bytes.len() {
        let size = u32::from_be_bytes([
            segment_bytes[offset],
            segment_bytes[offset + 1],
            segment_bytes[offset + 2],
            segment_bytes[offset + 3],
        ]) as usize;
        let box_type = &segment_bytes[offset + 4..offset + 8];
        let box_end = if size == 0 {
            segment_bytes.len()
        } else if size >= 8 && offset + size <= segment_bytes.len() {
            offset + size
        } else {
            break;
        };

        if box_type == b"mdat" {
            mdat_payload_range = Some((offset + 8, box_end));
            break;
        }
        offset = box_end;
    }

    let (mdat_start, mdat_end) =
        mdat_payload_range.ok_or_else(|| anyhow!("No mdat box found in fMP4 media segment"))?;

    let cipher = Aes128::new(content_key);
    let mut default_iv = [0u8; 16];
    let copy_len = tenc.constant_iv.len().min(16);
    default_iv[..copy_len].copy_from_slice(&tenc.constant_iv[..copy_len]);

    let is_cenc_ctr = &tenc.scheme_type == b"cenc";
    let mdat_slice = &mut segment_bytes[mdat_start..mdat_end];
    let mut sample_cursor = 0usize;
    let mut decrypted_samples = 0usize;

    for (idx, &sample_sz) in moof_info.sample_sizes.iter().enumerate() {
        let sz = sample_sz as usize;
        if sample_cursor + sz > mdat_slice.len() {
            break;
        }
        let mut iv = default_iv;
        if let Some(s_iv) = moof_info.sample_ivs.get(idx) {
            let n = s_iv.len().min(16);
            iv = [0u8; 16];
            iv[..n].copy_from_slice(&s_iv[..n]);
        }

        let sample_buf = &mut mdat_slice[sample_cursor..sample_cursor + sz];
        if is_cenc_ctr {
            crypt_cenc_ctr_sample_in_place(sample_buf, &cipher, &iv);
        } else {
            decrypt_cbcs_sample_in_place(
                sample_buf,
                &cipher,
                &iv,
                tenc.crypt_byte_block,
                tenc.skip_byte_block,
            );
        }
        sample_cursor += sz;
        decrypted_samples += 1;
    }

    Ok(decrypted_samples)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aes128_nist_fips197_vector_and_cbcs_roundtrip() {
        // Official FIPS-197 Appendix B test vector
        let key: [u8; 16] = [
            0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6, 0xab, 0xf7, 0x15, 0x88, 0x09, 0xcf,
            0x4f, 0x3c,
        ];
        let plaintext: [u8; 16] = [
            0x32, 0x43, 0xf6, 0xa8, 0x88, 0x5a, 0x30, 0x8d, 0x31, 0x31, 0x98, 0xa2, 0xe0, 0x37,
            0x07, 0x34,
        ];
        let expected_cipher: [u8; 16] = [
            0x39, 0x25, 0x84, 0x1d, 0x02, 0xdc, 0x09, 0xfb, 0xdc, 0x11, 0x85, 0x97, 0x19, 0x6a,
            0x0b, 0x32,
        ];

        let aes = Aes128::new(&key);
        let mut block = plaintext;
        aes.encrypt_block(&mut block);
        assert_eq!(block, expected_cipher, "AES-128 encryption must match FIPS-197");

        aes.decrypt_block(&mut block);
        assert_eq!(block, plaintext, "AES-128 decryption must invert encryption");

        // Verify cbcs sample with 3 full 16-byte blocks + 7 trailing unencrypted remainder bytes (55 bytes total)
        let iv: [u8; 16] = [0x11; 16];
        let original_sample: Vec<u8> = (0..55u8).map(|i| i.wrapping_mul(7)).collect();
        let mut buf = original_sample.clone();

        encrypt_cbcs_sample_in_place(&mut buf, &aes, &iv, 0, 0);
        assert_ne!(&buf[..48], &original_sample[..48]);
        assert_eq!(
            &buf[48..],
            &original_sample[48..],
            "cbcs trailing <16-byte remainder must remain unencrypted"
        );

        decrypt_cbcs_sample_in_place(&mut buf, &aes, &iv, 0, 0);
        assert_eq!(buf, original_sample, "cbcs sample decryption must restore exact original bytes");

        // Also verify cenc (AES-128-CTR) roundtrip for 28:ctrp256 streams
        let mut ctr_buf = original_sample.clone();
        crypt_cenc_ctr_sample_in_place(&mut ctr_buf, &aes, &iv);
        assert_ne!(ctr_buf, original_sample);
        crypt_cenc_ctr_sample_in_place(&mut ctr_buf, &aes, &iv);
        assert_eq!(ctr_buf, original_sample, "cenc AES-128-CTR decryption must restore exact original bytes");
    }

    #[test]
    fn test_rewrite_init_segment_enca_to_mp4a() {
        // Construct a synthetic AudioSampleEntry ('enca', 48 bytes) containing a 'sinf' child box (12 bytes)
        let mut init = Vec::new();
        init.extend_from_slice(&48u32.to_be_bytes());
        init.extend_from_slice(b"enca");
        init.extend_from_slice(&[0u8; 28]); // 28-byte AudioSampleEntry header
        init.extend_from_slice(&12u32.to_be_bytes());
        init.extend_from_slice(b"sinf");
        init.extend_from_slice(&[1, 2, 3, 4]);

        let rewritten = rewrite_init_segment_enca_to_clear(&init);
        assert_eq!(&rewritten[4..8], b"mp4a");
        assert_eq!(&rewritten[40..44], b"free");
    }
}
