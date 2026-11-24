import { nanoid } from 'nanoid'
import { doc, bump, usePhoto, makeCanvas, ctx2d, type Anchor, type VPath, type Rect } from './doc'
import { DEFAULT_OPTIONS, BRUSH_TOOLS, type ToolId, type ToolOptions } from './toolDefs'
import {
  floodMask, combineMasks, maskFromCanvas, objectSelect, inpaint, warpPerspective, gradientMap, hexToRgb, rgbToHex,
  rgbToHsl, hslToRgb, blurMask, type Mask,
} from './algos'
import { shapePath } from '../animator/render'
import { useStore } from '../core/store'

type P = { x: number; y: number }
const notify = (m: string) => useStore.getState().notify(m)

/* ======================= transient tool state ======================= */
export const ts = {
  tool: 'brush' as ToolId,
  opts: { ...DEFAULT_OPTIONS } as ToolOptions,
  cursor: null as P | null,
  start: null as P | null,
  last: null as P | null,
  points: [] as P[],
  rect: null as Rect | null,
  line: null as { a: P; b: P } | null,
  crop: null as Rect | null,
  quad: [] as P[],
  cloneSrc: null as P | null,
  cloneOffset: null as P | null,
  stroke: null as PixelStroke | null,
  paintMask: null as HTMLCanvasElement | null, // red overlay for remove/heal
  typing: null as null | { x: number; y: number; vertical: boolean; mask: boolean },
  floating: null as null | { canvas: HTMLCanvasElement; base: HTMLCanvasElement; dx: number; dy: number; selection: Mask | null },
  grad: null as Float32Array | null,
  patchMode: null as null | 'draw' | 'drag',
  pathDrag: null as null | { kind: 'anchor' | 'in' | 'out' | 'path' | 'newhandle'; pathId: string; idx: number; orig?: VPath },
  spaceHeld: false,
  dragView: null as null | { x: number; y: number; panX: number; panY: number; rot: number; ang: number },
  sliceDrag: null as null | { i: number; ox: number; oy: number },
  qsSrc: null as ImageData | null,
  lastPaint: null as P | null,
}

export const setTool = (t: ToolId) => {
  cancelTransient()
  ts.tool = t
  bump()
}
export function cancelTransient() {
  ts.start = null; ts.points = []; ts.rect = null; ts.line = null; ts.quad = []; ts.stroke = null; ts.paintMask = null
  ts.patchMode = null; ts.pathDrag = null
  if (ts.tool !== 'crop' && ts.tool !== 'artboard') ts.crop = null
}

const fgRgb = () => hexToRgb(usePhoto.getState().fg)
const bgRgb = () => hexToRgb(usePhoto.getState().bg)

function selModeFromEvent(e: PointerEvent | MouseEvent): ToolOptions['selMode'] {
  if (e.shiftKey && e.altKey) return 'intersect'
  if (e.shiftKey) return 'add'
  if (e.altKey) return 'subtract'
  return ts.opts.selMode
}

function applySelection(m: Mask, mode: ToolOptions['selMode'], label = 'Selection') {
  if (ts.opts.feather > 0) m = blurMask(m, doc.width, doc.height, Math.round(ts.opts.feather))
  doc.setSelection(combineMasks(doc.selection, m, mode))
  doc.commit(label, [])
}

function shapeMask(draw: (c: CanvasRenderingContext2D) => void): Mask {
  const c = makeCanvas(doc.width, doc.height)
  const x = ctx2d(c)
  x.fillStyle = '#000'
  draw(x)
  return maskFromCanvas(c)
}

function sampleSource() { return ts.opts.sampleAll ? doc.compositeData() : doc.layerData() }

/* ======================= pixel painting engine ======================= */
type PixelOp = (i: number, w: number, s: PixelStroke, cx: number, cy: number) => void

export class PixelStroke {
  orig: ImageData
  work: ImageData
  cov: Float32Array
  W: number
  H: number
  dirty = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  carry: Float32Array | null = null // smudge/mixer load
  carryR = 0
  sampled: [number, number, number] | null = null
  hist: ImageData | null = null
  pattern: ImageData | null = null
  op: PixelOp
  perDab?: (s: PixelStroke, cx: number, cy: number, r: number) => void
  onMask: boolean
  constructor(op: PixelOp, perDab?: (s: PixelStroke, cx: number, cy: number, r: number) => void, onMask = false) {
    this.op = op; this.perDab = perDab; this.onMask = onMask
    this.W = doc.width; this.H = doc.height
    this.orig = doc.layerData()
    this.work = new ImageData(Uint8ClampedArray.from(this.orig.data), this.W, this.H)
    this.cov = new Float32Array(this.W * this.H)
  }
  dab(cx: number, cy: number) {
    const o = ts.opts
    const r = Math.max(0.5, o.size / 2)
    const hard = ts.tool === 'pencil' ? 1 : o.hardness
    this.perDab?.(this, cx, cy, r)
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.W - 1, Math.ceil(cx + r))
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.H - 1, Math.ceil(cy + r))
    const sel = doc.selection
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r
      if (d > 1) continue
      let w = ts.tool === 'pencil' ? 1 : d <= hard ? 1 : 1 - (d - hard) / (1 - hard + 1e-6)
      w = w * w * (3 - 2 * w)
      const p = y * this.W + x
      if (sel && !this.onMask && !usePhoto.getState().quickMask) w *= sel[p] / 255
      if (w <= 0) continue
      this.op(p * 4, w, this, cx, cy)
    }
    this.dirty.x0 = Math.min(this.dirty.x0, x0); this.dirty.y0 = Math.min(this.dirty.y0, y0)
    this.dirty.x1 = Math.max(this.dirty.x1, x1); this.dirty.y1 = Math.max(this.dirty.y1, y1)
  }
  line(a: P, b: P) {
    const spacing = Math.max(1, ts.opts.size * (ts.tool === 'smudge' || ts.tool === 'blur' || ts.tool === 'sharpen' ? 0.12 : 0.2))
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    const n = Math.max(1, Math.ceil(dist / spacing))
    for (let i = 1; i <= n; i++) this.dab(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n)
  }
  flush() {
    if (this.onMask) return
    const { x0, y0, x1, y1 } = this.dirty
    if (x1 < x0) return
    ctx2d(doc.layer.canvas).putImageData(this.work, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1)
    this.dirty = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  }
  /** Photoshop-like coverage: accumulates with flow up to opacity. */
  coverage(p: number, w: number) {
    const o = ts.opts
    const c = this.cov[p]
    const n = Math.min(o.opacity, c + o.flow * w * (o.opacity - c))
    this.cov[p] = Math.max(c, n)
    return this.cov[p]
  }
  blendColor(i: number, w: number, r: number, g: number, b: number, a = 255) {
    const t = this.coverage(i / 4, w)
    const od = this.orig.data, wd = this.work.data
    const sa = (a / 255) * t, da = od[i + 3] / 255
    const oa = sa + da * (1 - sa)
    if (oa <= 0) { wd[i + 3] = 0; return }
    wd[i] = (r * sa + od[i] * da * (1 - sa)) / oa
    wd[i + 1] = (g * sa + od[i + 1] * da * (1 - sa)) / oa
    wd[i + 2] = (b * sa + od[i + 2] * da * (1 - sa)) / oa
    wd[i + 3] = oa * 255
  }
}

function makePattern(kind: ToolOptions['pattern']): ImageData {
  const s = 24
  const c = makeCanvas(s, s), x = ctx2d(c)
  const [fr, fg, fb] = fgRgb(), [br, bgc, bb] = bgRgb()
  x.fillStyle = rgbToHex(br, bgc, bb); x.fillRect(0, 0, s, s)
  x.fillStyle = rgbToHex(fr, fg, fb); x.strokeStyle = x.fillStyle
  switch (kind) {
    case 'checker': x.fillRect(0, 0, s / 2, s / 2); x.fillRect(s / 2, s / 2, s / 2, s / 2); break
    case 'dots': x.beginPath(); x.arc(s / 2, s / 2, s / 5, 0, 7); x.fill(); break
    case 'stripes': x.lineWidth = 5; x.beginPath(); x.moveTo(-4, s + 4); x.lineTo(s + 4, -4); x.moveTo(-4, 4); x.lineTo(4, -4); x.moveTo(s - 4, s + 4); x.lineTo(s + 4, s - 4); x.stroke(); break
    case 'bricks': x.lineWidth = 2; x.strokeRect(0, 0, s, s / 2); x.beginPath(); x.moveTo(s / 2, s / 2); x.lineTo(s / 2, s); x.moveTo(0, s - 1); x.lineTo(s, s - 1); x.stroke(); break
    case 'grid': x.lineWidth = 1; x.strokeRect(0.5, 0.5, s, s); break
    case 'noise': { const d = x.getImageData(0, 0, s, s); for (let i = 0; i < d.data.length; i += 4) { const t = Math.random(); d.data[i] = br + (fr - br) * t; d.data[i + 1] = bgc + (fg - bgc) * t; d.data[i + 2] = bb + (fb - bb) * t } x.putImageData(d, 0, 0); break }
  }
  return x.getImageData(0, 0, s, s)
}

