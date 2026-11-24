/** Pixel algorithms for the photo editor. All operate on RGBA Uint8ClampedArray buffers. */

export type Mask = Uint8ClampedArray // w*h, 0..255

export const colorDist = (d: Uint8ClampedArray, i: number, r: number, g: number, b: number, a = 255) =>
  Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b), Math.abs(d[i + 3] - a))

/** Magic-wand style flood fill. Returns mask of matched pixels. */
export function floodMask(img: ImageData, x: number, y: number, tol: number, contiguous: boolean, limit?: Mask): Mask {
  const { width: w, height: h, data } = img
  const m = new Uint8ClampedArray(w * h)
  x = Math.floor(x); y = Math.floor(y)
  if (x < 0 || y < 0 || x >= w || y >= h) return m
  const si = (y * w + x) * 4
  const r = data[si], g = data[si + 1], b = data[si + 2], a = data[si + 3]
  const ok = (p: number) => colorDist(data, p * 4, r, g, b, a) <= tol && (!limit || limit[p] > 0)
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (ok(p)) m[p] = 255
    return m
  }
  const stack = new Int32Array(w * h)
  let sp = 0
  stack[sp++] = y * w + x
  m[y * w + x] = 255
  while (sp) {
    const p = stack[--sp]
    const px = p % w, py = (p / w) | 0
    if (px > 0 && !m[p - 1] && ok(p - 1)) { m[p - 1] = 255; stack[sp++] = p - 1 }
    if (px < w - 1 && !m[p + 1] && ok(p + 1)) { m[p + 1] = 255; stack[sp++] = p + 1 }
    if (py > 0 && !m[p - w] && ok(p - w)) { m[p - w] = 255; stack[sp++] = p - w }
    if (py < h - 1 && !m[p + w] && ok(p + w)) { m[p + w] = 255; stack[sp++] = p + w }
  }
  return m
}

export function combineMasks(base: Mask | null, add: Mask, mode: 'new' | 'add' | 'subtract' | 'intersect'): Mask {
  if (!base || mode === 'new') return add
  const out = new Uint8ClampedArray(add.length)
  for (let i = 0; i < add.length; i++) {
    if (mode === 'add') out[i] = Math.max(base[i], add[i])
    else if (mode === 'subtract') out[i] = Math.max(0, base[i] - add[i])
    else out[i] = Math.min(base[i], add[i])
  }
  return out
}

export function maskFromCanvas(c: HTMLCanvasElement): Mask {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data
  const m = new Uint8ClampedArray(c.width * c.height)
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3]
  return m
}

export function maskToCanvas(m: Mask, w: number, h: number, color: [number, number, number] = [0, 0, 0], invert = false): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  const id = ctx.createImageData(w, h)
  for (let i = 0; i < m.length; i++) {
    id.data[i * 4] = color[0]; id.data[i * 4 + 1] = color[1]; id.data[i * 4 + 2] = color[2]
    id.data[i * 4 + 3] = invert ? 255 - m[i] : m[i]
  }
  ctx.putImageData(id, 0, 0)
  return c
}

/** Builds two canvases of the selection border with offset dash phases (marching ants). */
export function antsCanvases(m: Mask, w: number, h: number): [HTMLCanvasElement, HTMLCanvasElement] {
  const mk = (phase: number) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d')!
    const id = ctx.createImageData(w, h)
    const d = id.data
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x
      const inside = m[p] > 127
      if (!inside) continue
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || m[p - 1] <= 127 || m[p + 1] <= 127 || m[p - w] <= 127 || m[p + w] <= 127
      if (!edge) continue
      const on = ((x + y + phase) >> 2) % 2 === 0
      const v = on ? 0 : 255
      d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = v; d[p * 4 + 3] = 255
    }
    ctx.putImageData(id, 0, 0)
    return c
  }
  return [mk(0), mk(4)]
}

export function maskBounds(m: Mask, w: number, h: number) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** Box blur on a mask (feather). */
export function blurMask(m: Mask, w: number, h: number, r: number): Mask {
  if (r < 1) return m
  let src = Float32Array.from(m)
  const tmp = new Float32Array(m.length)
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let acc = 0
      for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))]
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / (2 * r + 1)
        acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)]
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
      for (let y = 0; y < h; y++) {
        src[y * w + x] = acc / (2 * r + 1)
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
      }
    }
  }
  const out = new Uint8ClampedArray(m.length)
  for (let i = 0; i < m.length; i++) out[i] = src[i]
  src = tmp // release
  return out
}

