import { blurImage, rgbToHsl, hslToRgb } from './algos'

export interface FilterParam { key: string; label: string; min: number; max: number; step: number; def: number }
export interface FilterDef { id: string; name: string; menu: 'Adjustments' | 'Filter'; params: FilterParam[]; apply: (d: ImageData, v: Record<string, number>) => void }

const each = (d: ImageData, fn: (r: number, g: number, b: number, i: number) => [number, number, number]) => {
  const a = d.data
  for (let i = 0; i < a.length; i += 4) { const [r, g, b] = fn(a[i], a[i + 1], a[i + 2], i); a[i] = r; a[i + 1] = g; a[i + 2] = b }
}

export const FILTERS: FilterDef[] = [
  { id: 'bc', name: 'Brightness/Contrast…', menu: 'Adjustments', params: [{ key: 'b', label: 'Brightness', min: -150, max: 150, step: 1, def: 0 }, { key: 'c', label: 'Contrast', min: -100, max: 100, step: 1, def: 0 }],
    apply: (d, v) => { const f = (259 * (v.c + 255)) / (255 * (259 - v.c)); each(d, (r, g, b) => [f * (r - 128) + 128 + v.b, f * (g - 128) + 128 + v.b, f * (b - 128) + 128 + v.b]) } },
  { id: 'levels', name: 'Levels…', menu: 'Adjustments', params: [{ key: 'lo', label: 'Black point', min: 0, max: 254, step: 1, def: 0 }, { key: 'gamma', label: 'Gamma', min: 0.1, max: 3, step: 0.01, def: 1 }, { key: 'hi', label: 'White point', min: 1, max: 255, step: 1, def: 255 }],
    apply: (d, v) => { const lut = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) lut[i] = 255 * Math.pow(Math.min(1, Math.max(0, (i - v.lo) / Math.max(1, v.hi - v.lo))), 1 / v.gamma); each(d, (r, g, b) => [lut[r], lut[g], lut[b]]) } },
  { id: 'curves', name: 'Curves (S-curve)…', menu: 'Adjustments', params: [{ key: 's', label: 'Strength', min: -1, max: 1, step: 0.01, def: 0.3 }],
    apply: (d, v) => { const lut = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) { const x = i / 255; const sc = x + v.s * Math.sin(2 * Math.PI * x) * -0.12; lut[i] = sc * 255 } each(d, (r, g, b) => [lut[r], lut[g], lut[b]]) } },
  { id: 'exposure', name: 'Exposure…', menu: 'Adjustments', params: [{ key: 'e', label: 'Exposure (stops)', min: -3, max: 3, step: 0.05, def: 0 }],
    apply: (d, v) => { const m = Math.pow(2, v.e); each(d, (r, g, b) => [r * m, g * m, b * m]) } },
  { id: 'vibrance', name: 'Vibrance…', menu: 'Adjustments', params: [{ key: 'v', label: 'Vibrance', min: -1, max: 1, step: 0.01, def: 0.4 }],
    apply: (d, v) => each(d, (r, g, b) => { const mx = Math.max(r, g, b), avg = (r + g + b) / 3; const amt = ((Math.abs(mx - avg) * 2) / 255) * -3 * v.v; return [r + (mx - r) * amt, g + (mx - g) * amt, b + (mx - b) * amt] }) },
  { id: 'hs', name: 'Hue/Saturation…', menu: 'Adjustments', params: [{ key: 'h', label: 'Hue', min: -180, max: 180, step: 1, def: 0 }, { key: 's', label: 'Saturation', min: -100, max: 100, step: 1, def: 0 }, { key: 'l', label: 'Lightness', min: -100, max: 100, step: 1, def: 0 }],
    apply: (d, v) => each(d, (r, g, b) => { let [h, s, l] = rgbToHsl(r, g, b); h = (h + v.h / 360 + 1) % 1; s = Math.min(1, Math.max(0, s * (1 + v.s / 100))); l = Math.min(1, Math.max(0, l + v.l / 200)); return hslToRgb(h, s, l) }) },
  { id: 'colorbal', name: 'Color Balance…', menu: 'Adjustments', params: [{ key: 'r', label: 'Cyan ↔ Red', min: -100, max: 100, step: 1, def: 0 }, { key: 'g', label: 'Magenta ↔ Green', min: -100, max: 100, step: 1, def: 0 }, { key: 'b', label: 'Yellow ↔ Blue', min: -100, max: 100, step: 1, def: 0 }],
    apply: (d, v) => each(d, (r, g, b) => [r + v.r, g + v.g, b + v.b]) },
  { id: 'bw', name: 'Black & White', menu: 'Adjustments', params: [], apply: (d) => each(d, (r, g, b) => { const y = r * 0.299 + g * 0.587 + b * 0.114; return [y, y, y] }) },
  { id: 'photofilter', name: 'Photo Filter (warm/cool)…', menu: 'Adjustments', params: [{ key: 't', label: 'Warm ↔ Cool', min: -100, max: 100, step: 1, def: 30 }],
    apply: (d, v) => each(d, (r, g, b) => [r + v.t * 0.5, g + v.t * 0.15, b - v.t * 0.5]) },
  { id: 'invert', name: 'Invert', menu: 'Adjustments', params: [], apply: (d) => each(d, (r, g, b) => [255 - r, 255 - g, 255 - b]) },
  { id: 'posterize', name: 'Posterize…', menu: 'Adjustments', params: [{ key: 'n', label: 'Levels', min: 2, max: 32, step: 1, def: 4 }],
    apply: (d, v) => { const s = 255 / (v.n - 1); each(d, (r, g, b) => [Math.round(r / s) * s, Math.round(g / s) * s, Math.round(b / s) * s]) } },
  { id: 'threshold', name: 'Threshold…', menu: 'Adjustments', params: [{ key: 't', label: 'Threshold', min: 1, max: 255, step: 1, def: 128 }],
    apply: (d, v) => each(d, (r, g, b) => { const y = r * 0.299 + g * 0.587 + b * 0.114 >= v.t ? 255 : 0; return [y, y, y] }) },
  { id: 'sepia', name: 'Sepia', menu: 'Adjustments', params: [], apply: (d) => each(d, (r, g, b) => [r * 0.393 + g * 0.769 + b * 0.189, r * 0.349 + g * 0.686 + b * 0.168, r * 0.272 + g * 0.534 + b * 0.131]) },

  { id: 'gblur', name: 'Gaussian Blur…', menu: 'Filter', params: [{ key: 'r', label: 'Radius', min: 1, max: 60, step: 1, def: 4 }], apply: (d, v) => blurImage(d, v.r / 2) },
  { id: 'motion', name: 'Motion Blur…', menu: 'Filter', params: [{ key: 'len', label: 'Distance', min: 1, max: 80, step: 1, def: 15 }],
    apply: (d, v) => { const { width: w, height: h, data } = d; const src = Uint8ClampedArray.from(data); const L = Math.round(v.len); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) { let acc = 0, n = 0; for (let k = -L; k <= L; k++) { const xx = x + k; if (xx < 0 || xx >= w) continue; acc += src[(y * w + xx) * 4 + c]; n++ } data[(y * w + x) * 4 + c] = acc / n } } },
  { id: 'unsharp', name: 'Unsharp Mask…', menu: 'Filter', params: [{ key: 'a', label: 'Amount', min: 0, max: 3, step: 0.05, def: 1 }, { key: 'r', label: 'Radius', min: 1, max: 10, step: 1, def: 2 }],
    apply: (d, v) => { const b = new ImageData(Uint8ClampedArray.from(d.data), d.width, d.height); blurImage(b, v.r); for (let i = 0; i < d.data.length; i++) if (i % 4 !== 3) d.data[i] = d.data[i] + (d.data[i] - b.data[i]) * v.a } },
  { id: 'noise', name: 'Add Noise…', menu: 'Filter', params: [{ key: 'a', label: 'Amount', min: 0, max: 100, step: 1, def: 20 }],
    apply: (d, v) => each(d, (r, g, b) => { const n = (Math.random() - 0.5) * v.a * 2.55; return [r + n, g + n, b + n] }) },
  { id: 'pixelate', name: 'Pixelate (Mosaic)…', menu: 'Filter', params: [{ key: 's', label: 'Cell size', min: 2, max: 100, step: 1, def: 12 }],
    apply: (d, v) => { const { width: w, height: h, data } = d; const s = Math.round(v.s); for (let by = 0; by < h; by += s) for (let bx = 0; bx < w; bx += s) { const acc = [0, 0, 0, 0]; let n = 0; for (let y = by; y < Math.min(h, by + s); y++) for (let x = bx; x < Math.min(w, bx + s); x++) { const i = (y * w + x) * 4; for (let c = 0; c < 4; c++) acc[c] += data[i + c]; n++ } for (let y = by; y < Math.min(h, by + s); y++) for (let x = bx; x < Math.min(w, bx + s); x++) { const i = (y * w + x) * 4; for (let c = 0; c < 4; c++) data[i + c] = acc[c] / n } } } },
  { id: 'emboss', name: 'Emboss', menu: 'Filter', params: [],
    apply: (d) => { const { width: w, height: h, data } = d; const s = Uint8ClampedArray.from(data); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) for (let c = 0; c < 3; c++) { const i = (y * w + x) * 4 + c; data[i] = 128 + s[i - w * 4 - 4] - s[i + w * 4 + 4] } } },
  { id: 'edges', name: 'Find Edges', menu: 'Filter', params: [],
    apply: (d) => { const { width: w, height: h, data } = d; const s = Uint8ClampedArray.from(data); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) for (let c = 0; c < 3; c++) { const i = (y * w + x) * 4 + c; const gx = s[i + 4] - s[i - 4], gy = s[i + w * 4] - s[i - w * 4]; data[i] = 255 - Math.min(255, Math.hypot(gx, gy) * 2) } } },
  { id: 'vignette', name: 'Vignette…', menu: 'Filter', params: [{ key: 'a', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.5 }],
    apply: (d, v) => { const { width: w, height: h } = d; const R = Math.hypot(w, h) / 2; each(d, (r, g, b, i) => { const p = i / 4, x = p % w, y = (p / w) | 0; const t = 1 - v.a * Math.pow(Math.hypot(x - w / 2, y - h / 2) / R, 2); return [r * t, g * t, b * t] }) } },
  { id: 'oil', name: 'Oil Paint…', menu: 'Filter', params: [{ key: 'r', label: 'Radius', min: 1, max: 6, step: 1, def: 3 }],
    apply: (d, v) => { const { width: w, height: h, data } = d; const s = Uint8ClampedArray.from(data); const R = v.r; const bins = 16; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const cnt = new Int32Array(bins), sr = new Int32Array(bins), sg = new Int32Array(bins), sb = new Int32Array(bins); for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy)); const i = (yy * w + xx) * 4; const k = Math.min(bins - 1, ((s[i] + s[i + 1] + s[i + 2]) / 3 / 256) * bins | 0); cnt[k]++; sr[k] += s[i]; sg[k] += s[i + 1]; sb[k] += s[i + 2] } let bk = 0; for (let k = 1; k < bins; k++) if (cnt[k] > cnt[bk]) bk = k; const o = (y * w + x) * 4; data[o] = sr[bk] / cnt[bk]; data[o + 1] = sg[bk] / cnt[bk]; data[o + 2] = sb[bk] / cnt[bk] } } },
]

/** Apply filter to a layer's data respecting a selection mask (0..255). */
export function applyFilterMasked(orig: ImageData, f: FilterDef, v: Record<string, number>, mask: Uint8ClampedArray | null): ImageData {
  const out = new ImageData(Uint8ClampedArray.from(orig.data), orig.width, orig.height)
  f.apply(out, v)
  if (mask) {
    for (let p = 0; p < mask.length; p++) {
      const t = mask[p] / 255
      if (t >= 1) continue
      const i = p * 4
      for (let c = 0; c < 4; c++) out.data[i + c] = orig.data[i + c] + (out.data[i + c] - orig.data[i + c]) * t
    }
  }
  return out
}