const lum = (d: Uint8ClampedArray, i: number) => (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255

function buildStroke(tool: ToolId, start: P, e: PointerEvent): PixelStroke | null {
  const o = ts.opts
  const qm = usePhoto.getState().quickMask
  // quick mask or selection brush: paint into selection
  if (qm && (tool === 'brush' || tool === 'pencil' || tool === 'eraser') || tool === 'selection-brush') {
    const base = doc.selection ? Uint8ClampedArray.from(doc.selection) : new Uint8ClampedArray(doc.width * doc.height)
    const [r, g, b] = fgRgb()
    const target = tool === 'selection-brush' ? (e.altKey ? 0 : 255) : tool === 'eraser' ? 0 : Math.round(((r + g + b) / 3))
    const s = new PixelStroke((i, w) => {
      const p = i / 4
      base[p] = base[p] + (target - base[p]) * Math.min(1, w * o.opacity)
    }, undefined, true)
    s.flush = () => { doc.selection = base; doc.invalidateSel(); bump() }
    return s
  }
  switch (tool) {
    case 'brush': case 'pencil': {
      const [r, g, b] = fgRgb()
      return new PixelStroke((i, w, s) => s.blendColor(i, w, r, g, b))
    }
    case 'eraser': return new PixelStroke((i, w, s) => {
      const t = s.coverage(i / 4, w)
      s.work.data[i + 3] = s.orig.data[i + 3] * (1 - t)
    })
    case 'pattern-stamp': {
      const pat = makePattern(o.pattern)
      return new PixelStroke((i, w, s) => {
        const p = i / 4, x = p % s.W, y = (p / s.W) | 0
        const j = ((y % pat.height) * pat.width + (x % pat.width)) * 4
        s.blendColor(i, w, pat.data[j], pat.data[j + 1], pat.data[j + 2])
      })
    }
    case 'history-brush': {
      const h = doc.historyLayerData(doc.layer.id)
      if (!h || h.width !== doc.width || h.height !== doc.height) { notify('History source has a different canvas size'); return null }
      return new PixelStroke((i, w, s) => s.blendColor(i, w, h.data[i], h.data[i + 1], h.data[i + 2], h.data[i + 3]))
    }
    case 'art-history': {
      const h = doc.historyLayerData(doc.layer.id)
      if (!h || h.width !== doc.width) { notify('History source has a different canvas size'); return null }
      const s = new PixelStroke(() => {})
      s.dab = function (cx, cy) {
        const ctx = ctx2d(doc.layer.canvas)
        for (let k = 0; k < 8; k++) {
          const px = cx + (Math.random() - 0.5) * o.size * 2, py = cy + (Math.random() - 0.5) * o.size * 2
          if (px < 0 || py < 0 || px >= this.W || py >= this.H) continue
          if (doc.selection && doc.selAt(px, py) < 128) continue
          const j = ((py | 0) * this.W + (px | 0)) * 4
          ctx.strokeStyle = `rgba(${h.data[j]},${h.data[j + 1]},${h.data[j + 2]},${0.7 * o.opacity})`
          ctx.lineWidth = Math.max(1, o.size / 6); ctx.lineCap = 'round'
          const a = Math.random() * Math.PI * 2, len = o.size * (0.3 + Math.random() * 0.6)
          ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + Math.cos(a + 0.6) * len * 0.6, py + Math.sin(a + 0.6) * len * 0.6, px + Math.cos(a) * len, py + Math.sin(a) * len); ctx.stroke()
        }
      }
      s.flush = () => {}
      return s
    }
    case 'clone-stamp': case 'heal': {
      if (!ts.cloneSrc) { notify('Alt+click to set a source point first'); return null }
      if (!ts.cloneOffset || !o.aligned) ts.cloneOffset = { x: ts.cloneSrc.x - start.x, y: ts.cloneSrc.y - start.y }
      const off = ts.cloneOffset
      const src = sampleSource()
      const heal = tool === 'heal'
      let dr = 0, dg = 0, db = 0
      return new PixelStroke((i, w, s) => {
        const p = i / 4, x = p % s.W, y = (p / s.W) | 0
        const sx = Math.round(x + off.x), sy = Math.round(y + off.y)
        if (sx < 0 || sy < 0 || sx >= s.W || sy >= s.H) return
        const j = (sy * s.W + sx) * 4
        s.blendColor(i, w, src.data[j] + dr, src.data[j + 1] + dg, src.data[j + 2] + db, src.data[j + 3])
      }, heal ? (s, cx, cy, r) => {
        // colour-match: mean of target ring vs source ring
        let tr = 0, tg = 0, tb = 0, sr = 0, sg = 0, sb = 0, n = 0
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
          const tx = Math.round(cx + Math.cos(a) * r), ty = Math.round(cy + Math.sin(a) * r)
          const sx = Math.round(tx + off.x), sy = Math.round(ty + off.y)
          if (tx < 0 || ty < 0 || tx >= s.W || ty >= s.H || sx < 0 || sy < 0 || sx >= s.W || sy >= s.H) continue
          const ti = (ty * s.W + tx) * 4, si = (sy * s.W + sx) * 4
          tr += s.orig.data[ti]; tg += s.orig.data[ti + 1]; tb += s.orig.data[ti + 2]
          sr += src.data[si]; sg += src.data[si + 1]; sb += src.data[si + 2]; n++
        }
        if (n) { dr = (tr - sr) / n; dg = (tg - sg) / n; db = (tb - sb) / n }
      } : undefined)
    }
    case 'color-replace': {
      const src = doc.layerData()
      const j = ((Math.round(start.y) * doc.width) + Math.round(start.x)) * 4
      const target = [src.data[j], src.data[j + 1], src.data[j + 2]]
      const [fh, fs] = rgbToHsl(...fgRgb())
      return new PixelStroke((i, w, s) => {
        const od = s.orig.data
        if (Math.max(Math.abs(od[i] - target[0]), Math.abs(od[i + 1] - target[1]), Math.abs(od[i + 2] - target[2])) > o.tolerance) return
        const [, , l] = rgbToHsl(od[i], od[i + 1], od[i + 2])
        const [r, g, b] = hslToRgb(fh, fs, l)
        const t = Math.min(1, w * o.opacity)
        s.work.data[i] = od[i] + (r - od[i]) * t; s.work.data[i + 1] = od[i + 1] + (g - od[i + 1]) * t; s.work.data[i + 2] = od[i + 2] + (b - od[i + 2]) * t
      })
    }
    case 'mixer-brush': {
      const load = [...fgRgb()]
      return new PixelStroke((i, w, s) => {
        const wd = s.work.data
        const t = Math.min(1, w * o.flow * 0.6)
        wd[i] += (load[0] - wd[i]) * t; wd[i + 1] += (load[1] - wd[i + 1]) * t; wd[i + 2] += (load[2] - wd[i + 2]) * t
        wd[i + 3] = Math.max(wd[i + 3], 255 * t)
      }, (s, cx, cy) => {
        const j = ((Math.round(Math.min(s.H - 1, Math.max(0, cy))) * s.W) + Math.round(Math.min(s.W - 1, Math.max(0, cx)))) * 4
        const wd = s.work.data
        if (wd[j + 3] > 10) for (let c = 0; c < 3; c++) load[c] += (wd[j + c] - load[c]) * o.wet * 0.5
      })
    }
    case 'adjust-brush': return new PixelStroke((i, w, s) => {
      const t = s.coverage(i / 4, w)
      const od = s.orig.data, wd = s.work.data
      let [hh, ss, ll] = rgbToHsl(od[i], od[i + 1], od[i + 2])
      ll = Math.min(1, Math.max(0, ll + o.adjBrightness * 0.5 * t))
      ss = Math.min(1, Math.max(0, ss * (1 + o.adjSaturation * t)))
      let [r, g, b] = hslToRgb(hh, ss, ll)
      r += o.adjWarmth * 40 * t; b -= o.adjWarmth * 40 * t
      wd[i] = r; wd[i + 1] = g; wd[i + 2] = b
    })
    case 'dodge': case 'burn': return new PixelStroke((i, w, s) => {
      const wd = s.work.data
      const L = lum(wd, i)
      const rw = o.range === 'shadows' ? 1 - L : o.range === 'highlights' ? L : 1 - Math.abs(L - 0.5) * 2
      const f = o.exposure * w * 0.15 * (0.25 + rw)
      for (let c = 0; c < 3; c++) wd[i + c] = tool === 'dodge' ? wd[i + c] + (255 - wd[i + c]) * f : wd[i + c] * (1 - f)
    })
    case 'sponge': return new PixelStroke((i, w, s) => {
      const wd = s.work.data
      const g = (wd[i] + wd[i + 1] + wd[i + 2]) / 3
      const f = o.strength * w * 0.12 * (o.spongeMode === 'saturate' ? -1 : 1)
      for (let c = 0; c < 3; c++) wd[i + c] = wd[i + c] + (g - wd[i + c]) * f
    })
    case 'blur': case 'sharpen': return new PixelStroke((i, w, s) => {
      const wd = s.work.data, W4 = s.W * 4
      if (i < W4 + 4 || i >= wd.length - W4 - 4) return
      for (let c = 0; c < 4; c++) {
        const k = i + c
        const avg = (wd[k - 4] + wd[k + 4] + wd[k - W4] + wd[k + W4] + wd[k - W4 - 4] + wd[k - W4 + 4] + wd[k + W4 - 4] + wd[k + W4 + 4]) / 8
        const f = o.strength * w * 0.5
        wd[k] = tool === 'blur' ? wd[k] + (avg - wd[k]) * f : wd[k] + (wd[k] - avg) * f * 0.6
      }
    })
    case 'smudge': {
      const R = Math.ceil(o.size / 2) + 1
      const D = R * 2 + 1
      let prev: P | null = null
      const s = new PixelStroke((i, w, st, cx, cy) => {
        if (!st.carry) return
        const p = i / 4, x = p % st.W, y = (p / st.W) | 0
        const lx = Math.round(x - cx) + R, ly = Math.round(y - cy) + R
        if (lx < 0 || ly < 0 || lx >= D || ly >= D) return
        const k = (ly * D + lx) * 4
        const t = w * o.strength
        for (let c = 0; c < 4; c++) st.work.data[i + c] += (st.carry[k + c] - st.work.data[i + c]) * t
      }, (st, cx, cy) => {
        // pick up pixels at previous location (the carry) for this dab, then update after
        const pick = (px: number, py: number) => {
          const buf = new Float32Array(D * D * 4)
          for (let ly = 0; ly < D; ly++) for (let lx = 0; lx < D; lx++) {
            const x = Math.min(st.W - 1, Math.max(0, Math.round(px) + lx - R)), y = Math.min(st.H - 1, Math.max(0, Math.round(py) + ly - R))
            const j = (y * st.W + x) * 4, k = (ly * D + lx) * 4
            for (let c = 0; c < 4; c++) buf[k + c] = st.work.data[j + c]
          }
          return buf
        }
        if (!st.carry) st.carry = pick(cx, cy)
        else if (prev) {
          const fresh = pick(cx, cy)
          for (let k = 0; k < fresh.length; k++) st.carry[k] = st.carry[k] * o.strength + fresh[k] * (1 - o.strength)
        }
        prev = { x: cx, y: cy }
      })
      return s
    }
    case 'bg-eraser': return new PixelStroke((i, w, s) => {
      if (!s.sampled) return
      const od = s.orig.data
      if (Math.max(Math.abs(od[i] - s.sampled[0]), Math.abs(od[i + 1] - s.sampled[1]), Math.abs(od[i + 2] - s.sampled[2])) > o.tolerance) return
      s.work.data[i + 3] = Math.min(s.work.data[i + 3], od[i + 3] * (1 - Math.min(1, w * 1.5)))
    }, (s, cx, cy) => {
      const x = Math.round(Math.min(s.W - 1, Math.max(0, cx))), y = Math.round(Math.min(s.H - 1, Math.max(0, cy)))
      const j = (y * s.W + x) * 4
      if (s.orig.data[j + 3] > 0) s.sampled = [s.orig.data[j], s.orig.data[j + 1], s.orig.data[j + 2]]
    })
    case 'remove': case 'spot-heal': {
      // paint a mask; inpaint on release
      ts.paintMask = makeCanvas(doc.width, doc.height)
      const pm = ctx2d(ts.paintMask)
      const s = new PixelStroke(() => {}, undefined, true)
      s.dab = (cx, cy) => {
        pm.fillStyle = 'rgba(255,40,60,1)'
        pm.beginPath(); pm.arc(cx, cy, o.size / 2, 0, Math.PI * 2); pm.fill()
      }
      s.flush = () => bump()
      return s
    }
  }
  return null
}