/** Grow (positive) or shrink (negative) a mask by r pixels. */
export function morphMask(m: Mask, w: number, h: number, r: number): Mask {
  const grow = r > 0
  let cur = Uint8ClampedArray.from(m, (v) => (v > 127 ? 255 : 0))
  for (let it = 0; it < Math.abs(r); it++) {
    const next = Uint8ClampedArray.from(cur)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x
      const n = [x > 0 ? cur[p - 1] : 0, x < w - 1 ? cur[p + 1] : 0, y > 0 ? cur[p - w] : 0, y < h - 1 ? cur[p + w] : 0]
      if (grow && !cur[p] && n.some((v) => v)) next[p] = 255
      if (!grow && cur[p] && n.some((v) => !v)) next[p] = 0
    }
    cur = next
  }
  return cur
}

/** Keep only the largest connected region and fill its holes. */
export function largestComponent(m: Mask, w: number, h: number): Mask {
  const label = new Int32Array(w * h)
  let best = 0, bestSize = 0, cur = 0
  const stack = new Int32Array(w * h)
  for (let s = 0; s < w * h; s++) {
    if (m[s] < 128 || label[s]) continue
    cur++
    let sp = 0, size = 0
    stack[sp++] = s; label[s] = cur
    while (sp) {
      const p = stack[--sp]; size++
      const x = p % w
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q >= 0 && q < w * h && m[q] >= 128 && !label[q]) { label[q] = cur; stack[sp++] = q }
      }
    }
    if (size > bestSize) { bestSize = size; best = cur }
  }
  const out = new Uint8ClampedArray(w * h)
  for (let i = 0; i < out.length; i++) if (label[i] === best) out[i] = 255
  // fill holes: flood outside from border
  const outside = new Uint8Array(w * h)
  let sp = 0
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const p = y * w + x; if (!out[p] && !outside[p]) { outside[p] = 1; stack[sp++] = p } }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const p = y * w + x; if (!out[p] && !outside[p]) { outside[p] = 1; stack[sp++] = p } }
  while (sp) {
    const p = stack[--sp]; const x = p % w
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (q >= 0 && q < w * h && !out[q] && !outside[q]) { outside[q] = 1; stack[sp++] = q }
  }
  for (let i = 0; i < out.length; i++) if (!outside[i]) out[i] = 255
  return out
}

/** GrabCut-lite: segments the dominant object inside rect using colour models of inside vs border. */
export function objectSelect(img: ImageData, rx: number, ry: number, rw: number, rh: number): Mask {
  const { width: w, height: h, data } = img
  rx = Math.max(0, Math.floor(rx)); ry = Math.max(0, Math.floor(ry))
  rw = Math.min(w - rx, Math.floor(rw)); rh = Math.min(h - ry, Math.floor(rh))
  const bg: number[][] = [], fg: number[][] = []
  const band = Math.max(3, Math.floor(Math.min(rw, rh) * 0.06))
  for (let y = ry; y < ry + rh; y += 2) for (let x = rx; x < rx + rw; x += 2) {
    const i = (y * w + x) * 4
    const c = [data[i], data[i + 1], data[i + 2]]
    const onBorder = x - rx < band || rx + rw - x < band || y - ry < band || ry + rh - y < band
    const inCore = Math.abs(x - (rx + rw / 2)) < rw * 0.25 && Math.abs(y - (ry + rh / 2)) < rh * 0.25
    if (onBorder) bg.push(c); else if (inCore) fg.push(c)
  }
  const kmeans = (pts: number[][], k: number) => {
    if (!pts.length) return [[0, 0, 0]]
    let cents = Array.from({ length: k }, (_, i) => pts[Math.floor((i / k) * pts.length)].slice())
    for (let it = 0; it < 8; it++) {
      const sums = cents.map(() => [0, 0, 0, 0])
      for (const p of pts) {
        let bi = 0, bd = Infinity
        cents.forEach((c, i) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = i } })
        sums[bi][0] += p[0]; sums[bi][1] += p[1]; sums[bi][2] += p[2]; sums[bi][3]++
      }
      cents = sums.map((s, i) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : cents[i]))
    }
    return cents
  }
  const bgC = kmeans(bg, 5), fgC = kmeans(fg, 5)
  const near = (cs: number[][], r: number, g: number, b: number) => Math.min(...cs.map((c) => (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2))
  const m = new Uint8ClampedArray(w * h)
  for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
    const i = (y * w + x) * 4
    const dF = near(fgC, data[i], data[i + 1], data[i + 2]), dB = near(bgC, data[i], data[i + 1], data[i + 2])
    // spatial prior: favour centre
    const cx = (x - (rx + rw / 2)) / (rw / 2), cy = (y - (ry + rh / 2)) / (rh / 2)
    const prior = 1 + 0.6 * (cx * cx + cy * cy)
    if (dF * prior < dB) m[y * w + x] = 255
  }
  return blurMask(largestComponent(m, w, h), w, h, 1)
}

