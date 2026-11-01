/**
 * Pure TypeScript ISO/IEC 18004 QR Code Matrix Encoder (Version 1–5, Byte Mode, ECC Level L).
 * Zero React or external runtime dependencies so it can be imported safely in both Vite React apps
 * and SteamOS `SharedJSContext` (`SP_REACT`) Decky plugins.
 */

const VERSION_PARAMS: Record<
  number,
  { size: number; totalCodewords: number; ecCodewords: number; dataCapacity: number; align: number[] }
> = {
  1: { size: 21, totalCodewords: 26, ecCodewords: 7, dataCapacity: 17, align: [] },
  2: { size: 25, totalCodewords: 44, ecCodewords: 10, dataCapacity: 32, align: [6, 18] },
  3: { size: 29, totalCodewords: 70, ecCodewords: 15, dataCapacity: 53, align: [6, 22] },
  4: { size: 33, totalCodewords: 100, ecCodewords: 20, dataCapacity: 78, align: [6, 26] },
  5: { size: 37, totalCodewords: 134, ecCodewords: 26, dataCapacity: 106, align: [6, 30] },
};

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    for (let j = 0; j < ecLen; j++) {
      rem[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return rem;
}

export function encodeQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= 5 && bytes.length > VERSION_PARAMS[version].dataCapacity) {
    version++;
  }
  if (version > 5) version = 5;

  const params = VERSION_PARAMS[version];
  const { size, totalCodewords, ecCodewords, align } = params;
  const dataCodewordsLen = totalCodewords - ecCodewords;

  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (let i = 0; i < bytes.length && i < params.dataCapacity; i++) {
    pushBits(bytes[i], 8);
  }

  const maxBits = dataCodewordsLen * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) {
    bits.push(0);
  }
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const dataBytes = new Uint8Array(dataCodewordsLen);
  for (let i = 0; i < bits.length / 8; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i * 8 + j];
    }
    dataBytes[i] = b;
  }

  let padToggle = true;
  for (let i = bits.length / 8; i < dataCodewordsLen; i++) {
    dataBytes[i] = padToggle ? 0xec : 0x11;
    padToggle = !padToggle;
  }

  const ecBytes = rsEncode(dataBytes, ecCodewords);
  const allCodewords = new Uint8Array(totalCodewords);
  allCodewords.set(dataBytes, 0);
  allCodewords.set(ecBytes, dataCodewordsLen);

  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunc: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunctionModule = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      modules[r][c] = dark;
      isFunc[r][c] = true;
    }
  };

  const drawFinder = (r0: number, c0: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(r, c, inOuter && (onBorder || inInner));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  if (align.length > 0) {
    for (const ar of align) {
      for (const ac of align) {
        if ((ar === 6 && ac === 6) || (ar === 6 && ac === size - 7) || (ar === size - 7 && ac === 6)) {
          continue;
        }
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            setFunctionModule(ar + dr, ac + dc, dark);
          }
        }
      }
    }
  }

  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunctionModule(8, i, false);
      setFunctionModule(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunctionModule(8, size - 1 - i, false);
    setFunctionModule(size - 1 - i, 8, false);
  }
  setFunctionModule(size - 8, 8, true);

  let bitIdx = 0;
  const totalBits = allCodewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (!isFunc[r][c]) {
          let dark = false;
          if (bitIdx < totalBits) {
            dark = ((allCodewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) !== 0;
            bitIdx++;
          }
          if ((r + c) % 2 === 0) dark = !dark;
          modules[r][c] = dark;
        }
      }
    }
  }

  const formatBits = 0x77c4;
  for (let i = 0; i <= 5; i++) setFunctionModule(8, i, ((formatBits >>> i) & 1) !== 0);
  setFunctionModule(8, 7, ((formatBits >>> 6) & 1) !== 0);
  setFunctionModule(8, 8, ((formatBits >>> 7) & 1) !== 0);
  setFunctionModule(7, 8, ((formatBits >>> 8) & 1) !== 0);
  for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, ((formatBits >>> i) & 1) !== 0);

  for (let i = 0; i < 8; i++) setFunctionModule(size - 1 - i, 8, ((formatBits >>> i) & 1) !== 0);
  for (let i = 8; i < 15; i++) setFunctionModule(8, size - 15 + i, ((formatBits >>> i) & 1) !== 0);

  return modules;
}