/* ======================= helpers ======================= */
function rectFrom(a: P, b: P, square: boolean): Rect {
  let w = b.x - a.x, h = b.y - a.y
  if (square) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m }
  return { x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + h), w: Math.abs(w), h: Math.abs(h) }
}

function polyMask(pts: P[]): Mask {
  return shapeMask((x) => { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); x.fill() })
}

export function eyedrop(p: P, toBg: boolean, size: number = ts.opts.sampleSize) {
  const data = doc.compositeData()
  const r = Math.floor(size / 2)
  let R = 0, G = 0, B = 0, n = 0
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = Math.round(p.x) + dx, y = Math.round(p.y) + dy
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) continue
    const j = (y * doc.width + x) * 4
    R += data.data[j]; G += data.data[j + 1]; B += data.data[j + 2]; n++
  }
  if (!n) return
  const hex = rgbToHex(R / n, G / n, B / n)
  usePhoto.setState(toBg ? { bg: hex } : { fg: hex })
}

export function sampleColorAt(p: P): [number, number, number, number] | null {
  const x = Math.round(p.x), y = Math.round(p.y)
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null
  const c = makeCanvas(1, 1), cx = ctx2d(c)
  for (const l of doc.layers) if (l.visible) { cx.globalAlpha = l.opacity; cx.drawImage(l.canvas, -x, -y) }
  const d = cx.getImageData(0, 0, 1, 1).data
  return [d[0], d[1], d[2], d[3]]
}

function paintGradient(a: P, b: P) {
  const o = ts.opts
  const layer = doc.layer
  const tmp = makeCanvas(doc.width, doc.height), x = ctx2d(tmp)
  const fg = usePhoto.getState().fg, bg = o.gradientTransparent ? fg + '00' : usePhoto.getState().bg
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  if (o.gradientType === 'linear' || o.gradientType === 'reflected') {
    const g = o.gradientType === 'linear' ? x.createLinearGradient(a.x, a.y, b.x, b.y) : x.createLinearGradient(a.x - (b.x - a.x), a.y - (b.y - a.y), b.x, b.y)
    if (o.gradientType === 'reflected') { g.addColorStop(0, bg); g.addColorStop(0.5, fg); g.addColorStop(1, bg) } else { g.addColorStop(0, fg); g.addColorStop(1, bg) }
    x.fillStyle = g
    x.fillRect(0, 0, doc.width, doc.height)
  } else if (o.gradientType === 'radial') {
    const g = x.createRadialGradient(a.x, a.y, 0, a.x, a.y, len)
    g.addColorStop(0, fg); g.addColorStop(1, bg)
    x.fillStyle = g; x.fillRect(0, 0, doc.width, doc.height)
  } else if (o.gradientType === 'angle') {
    const g = x.createConicGradient(Math.atan2(b.y - a.y, b.x - a.x), a.x, a.y)
    g.addColorStop(0, fg); g.addColorStop(1, bg)
    x.fillStyle = g; x.fillRect(0, 0, doc.width, doc.height)
  } else {
    // diamond: manhattan distance
    const id = x.createImageData(doc.width, doc.height)
    const [fr, fgc, fb] = hexToRgb(fg), [br, bgc, bb] = hexToRgb(usePhoto.getState().bg)
    const ang = Math.atan2(b.y - a.y, b.x - a.x), ca = Math.cos(-ang), sa = Math.sin(-ang)
    for (let y = 0; y < doc.height; y++) for (let xx = 0; xx < doc.width; xx++) {
      const dx = xx - a.x, dy = y - a.y
      const rx = dx * ca - dy * sa, ry = dx * sa + dy * ca
      const t = Math.min(1, (Math.abs(rx) + Math.abs(ry)) / len)
      const j = (y * doc.width + xx) * 4
      id.data[j] = fr + (br - fr) * t; id.data[j + 1] = fgc + (bgc - fgc) * t; id.data[j + 2] = fb + (bb - fb) * t
      id.data[j + 3] = o.gradientTransparent ? 255 * (1 - t) : 255
    }
    x.putImageData(id, 0, 0)
  }
  const sc = doc.selectionCanvas()
  if (sc) { x.globalCompositeOperation = 'destination-in'; x.drawImage(sc, 0, 0) }
  const lc = ctx2d(layer.canvas)
  lc.globalAlpha = o.opacity
  lc.drawImage(tmp, 0, 0)
  lc.globalAlpha = 1
  doc.commit('Gradient', [layer.id])
}

function fillMaskWithColor(m: Mask, label: string, erase = false) {
  const l = doc.layer
  const d = doc.layerData()
  const [r, g, b] = fgRgb()
  const sel = doc.selection
  for (let p = 0; p < m.length; p++) {
    let w = m[p] / 255
    if (sel) w *= sel[p] / 255
    if (w <= 0) continue
    const i = p * 4
    w *= ts.opts.opacity
    if (erase) { d.data[i + 3] *= 1 - w; continue }
    const sa = w, da = d.data[i + 3] / 255, oa = sa + da * (1 - sa)
    d.data[i] = (r * sa + d.data[i] * da * (1 - sa)) / oa
    d.data[i + 1] = (g * sa + d.data[i + 1] * da * (1 - sa)) / oa
    d.data[i + 2] = (b * sa + d.data[i + 2] * da * (1 - sa)) / oa
    d.data[i + 3] = oa * 255
  }
  ctx2d(l.canvas).putImageData(d, 0, 0)
  doc.commit(label, [l.id])
}