/** Exemplar-based inpainting (onion-peel fill with best-matching patch sampling). */
export function inpaint(img: ImageData, mask: Mask, onProgress?: (p: number) => void) {
  const { width: w, height: h, data } = img
  const known = new Uint8Array(w * h)
  let holeCount = 0
  let bx0 = w, by0 = h, bx1 = 0, by1 = 0
  for (let i = 0; i < w * h; i++) {
    if (mask[i] > 20) {
      holeCount++
      const x = i % w, y = (i / w) | 0
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y
    } else known[i] = 1
  }
  if (!holeCount) return
  const holeSize = Math.max(bx1 - bx0, by1 - by0)
  const R = Math.max(24, holeSize * 2)
  const P = 3 // patch radius
  const K = holeCount > 60000 ? 16 : holeCount > 15000 ? 28 : 48
  const orig = Uint8ClampedArray.from(data)
  let front: number[] = []
  const inFront = new Uint8Array(w * h)
  const pushFront = (p: number) => { if (!known[p] && !inFront[p]) { inFront[p] = 1; front.push(p) } }
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    const p = y * w + x
    if (known[p]) continue
    if ((x > 0 && known[p - 1]) || (x < w - 1 && known[p + 1]) || (y > 0 && known[p - w]) || (y < h - 1 && known[p + w])) pushFront(p)
  }
  let done = 0
  while (front.length) {
    const next: number[] = []
    // shuffle for less directional artefacts
    for (let i = front.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [front[i], front[j]] = [front[j], front[i]] }
    for (const p of front) {
      const px = p % w, py = (p / w) | 0
      let best = -1, bestD = Infinity
      for (let k = 0; k < K; k++) {
        const sx = px + Math.round((Math.random() * 2 - 1) * R), sy = py + Math.round((Math.random() * 2 - 1) * R)
        if (sx < P || sy < P || sx >= w - P || sy >= h - P) continue
        const sp = sy * w + sx
        if (!known[sp] || mask[sp] > 20) continue
        let d = 0, n = 0
        for (let dy = -P; dy <= P && d < bestD; dy++) for (let dx = -P; dx <= P; dx++) {
          const tx = px + dx, ty = py + dy
          if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue
          const tp = ty * w + tx
          if (!known[tp]) continue
          const qp = (sy + dy) * w + (sx + dx)
          if (mask[qp] > 20 && !known[qp]) { d += 30000; continue }
          const a = tp * 4, b = qp * 4
          d += (data[a] - data[b]) ** 2 + (data[a + 1] - data[b + 1]) ** 2 + (data[a + 2] - data[b + 2]) ** 2
          n++
        }
        if (n === 0) continue
        d = d / n + (Math.abs(sx - px) + Math.abs(sy - py)) * 0.5
        if (d < bestD) { bestD = d; best = sp }
      }
      const o = p * 4
      if (best >= 0) {
        const s = best * 4
        data[o] = data[s]; data[o + 1] = data[s + 1]; data[o + 2] = data[s + 2]; data[o + 3] = data[s + 3]
      } else {
        // average known neighbours
        let r = 0, g = 0, b = 0, a = 0, n = 0
        for (const q of [p - 1, p + 1, p - w, p + w]) if (q >= 0 && q < w * h && known[q]) { r += data[q * 4]; g += data[q * 4 + 1]; b += data[q * 4 + 2]; a += data[q * 4 + 3]; n++ }
        if (n) { data[o] = r / n; data[o + 1] = g / n; data[o + 2] = b / n; data[o + 3] = a / n }
      }
    }
    for (const p of front) known[p] = 1
    done += front.length
    for (const p of front) {
      const x = p % w
      if (x > 0) { const q = p - 1; if (!known[q] && !inFront[q]) { inFront[q] = 1; next.push(q) } }
      if (x < w - 1) { const q = p + 1; if (!known[q] && !inFront[q]) { inFront[q] = 1; next.push(q) } }
      if (p - w >= 0) { const q = p - w; if (!known[q] && !inFront[q]) { inFront[q] = 1; next.push(q) } }
      if (p + w < w * h) { const q = p + w; if (!known[q] && !inFront[q]) { inFront[q] = 1; next.push(q) } }
    }
    front = next
    onProgress?.(done / holeCount)
  }
  // light smoothing inside hole + soft blend with original by mask value
  const copy = Uint8ClampedArray.from(data)
  for (let y = Math.max(1, by0); y <= Math.min(h - 2, by1); y++) for (let x = Math.max(1, bx0); x <= Math.min(w - 2, bx1); x++) {
    const p = y * w + x
    if (mask[p] <= 20) continue
    for (let c = 0; c < 4; c++) {
      const i = p * 4 + c
      const avg = (copy[i] * 4 + copy[i - 4] + copy[i + 4] + copy[i - w * 4] + copy[i + w * 4]) / 8
      const t = mask[p] / 255
      data[i] = orig[i] * (1 - t) + avg * t
    }
  }
}

/** Solve homography mapping unit square corners → quad (for perspective crop). */
export function homography(src: [number, number][], dst: [number, number][]) {
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  // gaussian elimination 8x8
  for (let c = 0; c < 8; c++) {
    let piv = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r
    ;[A[c], A[piv]] = [A[piv], A[c]]
    for (let r = 0; r < 8; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]
    }
  }
  const hv = A.map((row, i) => row[8] / row[i])
  return [...hv, 1] // 3x3 row-major
}

export function warpPerspective(src: ImageData, quad: [number, number][], outW: number, outH: number): ImageData {
  const H = homography([[0, 0], [outW, 0], [outW, outH], [0, outH]], quad)
  const out = new ImageData(outW, outH)
  const { width: w, height: h, data } = src
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    const d = H[6] * x + H[7] * y + H[8]
    const sx = (H[0] * x + H[1] * y + H[2]) / d, sy = (H[3] * x + H[4] * y + H[5]) / d
    const x0 = Math.floor(sx), y0 = Math.floor(sy)
    if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) continue
    const fx = sx - x0, fy = sy - y0
    const o = (y * outW + x) * 4
    for (let c = 0; c < 4; c++) {
      const a = data[(y0 * w + x0) * 4 + c], b = data[(y0 * w + x0 + 1) * 4 + c]
      const cc = data[((y0 + 1) * w + x0) * 4 + c], dd = data[((y0 + 1) * w + x0 + 1) * 4 + c]
      out.data[o + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + dd * fx) * fy
    }
  }
  return out
}

/** Gradient magnitude (for magnetic lasso). */
export function gradientMap(img: ImageData): Float32Array {
  const { width: w, height: h, data } = img
  const lum = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) lum[i] = data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11
  const g = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x
    const gx = lum[p + 1] - lum[p - 1] + 0.5 * (lum[p - w + 1] - lum[p - w - 1] + lum[p + w + 1] - lum[p + w - 1])
    const gy = lum[p + w] - lum[p - w] + 0.5 * (lum[p + w - 1] - lum[p - w - 1] + lum[p + w + 1] - lum[p - w + 1])
    g[p] = Math.hypot(gx, gy)
  }
  return g
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  if (mx === mn) return [0, 0, l]
  const d = mx - mn
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  const hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [hh / 6, s, l]
}
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const hue = (p: number, q: number, t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255]
}

export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const rgbToHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

/** Separable box blur on RGBA (3 passes ≈ gaussian). Optionally limited by mask. */
export function blurImage(img: ImageData, r: number) {
  const { width: w, height: h, data } = img
  r = Math.max(1, Math.round(r))
  const tmp = new Float32Array(data.length)
  const src = Float32Array.from(data)
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) for (let c = 0; c < 4; c++) {
      let acc = 0
      for (let x = -r; x <= r; x++) acc += src[(y * w + Math.min(w - 1, Math.max(0, x))) * 4 + c]
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 4 + c] = acc / (2 * r + 1)
        acc += src[(y * w + Math.min(w - 1, x + r + 1)) * 4 + c] - src[(y * w + Math.max(0, x - r)) * 4 + c]
      }
    }
    for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
      let acc = 0
      for (let y = -r; y <= r; y++) acc += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 4 + c]
      for (let y = 0; y < h; y++) {
        src[(y * w + x) * 4 + c] = acc / (2 * r + 1)
        acc += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 4 + c] - tmp[(Math.max(0, y - r) * w + x) * 4 + c]
      }
    }
  }
  for (let i = 0; i < data.length; i++) data[i] = src[i]
}