export function customShapePath(x: CanvasRenderingContext2D, kind: ToolOptions['customShape'], w: number, h: number) {
  const hw = w / 2, hh = h / 2
  switch (kind) {
    case 'star': shapePath(x, 'star', w, h, 5); break
    case 'heart': shapePath(x, 'heart', w, h); break
    case 'arrow': shapePath(x, 'arrow', w, h); break
    case 'bubble': x.roundRect(-hw, -hh, w, h * 0.75, Math.min(w, h) * 0.15); x.moveTo(-hw * 0.4, hh * 0.5); x.lineTo(-hw * 0.6, hh); x.lineTo(-hw * 0.05, hh * 0.5); break
    case 'check': x.moveTo(-hw, 0); x.lineTo(-hw * 0.3, hh * 0.7); x.lineTo(hw, -hh * 0.7); x.lineTo(hw * 0.8, -hh); x.lineTo(-hw * 0.3, hh * 0.25); x.lineTo(-hw * 0.8, -hh * 0.3); x.closePath(); break
    case 'bolt': x.moveTo(hw * 0.2, -hh); x.lineTo(-hw * 0.7, hh * 0.15); x.lineTo(-hw * 0.05, hh * 0.15); x.lineTo(-hw * 0.3, hh); x.lineTo(hw * 0.7, -hh * 0.2); x.lineTo(hw * 0.05, -hh * 0.2); x.closePath(); break
    case 'chicken': {
      x.ellipse(0, hh * 0.2, hw * 0.75, hh * 0.65, 0, 0, Math.PI * 2)
      x.moveTo(hw * 0.75, -hh * 0.35); x.ellipse(hw * 0.4, -hh * 0.4, hw * 0.35, hh * 0.35, 0, 0, Math.PI * 2)
      x.moveTo(hw * 0.7, -hh * 0.45); x.lineTo(hw, -hh * 0.35); x.lineTo(hw * 0.7, -hh * 0.25)
      x.moveTo(hw * 0.25, -hh * 0.72); x.arc(hw * 0.3, -hh * 0.8, hw * 0.1, 0, Math.PI * 2); x.arc(hw * 0.45, -hh * 0.82, hw * 0.1, 0, Math.PI * 2)
      break
    }
  }
}

function drawShape(tool: ToolId, x: CanvasRenderingContext2D, a: P, b: P, shift: boolean) {
  const o = ts.opts
  if (tool === 'shape-line') {
    let ex = b.x, ey = b.y
    if (shift) { const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4); const len = Math.hypot(b.x - a.x, b.y - a.y); ex = a.x + Math.cos(ang) * len; ey = a.y + Math.sin(ang) * len }
    x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(ex, ey)
    x.lineWidth = Math.max(1, o.strokeWidth); x.lineCap = 'round'; x.strokeStyle = usePhoto.getState().fg; x.stroke()
    return
  }
  const r = rectFrom(a, b, shift)
  x.save()
  x.translate(r.x + r.w / 2, r.y + r.h / 2)
  x.beginPath()
  if (tool === 'shape-rect') x.rect(-r.w / 2, -r.h / 2, r.w, r.h)
  else if (tool === 'shape-ellipse') x.ellipse(0, 0, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
  else if (tool === 'shape-triangle') shapePath(x, 'triangle', r.w, r.h)
  else if (tool === 'shape-polygon') shapePath(x, 'polygon', r.w, r.h, o.sides)
  else if (tool === 'shape-custom') customShapePath(x, o.customShape, r.w, r.h)
  if (o.shapeFill) { x.fillStyle = usePhoto.getState().fg; x.fill() }
  if (o.shapeStroke || !o.shapeFill) { x.lineWidth = Math.max(1, o.strokeWidth); x.lineJoin = 'round'; x.strokeStyle = o.shapeFill ? usePhoto.getState().bg : usePhoto.getState().fg; x.stroke() }
  x.restore()
}

/* ---- paths ---- */
export function pathToPath2D(p: VPath) {
  const path = new Path2D()
  const A = p.anchors
  if (!A.length) return path
  path.moveTo(A[0].x, A[0].y)
  const n = p.closed ? A.length : A.length - 1
  for (let i = 0; i < n; i++) {
    const a = A[i], b = A[(i + 1) % A.length]
    path.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y)
  }
  if (p.closed) path.closePath()
  return path
}
const anchor = (x: number, y: number): Anchor => ({ x, y, ix: x, iy: y, ox: x, oy: y, smooth: false })
function autoSmooth(p: VPath, i: number) {
  const A = p.anchors, a = A[i]
  const prev = A[i - 1] ?? (p.closed ? A[A.length - 1] : null), next = A[i + 1] ?? (p.closed ? A[0] : null)
  if (!prev || !next) { a.ix = a.x; a.iy = a.y; a.ox = a.x; a.oy = a.y; return }
  const tx = (next.x - prev.x) / 6, ty = (next.y - prev.y) / 6
  a.ix = a.x - tx; a.iy = a.y - ty; a.ox = a.x + tx; a.oy = a.y + ty; a.smooth = true
}
const activePath = () => doc.paths.find((p) => p.id === doc.activePath)
function hitAnchor(p: P, tol: number) {
  for (const path of doc.paths) for (const [i, a] of path.anchors.entries()) {
    if (Math.hypot(a.x - p.x, a.y - p.y) < tol) return { path, i, part: 'anchor' as const }
  }
  const ap = activePath()
  if (ap) for (const [i, a] of ap.anchors.entries()) {
    if (Math.hypot(a.ix - p.x, a.iy - p.y) < tol) return { path: ap, i, part: 'in' as const }
    if (Math.hypot(a.ox - p.x, a.oy - p.y) < tol) return { path: ap, i, part: 'out' as const }
  }
  return null
}
function bez(a: Anchor, b: Anchor, t: number): P {
  const mt = 1 - t
  return {
    x: mt ** 3 * a.x + 3 * mt * mt * t * a.ox + 3 * mt * t * t * b.ix + t ** 3 * b.x,
    y: mt ** 3 * a.y + 3 * mt * mt * t * a.oy + 3 * mt * t * t * b.iy + t ** 3 * b.y,
  }
}
function hitSegment(p: P, tol: number) {
  for (const path of doc.paths) {
    const A = path.anchors, n = path.closed ? A.length : A.length - 1
    for (let i = 0; i < n; i++) for (let k = 1; k < 30; k++) {
      const q = bez(A[i], A[(i + 1) % A.length], k / 30)
      if (Math.hypot(q.x - p.x, q.y - p.y) < tol) return { path, i, t: k / 30 }
    }
  }
  return null
}
export function pathMask(p: VPath): Mask { return shapeMask((x) => x.fill(pathToPath2D(p))) }

/* ---- text ---- */
export function commitText(text: string) {
  const t = ts.typing
  ts.typing = null
  if (!t || !text.trim()) { bump(); return }
  const o = ts.opts
  const font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.fontSize}px ${o.fontFamily}`
  const drawText = (x: CanvasRenderingContext2D) => {
    x.font = font; x.textBaseline = 'top'; x.fillStyle = usePhoto.getState().fg
    const lines = text.split('\n')
    if (t.vertical) {
      lines.forEach((line, col) => [...line].forEach((ch, row) => {
        const w = x.measureText(ch).width
        x.fillText(ch, t.x + col * o.fontSize * 1.2 + (o.fontSize - w) / 2, t.y + row * o.fontSize * 1.1)
      }))
    } else lines.forEach((line, i) => x.fillText(line, t.x, t.y + i * o.fontSize * 1.2))
  }
  if (t.mask) {
    const m = shapeMask(drawText)
    applySelection(m, ts.opts.selMode, 'Type mask')
    return
  }
  const l = doc.addLayer('T ' + text.split('\n')[0].slice(0, 24))
  drawText(ctx2d(l.canvas))
  doc.commit('Type')
}

/* ======================= main dispatch ======================= */
export function onDown(p: P, e: PointerEvent, zoom: number) {
  const tool = ts.tool
  const o = ts.opts
  ts.start = p; ts.last = p
  const tol = 8 / zoom
  const l = doc.layer
  if (BRUSH_TOOLS.includes(tool) && tool !== 'quick-select' && l.locked && !usePhoto.getState().quickMask && tool !== 'selection-brush') { notify('Layer is locked'); return }

  switch (tool) {
    case 'eyedropper': eyedrop(p, e.altKey); return
    case 'eyedropper-3d': eyedrop(p, e.altKey, 11); notify('Sampled material colour (11×11 average)'); return
    case 'color-sampler': {
      if (e.altKey) { const i = doc.samplers.findIndex((s) => Math.hypot(s.x - p.x, s.y - p.y) < tol * 2); if (i >= 0) doc.samplers.splice(i, 1) }
      else if (doc.samplers.length < 10) doc.samplers.push({ x: Math.round(p.x), y: Math.round(p.y) })
      else notify('Maximum of 10 colour samplers')
      bump(); return
    }
    case 'note': {
      const i = doc.notes.findIndex((n) => Math.hypot(n.x - p.x, n.y - p.y) < 16 / zoom)
      if (i >= 0) {
        const t = prompt('Edit note (leave empty to delete):', doc.notes[i].text)
        if (t === null) return
        if (!t) doc.notes.splice(i, 1); else doc.notes[i].text = t
      } else {
        const t = prompt('Note text:')
        if (t) doc.notes.push({ x: p.x, y: p.y, text: t })
      }
      bump(true); return
    }
    case 'count': {
      if (e.altKey) {
        let bi = -1, bd = Infinity
        doc.counts.forEach((c, i) => { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; bi = i } })
        if (bi >= 0) doc.counts.splice(bi, 1)
      } else doc.counts.push({ x: p.x, y: p.y })
      bump(true); return
    }
    case 'magic-wand': {
      const m = floodMask(sampleSource(), p.x, p.y, o.tolerance, o.contiguous)
      applySelection(m, selModeFromEvent(e), 'Magic Wand'); return
    }
    case 'magic-eraser': {
      if (l.locked) return notify('Layer is locked')
      const m = floodMask(sampleSource(), p.x, p.y, o.tolerance, o.contiguous)
      fillMaskWithColor(m, 'Magic Eraser', true); return
    }
    case 'bucket': {
      if (l.locked) return notify('Layer is locked')
      const m = floodMask(sampleSource(), p.x, p.y, o.tolerance, o.contiguous)
      fillMaskWithColor(m, 'Paint Bucket'); return
    }
    case 'red-eye': {
      const d = doc.layerData()
      const R = Math.max(8, o.size)
      let n = 0
      for (let y = Math.max(0, Math.round(p.y - R)); y < Math.min(doc.height, p.y + R); y++) for (let x = Math.max(0, Math.round(p.x - R)); x < Math.min(doc.width, p.x + R); x++) {
        if (Math.hypot(x - p.x, y - p.y) > R) continue
        const i = (y * doc.width + x) * 4
        const r = d.data[i], g = d.data[i + 1], b = d.data[i + 2]
        const gb = (g + b) / 2
        if (r > 60 && r > gb * 1.4) { d.data[i] = gb * 0.8; d.data[i + 1] = g * 0.8; d.data[i + 2] = b * 0.8; n++ }
      }
      ctx2d(l.canvas).putImageData(d, 0, 0)
      doc.commit('Red Eye', [l.id])
      if (!n) notify('No red pixels found. Increase brush size in the options bar.')
      return
    }
    case 'marquee-row': applySelection(shapeMask((x) => x.fillRect(0, Math.floor(p.y), doc.width, 1)), selModeFromEvent(e), 'Single Row Marquee'); return
    case 'marquee-col': applySelection(shapeMask((x) => x.fillRect(Math.floor(p.x), 0, 1, doc.height)), selModeFromEvent(e), 'Single Column Marquee'); return
    case 'lasso-poly': case 'lasso-magnetic': {
      if (ts.points.length > 2 && (Math.hypot(ts.points[0].x - p.x, ts.points[0].y - p.y) < tol * 1.5 || e.detail >= 2)) {
        applySelection(polyMask(ts.points), selModeFromEvent(e), tool === 'lasso-poly' ? 'Polygonal Lasso' : 'Magnetic Lasso')
        ts.points = []; return
      }
      if (tool === 'lasso-magnetic' && !ts.grad) ts.grad = gradientMap(doc.compositeData())
      ts.points.push(tool === 'lasso-magnetic' ? snapEdge(p) : p)
      bump(); return
    }
    case 'pen': case 'pen-curvature': {
      let path = activePath()
      if (path && !path.closed && path.anchors.length > 1 && Math.hypot(path.anchors[0].x - p.x, path.anchors[0].y - p.y) < tol) {
        path.closed = true
        if (tool === 'pen-curvature') path.anchors.forEach((_, i) => autoSmooth(path!, i))
        doc.activePath = null; bump(true); return
      }
      if (!path || path.closed) {
        path = { id: nanoid(6), name: `Path ${doc.paths.length + 1}`, anchors: [], closed: false }
        doc.paths.push(path); doc.activePath = path.id
      }
      path.anchors.push(anchor(p.x, p.y))
      if (tool === 'pen-curvature') path.anchors.forEach((_, i) => autoSmooth(path!, i))
      else ts.pathDrag = { kind: 'newhandle', pathId: path.id, idx: path.anchors.length - 1 }
      bump(); return
    }
    case 'pen-free': {
      const path: VPath = { id: nanoid(6), name: `Path ${doc.paths.length + 1}`, anchors: [anchor(p.x, p.y)], closed: false }
      doc.paths.push(path); doc.activePath = path.id
      ts.points = [p]; return
    }
    case 'anchor-add': {
      const h = hitSegment(p, tol)
      if (h) { const a = anchor(p.x, p.y); h.path.anchors.splice(h.i + 1, 0, a); autoSmooth(h.path, h.i + 1); doc.activePath = h.path.id; bump(true) }
      return
    }
    case 'anchor-delete': {
      const h = hitAnchor(p, tol)
      if (h && h.part === 'anchor') { h.path.anchors.splice(h.i, 1); if (!h.path.anchors.length) doc.paths = doc.paths.filter((x) => x !== h.path); bump(true) }
      return
    }
    case 'anchor-convert': {
      const h = hitAnchor(p, tol)
      if (h && h.part === 'anchor') {
        doc.activePath = h.path.id
        const a = h.path.anchors[h.i]
        if (a.smooth) { a.ix = a.x; a.iy = a.y; a.ox = a.x; a.oy = a.y; a.smooth = false } else autoSmooth(h.path, h.i)
        ts.pathDrag = { kind: 'newhandle', pathId: h.path.id, idx: h.i }
        bump(true)
      }
      return
    }
    case 'path-select': {
      const h = hitSegment(p, tol * 1.5) ?? (hitAnchor(p, tol) as null | { path: VPath })
      if (h) { doc.activePath = h.path.id; ts.pathDrag = { kind: 'path', pathId: h.path.id, idx: 0, orig: JSON.parse(JSON.stringify(h.path)) } } else doc.activePath = null
      bump(); return
    }
    case 'direct-select': {
      const h = hitAnchor(p, tol)
      if (h) { doc.activePath = h.path.id; ts.pathDrag = { kind: h.part, pathId: h.path.id, idx: h.i } }
      else { const s = hitSegment(p, tol); doc.activePath = s ? s.path.id : null }
      bump(); return
    }
    case 'type-h': case 'type-v': case 'type-mask-h': case 'type-mask-v':
      ts.typing = { x: p.x, y: p.y, vertical: tool.endsWith('-v'), mask: tool.includes('mask') }
      bump(); return
    case 'crop-perspective': {
      const i = ts.quad.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < tol * 1.5)
      if (i >= 0) { ts.sliceDrag = { i, ox: 0, oy: 0 }; return }
      if (ts.quad.length < 4) ts.quad.push(p)
      bump(); return
    }
    case 'slice-select': {
      const i = doc.slices.findIndex((s) => p.x >= s.x && p.y >= s.y && p.x <= s.x + s.w && p.y <= s.y + s.h)
      doc.activeSlice = i
      if (i >= 0) ts.sliceDrag = { i, ox: p.x - doc.slices[i].x, oy: p.y - doc.slices[i].y }
      bump(); return
    }
    case 'heal': case 'clone-stamp':
      if (e.altKey) { ts.cloneSrc = p; ts.cloneOffset = null; notify('Source set'); bump(); return }
      break
    case 'patch': case 'content-move': {
      const inside = doc.selection && doc.selAt(p.x, p.y) > 127
      ts.patchMode = inside ? 'drag' : 'draw'
      ts.points = [p]
      return
    }
    case 'move': {
      if (l.locked) return notify('Layer is locked')
      const base = makeCanvas(doc.width, doc.height), bx = ctx2d(base)
      bx.drawImage(l.canvas, 0, 0)
      const fl = makeCanvas(doc.width, doc.height), fx = ctx2d(fl)
      fx.drawImage(l.canvas, 0, 0)
      const sc = doc.selectionCanvas()
      if (sc) {
        fx.globalCompositeOperation = 'destination-in'; fx.drawImage(sc, 0, 0)
        bx.globalCompositeOperation = 'destination-out'; bx.drawImage(sc, 0, 0)
      } else bx.clearRect(0, 0, doc.width, doc.height)
      ts.floating = { canvas: fl, base, dx: 0, dy: 0, selection: doc.selection }
      return
    }
  }
  if (BRUSH_TOOLS.includes(tool) && tool !== 'quick-select') {
    let from = p
    if (e.shiftKey && ts.lastPaint && tool !== 'selection-brush') from = ts.lastPaint
    ts.stroke = buildStroke(tool, from, e)
    if (ts.stroke) {
      if (from !== p) ts.stroke.line(from, p); else ts.stroke.dab(p.x, p.y)
      ts.stroke.flush(); bump()
    }
    return
  }
  if (tool === 'quick-select') { quickSelectAt(p, e); return }
}

function quickSelectAt(p: P, e: PointerEvent | MouseEvent) {
  const src = ts.qsSrc ?? (ts.qsSrc = sampleSource())
  const R = ts.opts.size
  // region-grow from brush centre with adaptive tolerance, limited to neighbourhood
  const limit = new Uint8ClampedArray(doc.width * doc.height)
  const L = R * 4
  for (let y = Math.max(0, Math.round(p.y - L)); y < Math.min(doc.height, p.y + L); y++)
    for (let x = Math.max(0, Math.round(p.x - L)); x < Math.min(doc.width, p.x + L); x++) limit[y * doc.width + x] = 255
  const m = floodMask(src, p.x, p.y, Math.max(18, ts.opts.tolerance), true, limit)
  const brush = shapeMask((x) => { x.beginPath(); x.arc(p.x, p.y, R / 2, 0, Math.PI * 2); x.fill() })
  for (let i = 0; i < m.length; i++) m[i] = Math.max(m[i], brush[i])
  const mode = e.altKey ? 'subtract' : doc.selection ? 'add' : 'new'
  doc.setSelection(combineMasks(doc.selection, m, mode))
  bump()
}

function snapEdge(p: P): P {
  const g = ts.grad
  if (!g) return p
  const R = 8
  let best = p, bv = -1
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = Math.round(p.x + dx), y = Math.round(p.y + dy)
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) continue
    const v = g[y * doc.width + x] - Math.hypot(dx, dy) * 2
    if (v > bv) { bv = v; best = { x, y } }
  }
  return best
}

export function onMove(p: P, e: PointerEvent, zoom: number) {
  ts.cursor = p
  const tool = ts.tool
  if (tool === 'lasso-magnetic' && ts.points.length) {
    const last = ts.points[ts.points.length - 1]
    if (Math.hypot(last.x - p.x, last.y - p.y) > 10 / zoom) ts.points.push(snapEdge(p))
    bump(); return
  }
  if (!ts.start) { if (tool === 'lasso-poly' || BRUSH_TOOLS.includes(tool) || ts.quad.length) bump(); return }
  const a = ts.start
  switch (tool) {
    case 'marquee-rect': case 'marquee-ellipse': case 'crop': case 'artboard': case 'slice': case 'object-select': case 'frame':
      ts.rect = rectFrom(a, p, e.shiftKey && (tool === 'marquee-rect' || tool === 'marquee-ellipse'))
      if (tool === 'crop' || tool === 'artboard') ts.crop = ts.rect
      bump(); return
    case 'lasso': case 'pen-free': ts.points.push(p); bump(); return
    case 'gradient': case 'ruler': case 'shape-rect': case 'shape-ellipse': case 'shape-triangle': case 'shape-polygon': case 'shape-line': case 'shape-custom':
      ts.line = { a, b: p }
      if (tool === 'ruler') doc.ruler = { x1: a.x, y1: a.y, x2: p.x, y2: p.y }
      bump(); return
    case 'patch': case 'content-move':
      ts.points.push(p); bump(); return
    case 'move':
      if (ts.floating) {
        const f = ts.floating
        f.dx = Math.round(p.x - a.x); f.dy = Math.round(p.y - a.y)
        const x = ctx2d(doc.layer.canvas)
        x.clearRect(0, 0, doc.width, doc.height); x.drawImage(f.base, 0, 0); x.drawImage(f.canvas, f.dx, f.dy)
        bump()
      }
      return
    case 'crop-perspective':
      if (ts.sliceDrag) { ts.quad[ts.sliceDrag.i] = p; bump() }
      return
    case 'slice-select':
      if (ts.sliceDrag && ts.sliceDrag.i >= 0) { const s = doc.slices[ts.sliceDrag.i]; s.x = Math.round(p.x - ts.sliceDrag.ox); s.y = Math.round(p.y - ts.sliceDrag.oy); bump() }
      return
    case 'quick-select': quickSelectAt(p, e); return
  }
  if (ts.pathDrag) {
    const path = doc.paths.find((x) => x.id === ts.pathDrag!.pathId)
    if (!path) return
    const d = ts.pathDrag
    const an = path.anchors[d.idx]
    if (d.kind === 'newhandle') {
      if (Math.hypot(p.x - an.x, p.y - an.y) > 3 / zoom) { an.ox = p.x; an.oy = p.y; an.ix = 2 * an.x - p.x; an.iy = 2 * an.y - p.y; an.smooth = true }
    } else if (d.kind === 'anchor') {
      const dx = p.x - an.x, dy = p.y - an.y
      an.x += dx; an.y += dy; an.ix += dx; an.iy += dy; an.ox += dx; an.oy += dy
    } else if (d.kind === 'in') { an.ix = p.x; an.iy = p.y; if (an.smooth && !e.altKey) { an.ox = 2 * an.x - p.x; an.oy = 2 * an.y - p.y } }
    else if (d.kind === 'out') { an.ox = p.x; an.oy = p.y; if (an.smooth && !e.altKey) { an.ix = 2 * an.x - p.x; an.iy = 2 * an.y - p.y } }
    else if (d.kind === 'path' && d.orig) {
      const dx = p.x - a.x, dy = p.y - a.y
      path.anchors = d.orig.anchors.map((q) => ({ ...q, x: q.x + dx, y: q.y + dy, ix: q.ix + dx, iy: q.iy + dy, ox: q.ox + dx, oy: q.oy + dy }))
    }
    bump(); return
  }
  if (ts.stroke) {
    ts.stroke.line(ts.last!, p)
    ts.stroke.flush()
    ts.last = p
    bump()
  }
}

export async function onUp(p: P, e: PointerEvent) {
  const tool = ts.tool
  const a = ts.start
  ts.start = null
  if (!a) return
  const l = doc.layer
  const r = ts.rect
  switch (tool) {
    case 'marquee-rect': case 'marquee-ellipse': {
      ts.rect = null
      if (!r || r.w < 2 || r.h < 2) { if (selModeFromEvent(e) === 'new') { doc.setSelection(null); doc.commit('Deselect', []) } return }
      const m = shapeMask((x) => { x.beginPath(); if (tool === 'marquee-rect') x.rect(r.x, r.y, r.w, r.h); else x.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); x.fill() })
      applySelection(m, selModeFromEvent(e), tool === 'marquee-rect' ? 'Rectangular Marquee' : 'Elliptical Marquee'); return
    }
    case 'lasso': {
      if (ts.points.length > 2) applySelection(polyMask(ts.points), selModeFromEvent(e), 'Lasso')
      ts.points = []; return
    }
    case 'object-select': {
      ts.rect = null
      if (!r || r.w < 8 || r.h < 8) return
      notify('Finding object…')
      await new Promise((res) => setTimeout(res, 20))
      applySelection(objectSelect(sampleSource(), r.x, r.y, r.w, r.h), selModeFromEvent(e), 'Object Selection'); return
    }
    case 'quick-select': ts.qsSrc = null; doc.commit('Quick Selection', []); return
    case 'slice': {
      ts.rect = null
      if (r && r.w > 4 && r.h > 4) { doc.slices.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }); doc.activeSlice = doc.slices.length - 1 }
      bump(true); return
    }
    case 'slice-select': ts.sliceDrag = null; bump(true); return
    case 'crop-perspective': ts.sliceDrag = null; return
    case 'frame': {
      ts.rect = null
      if (!r || r.w < 8 || r.h < 8) return
      const fl = doc.addLayer('Frame')
      fl.frame = { x: r.x, y: r.y, w: r.w, h: r.h, shape: ts.opts.frameShape }
      drawFramePlaceholder(fl.canvas, fl.frame)
      doc.commit('Frame'); return
    }
    case 'gradient': {
      if (l.locked) return notify('Layer is locked')
      ts.line = null
      if (Math.hypot(p.x - a.x, p.y - a.y) > 2) paintGradient(a, p)
      return
    }
    case 'ruler': ts.line = null; bump(); return
    case 'shape-rect': case 'shape-ellipse': case 'shape-triangle': case 'shape-polygon': case 'shape-line': case 'shape-custom': {
      ts.line = null
      if (Math.hypot(p.x - a.x, p.y - a.y) < 3) return
      const names: Record<string, string> = { 'shape-rect': 'Rectangle', 'shape-ellipse': 'Ellipse', 'shape-triangle': 'Triangle', 'shape-polygon': 'Polygon', 'shape-line': 'Line', 'shape-custom': ts.opts.customShape }
      const nl = doc.addLayer(names[tool] + ' ' + doc.layers.length)
      drawShape(tool, ctx2d(nl.canvas), a, p, e.shiftKey)
      doc.commit(names[tool]); return
    }
    case 'pen-free': {
      const path = activePath()
      if (path && ts.points.length > 2) {
        const step = Math.max(1, Math.floor(ts.points.length / 40))
        path.anchors = ts.points.filter((_, i) => i % step === 0).map((q) => anchor(q.x, q.y))
        path.anchors.forEach((_, i) => autoSmooth(path, i))
      }
      ts.points = []; doc.activePath = null; bump(true); return
    }
    case 'pen': case 'anchor-convert': case 'direct-select': case 'path-select': ts.pathDrag = null; bump(true); return
    case 'move': {
      const f = ts.floating
      ts.floating = null
      if (!f) return
      if (f.selection && (f.dx || f.dy)) {
        const m = new Uint8ClampedArray(doc.width * doc.height)
        for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
          const sx = x - f.dx, sy = y - f.dy
          if (sx >= 0 && sy >= 0 && sx < doc.width && sy < doc.height) m[y * doc.width + x] = f.selection[sy * doc.width + sx]
        }
        doc.setSelection(m)
      }
      if (l.frame) { l.frame.x += f.dx; l.frame.y += f.dy }
      if (f.dx || f.dy) doc.commit('Move', [l.id]); return
    }
    case 'patch': case 'content-move': {
      const pts = ts.points
      ts.points = []
      if (ts.patchMode === 'draw') {
        if (pts.length > 2) applySelection(polyMask(pts), 'new', tool === 'patch' ? 'Patch selection' : 'Move selection')
        ts.patchMode = null; return
      }
      ts.patchMode = null
      const dx = Math.round(p.x - a.x), dy = Math.round(p.y - a.y)
      if (!doc.selection || (!dx && !dy)) return
      notify(tool === 'patch' ? 'Patching…' : 'Moving & filling…')
      await new Promise((res) => setTimeout(res, 20))
      patchOrMove(tool, dx, dy)
      return
    }
  }
  if (ts.stroke) {
    const s = ts.stroke
    ts.stroke = null
    ts.lastPaint = p
    if (tool === 'remove' || tool === 'spot-heal') {
      const pm = ts.paintMask!
      ts.paintMask = null
      let m = maskFromCanvas(pm)
      if (doc.selection) for (let i = 0; i < m.length; i++) m[i] = Math.min(m[i], doc.selection[i])
      m = blurMask(m, doc.width, doc.height, tool === 'spot-heal' ? 2 : 1)
      for (let i = 0; i < m.length; i++) m[i] = m[i] > 10 ? Math.min(255, m[i] * 2) : 0
      notify(tool === 'remove' ? 'Removing…' : 'Healing…')
      await new Promise((res) => setTimeout(res, 20))
      const d = doc.layerData()
      inpaint(d, m)
      ctx2d(l.canvas).putImageData(d, 0, 0)
      doc.commit(tool === 'remove' ? 'Remove' : 'Spot Healing', [l.id])
      return
    }
    if (s.onMask) { doc.commit(tool === 'selection-brush' ? 'Selection Brush' : 'Quick Mask paint', []); return }
    s.flush()
    const names: Partial<Record<ToolId, string>> = { brush: 'Brush', pencil: 'Pencil', eraser: 'Eraser', 'bg-eraser': 'Background Eraser', 'clone-stamp': 'Clone Stamp', heal: 'Healing Brush', 'pattern-stamp': 'Pattern Stamp', 'history-brush': 'History Brush', 'art-history': 'Art History Brush', 'color-replace': 'Color Replacement', 'mixer-brush': 'Mixer Brush', 'adjust-brush': 'Adjustment Brush', blur: 'Blur', sharpen: 'Sharpen', smudge: 'Smudge', dodge: 'Dodge', burn: 'Burn', sponge: 'Sponge' }
    doc.commit(names[tool] ?? tool, [l.id])
  }
}

function patchOrMove(tool: ToolId, dx: number, dy: number) {
  const l = doc.layer
  const sel = doc.selection!
  const W = doc.width, H = doc.height
  const d = doc.layerData()
  const src = Uint8ClampedArray.from(d.data)
  if (tool === 'patch') {
    // replace selection with content at offset, colour-corrected to the border
    let tr = 0, tg = 0, tb = 0, sr = 0, sg = 0, sb = 0, n = 0
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x
      if (sel[p] < 128 || (sel[p - 1] >= 128 && sel[p + 1] >= 128 && sel[p - W] >= 128 && sel[p + W] >= 128)) continue
      const sx = x + dx, sy = y + dy
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue
      const i = p * 4, j = (sy * W + sx) * 4
      tr += src[i]; tg += src[i + 1]; tb += src[i + 2]; sr += src[j]; sg += src[j + 1]; sb += src[j + 2]; n++
    }
    const cr = n ? (tr - sr) / n : 0, cg = n ? (tg - sg) / n : 0, cb = n ? (tb - sb) / n : 0
    const soft = blurMask(sel, W, H, 3)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x
      if (!soft[p]) continue
      const sx = x + dx, sy = y + dy
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue
      const i = p * 4, j = (sy * W + sx) * 4, t = soft[p] / 255
      d.data[i] = src[i] + (src[j] + cr - src[i]) * t
      d.data[i + 1] = src[i + 1] + (src[j + 1] + cg - src[i + 1]) * t
      d.data[i + 2] = src[i + 2] + (src[j + 2] + cb - src[i + 2]) * t
    }
    ctx2d(l.canvas).putImageData(d, 0, 0)
    doc.commit('Patch', [l.id])
  } else {
    // content-aware move: fill hole, then paste moved content
    const hole = Uint8ClampedArray.from(sel, (v) => (v > 20 ? 255 : 0))
    inpaint(d, morphMask(hole, W, H))
    const soft = blurMask(sel, W, H, 2)
    const out = d.data
    const newSel = new Uint8ClampedArray(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sx = x - dx, sy = y - dy
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue
      const sp = sy * W + sx
      if (!soft[sp]) continue
      const i = (y * W + x) * 4, j = sp * 4, t = soft[sp] / 255
      for (let c = 0; c < 4; c++) out[i + c] = out[i + c] + (src[j + c] - out[i + c]) * t
      newSel[y * W + x] = sel[sp]
    }
    ctx2d(l.canvas).putImageData(d, 0, 0)
    doc.setSelection(newSel)
    doc.commit('Content-Aware Move', [l.id])
  }
}
function morphMask(m: Mask, w: number, h: number) {
  const out = Uint8ClampedArray.from(m)
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x
    if (!m[p] && (m[p - 1] || m[p + 1] || m[p - w] || m[p + w])) out[p] = 255
  }
  return out
}

export function drawFramePlaceholder(c: HTMLCanvasElement, f: NonNullable<import('./doc').Layer['frame']>, img?: CanvasImageSource & { width: number; height: number }) {
  const x = ctx2d(c)
  x.clearRect(0, 0, c.width, c.height)
  x.save()
  x.beginPath()
  if (f.shape === 'ellipse') x.ellipse(f.x + f.w / 2, f.y + f.h / 2, f.w / 2, f.h / 2, 0, 0, Math.PI * 2); else x.rect(f.x, f.y, f.w, f.h)
  x.clip()
  if (img) {
    const r = Math.max(f.w / img.width, f.h / img.height)
    x.drawImage(img, f.x + (f.w - img.width * r) / 2, f.y + (f.h - img.height * r) / 2, img.width * r, img.height * r)
  } else {
    x.fillStyle = '#d8d8de'; x.fill()
    x.strokeStyle = '#9a9aab'; x.lineWidth = 2
    x.beginPath(); x.moveTo(f.x, f.y); x.lineTo(f.x + f.w, f.y + f.h); x.moveTo(f.x + f.w, f.y); x.lineTo(f.x, f.y + f.h); x.stroke()
  }
  x.restore()
}

/** Enter key / ✓ button: commit pending operations. */
export function applyPending() {
  const tool = ts.tool
  if ((tool === 'crop' || tool === 'artboard') && ts.crop) {
    const c = ts.crop
    ts.crop = null
    if (c.w < 2 || c.h < 2) return
    doc.resizeCanvas(c.x, c.y, c.w, c.h, tool === 'artboard' ? '#ffffff' : undefined)
    doc.commit(tool === 'crop' ? 'Crop' : 'Artboard')
    return true
  }
  if (tool === 'crop-perspective' && ts.quad.length === 4) {
    const q = ts.quad.map((p) => [p.x, p.y] as [number, number])
    const w = Math.round((Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) + Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1])) / 2)
    const h = Math.round((Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) + Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1])) / 2)
    for (const l of doc.layers) {
      const out = warpPerspective(doc.layerData(l), q, w, h)
      const c = makeCanvas(w, h); ctx2d(c).putImageData(out, 0, 0); l.canvas = c
    }
    doc.width = w; doc.height = h
    doc.setSelection(null)
    ts.quad = []
    doc.commit('Perspective Crop')
    return true
  }
  if ((tool === 'lasso-poly' || tool === 'lasso-magnetic') && ts.points.length > 2) {
    applySelection(polyMask(ts.points), ts.opts.selMode, 'Lasso'); ts.points = []; return true
  }
  if (tool === 'pen' || tool === 'pen-curvature') { doc.activePath = null; bump(true); return true }
  return false
}

export function straightenFromRuler() {
  const r = doc.ruler
  if (!r) return notify('Draw a line with the Ruler first')
  let ang = Math.atan2(r.y2 - r.y1, r.x2 - r.x1)
  if (Math.abs(ang) > Math.PI / 4) ang = ang - Math.sign(ang) * Math.PI / 2
  const l = doc.layer
  const c = makeCanvas(doc.width, doc.height), x = ctx2d(c)
  x.translate(doc.width / 2, doc.height / 2); x.rotate(-ang); x.translate(-doc.width / 2, -doc.height / 2)
  x.drawImage(l.canvas, 0, 0)
  l.canvas = c
  doc.ruler = null
  doc.commit('Straighten', [l.id])
}

/* ======================= overlay drawing ======================= */
export function drawOverlay(x: CanvasRenderingContext2D, zoom: number, phase: number) {
  const px = 1 / zoom
  x.lineWidth = px
  // slices
  doc.slices.forEach((s, i) => {
    x.strokeStyle = i === doc.activeSlice ? '#ffb000' : '#3d8bff'
    x.lineWidth = px * (i === doc.activeSlice ? 2 : 1)
    x.strokeRect(s.x, s.y, s.w, s.h)
    x.fillStyle = x.strokeStyle; x.font = `${11 * px}px sans-serif`
    x.fillRect(s.x, s.y, 18 * px, 14 * px); x.fillStyle = '#fff'; x.fillText(String(i + 1).padStart(2, '0'), s.x + 3 * px, s.y + 11 * px)
  })
  x.lineWidth = px
  // paths
  for (const p of doc.paths) {
    const active = p.id === doc.activePath
    x.strokeStyle = active ? '#3d8bff' : '#3d8bff99'
    x.lineWidth = px * (active ? 1.5 : 1)
    x.stroke(pathToPath2D(p))
    if (active || ['direct-select', 'anchor-add', 'anchor-delete', 'anchor-convert', 'pen', 'pen-curvature'].includes(ts.tool)) {
      for (const a of p.anchors) {
        if (active && a.smooth) {
          x.strokeStyle = '#3d8bff88'; x.beginPath(); x.moveTo(a.ix, a.iy); x.lineTo(a.ox, a.oy); x.stroke()
          x.fillStyle = '#3d8bff'; for (const [hx, hy] of [[a.ix, a.iy], [a.ox, a.oy]]) { x.beginPath(); x.arc(hx, hy, 3 * px, 0, 7); x.fill() }
        }
        x.fillStyle = active ? '#fff' : '#3d8bff'; x.strokeStyle = '#3d8bff'
        x.fillRect(a.x - 3.5 * px, a.y - 3.5 * px, 7 * px, 7 * px); x.strokeRect(a.x - 3.5 * px, a.y - 3.5 * px, 7 * px, 7 * px)
      }
    }
  }
  // pen preview line
  const ap = activePath()
  if (ap && !ap.closed && ts.cursor && (ts.tool === 'pen' || ts.tool === 'pen-curvature') && ap.anchors.length) {
    const last = ap.anchors[ap.anchors.length - 1]
    x.strokeStyle = '#3d8bff88'; x.setLineDash([4 * px, 4 * px]); x.beginPath(); x.moveTo(last.x, last.y); x.lineTo(ts.cursor.x, ts.cursor.y); x.stroke(); x.setLineDash([])
  }
  // marquee/crop rect
  if (ts.rect) {
    x.setLineDash([5 * px, 5 * px]); x.lineDashOffset = -phase * 2 * px; x.strokeStyle = '#000'
    if (ts.tool === 'marquee-ellipse') { x.beginPath(); x.ellipse(ts.rect.x + ts.rect.w / 2, ts.rect.y + ts.rect.h / 2, ts.rect.w / 2, ts.rect.h / 2, 0, 0, 7); x.stroke(); x.strokeStyle = '#fff'; x.lineDashOffset += 5 * px; x.stroke() }
    else { x.strokeRect(ts.rect.x, ts.rect.y, ts.rect.w, ts.rect.h); x.strokeStyle = '#fff'; x.lineDashOffset += 5 * px; x.strokeRect(ts.rect.x, ts.rect.y, ts.rect.w, ts.rect.h) }
    x.setLineDash([])
  }
  if (ts.crop && (ts.tool === 'crop' || ts.tool === 'artboard')) {
    const c = ts.crop
    x.fillStyle = '#000a'
    x.beginPath(); x.rect(-1e5, -1e5, 2e5, 2e5); x.rect(c.x, c.y, c.w, c.h); x.fill('evenodd')
    x.strokeStyle = '#fff'; x.lineWidth = px * 1.5; x.strokeRect(c.x, c.y, c.w, c.h)
    x.lineWidth = px; x.strokeStyle = '#fff6'
    for (let i = 1; i < 3; i++) { x.beginPath(); x.moveTo(c.x + (c.w * i) / 3, c.y); x.lineTo(c.x + (c.w * i) / 3, c.y + c.h); x.moveTo(c.x, c.y + (c.h * i) / 3); x.lineTo(c.x + c.w, c.y + (c.h * i) / 3); x.stroke() }
    x.fillStyle = '#fff'; x.font = `${12 * px}px sans-serif`; x.fillText(`${Math.round(c.w)} × ${Math.round(c.h)}  (Enter to apply)`, c.x + 4 * px, c.y - 6 * px)
  }
  if (ts.quad.length) {
    x.strokeStyle = '#fff'; x.fillStyle = '#3d8bff'
    x.beginPath(); ts.quad.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y))); if (ts.quad.length === 4) x.closePath(); else if (ts.cursor) x.lineTo(ts.cursor.x, ts.cursor.y)
    x.lineWidth = px * 1.5; x.stroke()
    ts.quad.forEach((q) => x.fillRect(q.x - 5 * px, q.y - 5 * px, 10 * px, 10 * px))
    if (ts.quad.length === 4) { x.fillStyle = '#fff'; x.font = `${12 * px}px sans-serif`; x.fillText('Enter to apply perspective crop', ts.quad[0].x, ts.quad[0].y - 8 * px) }
  }
  // lasso points
  if (ts.points.length && ['lasso', 'lasso-poly', 'lasso-magnetic', 'pen-free', 'patch', 'content-move'].includes(ts.tool)) {
    x.strokeStyle = '#000'; x.setLineDash([4 * px, 4 * px])
    x.beginPath(); ts.points.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y)))
    if ((ts.tool === 'lasso-poly' || ts.tool === 'lasso-magnetic') && ts.cursor) x.lineTo(ts.cursor.x, ts.cursor.y)
    if (ts.patchMode === 'drag' && ts.start) { /* drag preview */ }
    x.stroke(); x.strokeStyle = '#fff'; x.lineDashOffset = 4 * px; x.stroke(); x.setLineDash([]); x.lineDashOffset = 0
  }
  if (ts.patchMode === 'drag' && ts.start && ts.cursor) {
    x.strokeStyle = '#ff8a1f'; x.setLineDash([4 * px, 3 * px]); x.beginPath(); x.moveTo(ts.start.x, ts.start.y); x.lineTo(ts.cursor.x, ts.cursor.y); x.stroke(); x.setLineDash([])
    const sc = doc.selectionCanvas()
    if (sc) { x.globalAlpha = 0.5; x.drawImage(doc.antsCanvas(phase)!, ts.cursor.x - ts.start.x, ts.cursor.y - ts.start.y); x.globalAlpha = 1 }
  }
  // gradient/ruler/shape preview
  if (ts.line) {
    const { a, b } = ts.line
    if (ts.tool.startsWith('shape-')) {
      x.save(); x.globalAlpha = 0.7; drawShape(ts.tool, x, a, b, false); x.restore()
    } else if (ts.tool === 'gradient') {
      x.strokeStyle = '#fff'; x.lineWidth = 2 * px; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke()
      x.strokeStyle = '#000'; x.lineWidth = px; x.stroke()
    }
  }
  if (doc.ruler) {
    const r = doc.ruler
    x.strokeStyle = '#000'; x.lineWidth = px * 2; x.beginPath(); x.moveTo(r.x1, r.y1); x.lineTo(r.x2, r.y2); x.stroke()
    x.strokeStyle = '#fff'; x.lineWidth = px; x.stroke()
    for (const [cx, cy] of [[r.x1, r.y1], [r.x2, r.y2]]) { x.beginPath(); x.moveTo(cx - 6 * px, cy); x.lineTo(cx + 6 * px, cy); x.moveTo(cx, cy - 6 * px); x.lineTo(cx, cy + 6 * px); x.stroke() }
  }
  // remove/heal paint mask
  if (ts.paintMask) { x.globalAlpha = 0.45; x.drawImage(ts.paintMask, 0, 0); x.globalAlpha = 1 }
  // samplers, counts, notes
  doc.samplers.forEach((s, i) => {
    x.strokeStyle = '#fff'; x.lineWidth = 2 * px; x.beginPath(); x.arc(s.x, s.y, 5 * px, 0, 7); x.moveTo(s.x - 9 * px, s.y); x.lineTo(s.x + 9 * px, s.y); x.moveTo(s.x, s.y - 9 * px); x.lineTo(s.x, s.y + 9 * px); x.stroke()
    x.fillStyle = '#000'; x.font = `bold ${11 * px}px sans-serif`; x.fillText(String(i + 1), s.x + 7 * px, s.y + 14 * px)
  })
  doc.counts.forEach((c, i) => {
    x.fillStyle = '#ff2d55'; x.beginPath(); x.arc(c.x, c.y, 4 * px, 0, 7); x.fill()
    x.font = `bold ${14 * px}px sans-serif`; x.fillText(String(i + 1), c.x + 6 * px, c.y - 4 * px)
  })
  doc.notes.forEach((n) => {
    x.fillStyle = '#ffd400'; x.fillRect(n.x - 8 * px, n.y - 8 * px, 16 * px, 16 * px)
    x.strokeStyle = '#806a00'; x.strokeRect(n.x - 8 * px, n.y - 8 * px, 16 * px, 16 * px)
    if (ts.cursor && Math.hypot(ts.cursor.x - n.x, ts.cursor.y - n.y) < 12 * px) {
      x.font = `${12 * px}px sans-serif`; const w = x.measureText(n.text).width
      x.fillStyle = '#fffbe0'; x.fillRect(n.x + 12 * px, n.y - 10 * px, w + 12 * px, 20 * px); x.fillStyle = '#222'; x.fillText(n.text, n.x + 18 * px, n.y + 4 * px)
    }
  })
  // clone source marker
  if ((ts.tool === 'clone-stamp' || ts.tool === 'heal') && ts.cloneSrc) {
    const s = ts.cloneOffset && ts.cursor ? { x: ts.cursor.x + ts.cloneOffset.x, y: ts.cursor.y + ts.cloneOffset.y } : ts.cloneSrc
    x.strokeStyle = '#fff'; x.lineWidth = px; x.beginPath(); x.arc(s.x, s.y, ts.opts.size / 2, 0, 7); x.moveTo(s.x - 5 * px, s.y); x.lineTo(s.x + 5 * px, s.y); x.moveTo(s.x, s.y - 5 * px); x.lineTo(s.x, s.y + 5 * px); x.stroke()
  }
  // brush cursor
  if (ts.cursor && (BRUSH_TOOLS.includes(ts.tool) || ts.tool === 'red-eye')) {
    x.strokeStyle = '#000'; x.lineWidth = px; x.beginPath(); x.arc(ts.cursor.x, ts.cursor.y, Math.max(1, ts.opts.size / 2), 0, 7); x.stroke()
    x.strokeStyle = '#fff'; x.beginPath(); x.arc(ts.cursor.x, ts.cursor.y, Math.max(1, ts.opts.size / 2) + px, 0, 7); x.stroke()
  }
}

