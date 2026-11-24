import type { AnimLayer, AnimProp, AnimationDoc, ShapeType } from '../core/types'
import { identityMotion, loopMotion, presetMotion, sampleKeys } from '../core/anim'
import { peekImage, getImage } from '../core/media'

const PRESET_LEN = 0.6

export function layerValue(l: AnimLayer, prop: AnimProp, t: number) {
  return sampleKeys(l.keys[prop], t - l.start, l.base[prop] ?? (prop === 'path' || prop === 'x' || prop === 'y' || prop === 'rotation' || prop === 'blur' || prop === 'hue' ? 0 : 1))
}

const frameImgs = new Map<string, HTMLImageElement>()
function frameImage(dataUrl: string): HTMLImageElement | null {
  if (!dataUrl) return null
  let img = frameImgs.get(dataUrl)
  if (!img) {
    img = new Image()
    img.src = dataUrl
    frameImgs.set(dataUrl, img)
    if (frameImgs.size > 600) frameImgs.delete(frameImgs.keys().next().value!)
  }
  return img.complete ? img : null
}
/** Preload all drawing frames and images; await before export. */
export async function preloadAnimation(a: AnimationDoc) {
  const ps: Promise<unknown>[] = []
  for (const l of a.layers) {
    if (l.kind === 'drawing') for (const f of l.frames ?? []) {
      if (!f.dataUrl) continue
      const img = new Image(); img.src = f.dataUrl; frameImgs.set(f.dataUrl, img)
      ps.push(img.decode().catch(() => 0))
    }
    if (l.kind === 'image' && l.mediaId) ps.push(getImage(l.mediaId))
  }
  await Promise.all(ps)
}

export function drawingFrameIndex(l: AnimLayer, t: number, fps: number) {
  const frames = l.frames ?? []
  if (!frames.length) return -1
  const total = frames.reduce((s, f) => s + Math.max(1, f.hold), 0)
  let n = Math.floor((t - l.start) * fps) % total
  if (n < 0) n += total
  for (let i = 0; i < frames.length; i++) {
    n -= Math.max(1, frames[i].hold)
    if (n < 0) return i
  }
  return frames.length - 1
}

export function shapePath(ctx: CanvasRenderingContext2D | Path2D, shape: ShapeType, w: number, h: number, sides = 5) {
  const p = ctx
  const hw = w / 2, hh = h / 2
  switch (shape) {
    case 'rect': p.rect(-hw, -hh, w, h); break
    case 'ellipse': p.ellipse(0, 0, Math.abs(hw), Math.abs(hh), 0, 0, Math.PI * 2); break
    case 'triangle': p.moveTo(0, -hh); p.lineTo(hw, hh); p.lineTo(-hw, hh); p.closePath(); break
    case 'polygon': for (let i = 0; i < sides; i++) { const a = -Math.PI / 2 + (i * Math.PI * 2) / sides; const fn = i ? 'lineTo' : 'moveTo'; p[fn](Math.cos(a) * hw, Math.sin(a) * hh) } p.closePath(); break
    case 'star': for (let i = 0; i < sides * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / sides; const r = i % 2 ? 0.45 : 1; const fn = i ? 'lineTo' : 'moveTo'; p[fn](Math.cos(a) * hw * r, Math.sin(a) * hh * r) } p.closePath(); break
    case 'heart': {
      p.moveTo(0, hh * 0.9)
      p.bezierCurveTo(-hw * 1.4, -hh * 0.1, -hw * 0.6, -hh * 1.2, 0, -hh * 0.45)
      p.bezierCurveTo(hw * 0.6, -hh * 1.2, hw * 1.4, -hh * 0.1, 0, hh * 0.9)
      p.closePath(); break
    }
    case 'line': p.moveTo(-hw, 0); p.lineTo(hw, 0); break
    case 'arrow': p.moveTo(-hw, -hh * 0.3); p.lineTo(hw * 0.3, -hh * 0.3); p.lineTo(hw * 0.3, -hh); p.lineTo(hw, 0); p.lineTo(hw * 0.3, hh); p.lineTo(hw * 0.3, hh * 0.3); p.lineTo(-hw, hh * 0.3); p.closePath(); break
  }
}

export interface LayerMatrix { x: number; y: number; sx: number; sy: number; rot: number; opacity: number; reveal: number; blur: number; hue: number }

/* ---- motion paths (Catmull-Rom through the points, arc-length parametrised) ---- */
const pathCache = new WeakMap<object, { pts: { x: number; y: number }[]; len: number[] }>()
function samplePath(path: NonNullable<AnimLayer['path']>) {
  const hit = pathCache.get(path)
  if (hit) return hit
  const P = path.pts
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)]
    for (let k = 0; k < 24; k++) {
      const t = k / 24, t2 = t * t, t3 = t2 * t
      pts.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      })
    }
  }
  pts.push(P[P.length - 1])
  const len = [0]
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  const r = { pts, len }
  pathCache.set(path, r)
  return r
}
export function pathPolyline(path: NonNullable<AnimLayer['path']>) { return samplePath(path).pts }
export function pointOnPath(path: NonNullable<AnimLayer['path']>, u: number) {
  const { pts, len } = samplePath(path)
  if (pts.length < 2) return { x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0, angle: 0 }
  const L = len[len.length - 1] * Math.min(1, Math.max(0, u))
  let i = 1
  while (i < len.length - 1 && len[i] < L) i++
  const f = (L - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1])
  const a = pts[i - 1], b = pts[i]
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI }
}

export function layerState(a: AnimationDoc, l: AnimLayer, t: number): LayerMatrix {
  const v = (p: AnimProp) => layerValue(l, p, t)
  const m = identityMotion()
  const local = t - l.start
  const len = l.end - l.start
  if (l.presetIn && l.presetIn !== 'none' && local < PRESET_LEN) presetMotion(l.presetIn, local / PRESET_LEN, a.width, a.height, m)
  if (l.presetOut && l.presetOut !== 'none' && local > len - PRESET_LEN) presetMotion(l.presetOut, (len - local) / PRESET_LEN, a.width, a.height, m)
  if (l.presetLoop && l.presetLoop !== 'none') loopMotion(l.presetLoop, local, m)
  const s = v('scale') * m.scale
  let px = 0, py = 0, prot = 0
  if (l.path && l.path.pts.length > 1) {
    const q = pointOnPath(l.path, v('path'))
    px = q.x - a.width / 2; py = q.y - a.height / 2
    if (l.path.orient) prot = q.angle
  }
  return {
    x: v('x') + m.dx + px, y: v('y') + m.dy + py, sx: s * v('scaleX'), sy: s * v('scaleY'), rot: v('rotation') + m.rotation + prot,
    opacity: Math.max(0, Math.min(1, v('opacity') * m.opacity)), reveal: Math.max(0, Math.min(1, v('reveal') * m.reveal)),
    blur: Math.max(0, v('blur') + m.blur), hue: v('hue'),
  }
}

function localMatrix(a: AnimationDoc, st: { x: number; y: number; sx: number; sy: number; rot: number }) {
  return new DOMMatrix().translate(a.width / 2 + st.x, a.height / 2 + st.y).rotate(st.rot).scale(st.sx, st.sy)
}
/** Parent influence: how far the parent has moved/rotated/scaled from its resting pose. */
export function parentMatrix(a: AnimationDoc, l: AnimLayer, t: number, depth = 0): DOMMatrix {
  const par = l.parentId ? a.layers.find((x) => x.id === l.parentId) : undefined
  if (!par || depth > 8) return new DOMMatrix()
  const world = worldMatrix(a, par, t, depth + 1)
  const b = par.base
  const rest = parentMatrix(a, par, t, depth + 1).multiply(localMatrix(a, { x: b.x, y: b.y, sx: b.scale * b.scaleX, sy: b.scale * b.scaleY, rot: b.rotation }))
  return world.multiply(rest.inverse())
}
export function worldMatrix(a: AnimationDoc, l: AnimLayer, t: number, depth = 0): DOMMatrix {
  return parentMatrix(a, l, t, depth).multiply(localMatrix(a, layerState(a, l, t)))
}
/** Opacity including parents. */
function worldOpacity(a: AnimationDoc, l: AnimLayer, t: number, depth = 0): number {
  const par = l.parentId ? a.layers.find((x) => x.id === l.parentId) : undefined
  const o = layerState(a, l, t).opacity
  return par && depth < 8 ? o * worldOpacity(a, par, t, depth + 1) : o
}

/** Natural (unscaled) size of a layer's content. */
export function layerSize(l: AnimLayer, a: AnimationDoc): [number, number] {
  if (l.kind === 'shape') return [l.w ?? 200, l.h ?? 200]
  if (l.kind === 'text') {
    const fs = l.fontSize ?? 80
    const lines = (l.text ?? '').split('\n')
    return [Math.max(...lines.map((x) => x.length)) * fs * 0.6, lines.length * fs * 1.2]
  }
  if (l.kind === 'image' && l.mediaId) { const img = peekImage(l.mediaId); return img ? [img.naturalWidth, img.naturalHeight] : [200, 200] }
  return [a.width, a.height]
}

export function drawLayer(ctx: CanvasRenderingContext2D, a: AnimationDoc, l: AnimLayer, t: number, frameOverride?: number) {
  if (!l.visible || t < l.start || t > l.end) return
  const st = layerState(a, l, t)
  const opacity = l.parentId ? worldOpacity(a, l, t) : st.opacity
  if (opacity <= 0.001) return
  ctx.save()
  ctx.globalAlpha *= opacity
  const filters: string[] = []
  if (st.blur > 0.1) filters.push(`blur(${st.blur}px)`)
  if (Math.abs(st.hue) > 0.1) filters.push(`hue-rotate(${st.hue}deg)`)
  if (l.effect === 'glow') filters.push(`drop-shadow(0 0 18px ${l.fill ?? '#fff'})`)
  if (l.effect === 'shadow') filters.push('drop-shadow(8px 10px 6px rgba(0,0,0,.55))')
  if (filters.length) ctx.filter = filters.join(' ')
  const M = worldMatrix(a, l, t)
  ctx.transform(M.a, M.b, M.c, M.d, M.e, M.f)
  const glitch = l.effect === 'glitch' && Math.sin(t * 23) > 0.6
  const draw = () => {
    if (l.kind === 'shape') {
      ctx.beginPath()
      shapePath(ctx, l.shape ?? 'rect', l.w ?? 200, l.h ?? 200, l.sides ?? 5)
      if (st.reveal < 1) {
        ctx.save(); const w = l.w ?? 200; ctx.beginPath(); ctx.rect(-w / 2, -(l.h ?? 200), w * st.reveal, (l.h ?? 200) * 2); ctx.clip()
        ctx.beginPath(); shapePath(ctx, l.shape ?? 'rect', l.w ?? 200, l.h ?? 200, l.sides ?? 5)
      }
      if (l.fill && l.shape !== 'line') { ctx.fillStyle = l.fill; ctx.fill() }
      if (l.stroke && (l.strokeWidth ?? 0) > 0) { ctx.strokeStyle = l.stroke; ctx.lineWidth = l.strokeWidth!; ctx.lineCap = 'round'; ctx.stroke() }
      if (st.reveal < 1) ctx.restore()
    } else if (l.kind === 'text') {
      const fs = l.fontSize ?? 80
      ctx.font = `${l.bold ? 'bold ' : ''}${fs}px ${l.font ?? 'Inter, system-ui, sans-serif'}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const full = l.text ?? ''
      const shown = full.slice(0, Math.round(full.length * st.reveal))
      const lines = shown.split('\n')
      const total = full.split('\n').length
      lines.forEach((line, i) => {
        const y = (i - (total - 1) / 2) * fs * 1.2
        if (l.stroke && (l.strokeWidth ?? 0) > 0) { ctx.lineJoin = 'round'; ctx.strokeStyle = l.stroke; ctx.lineWidth = l.strokeWidth!; ctx.strokeText(line, 0, y) }
        ctx.fillStyle = l.fill ?? '#fff'
        ctx.fillText(line, 0, y)
      })
    } else if (l.kind === 'image' && l.mediaId) {
      const img = peekImage(l.mediaId)
      if (img) {
        if (st.reveal < 1) { ctx.beginPath(); ctx.rect(-img.naturalWidth / 2, -img.naturalHeight / 2, img.naturalWidth * st.reveal, img.naturalHeight); ctx.clip() }
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
      } else void getImage(l.mediaId)
    } else if (l.kind === 'drawing') {
      const idx = frameOverride ?? drawingFrameIndex(l, t, a.fps)
      const f = l.frames?.[idx]
      const img = f ? frameImage(f.dataUrl) : null
      if (img) ctx.drawImage(img, -a.width / 2, -a.height / 2, a.width, a.height)
    }
  }
  if (glitch) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.7
    ctx.translate(-8, 0); ctx.filter = 'hue-rotate(90deg)'; draw(); ctx.restore()
    ctx.save(); ctx.translate(8, 2); ctx.globalAlpha *= 0.7; ctx.filter = 'hue-rotate(-90deg)'; draw(); ctx.restore()
  }
  draw()
  ctx.restore()
}

/** Render a whole animation at time t into ctx (sized a.width x a.height). */
export function renderAnimation(ctx: CanvasRenderingContext2D, a: AnimationDoc, t: number, opts: { background?: boolean } = {}) {
  if (opts.background !== false && a.background) { ctx.fillStyle = a.background; ctx.fillRect(0, 0, a.width, a.height) }
  // layers[0] is top-most → draw in reverse
  for (let i = a.layers.length - 1; i >= 0; i--) drawLayer(ctx, a, a.layers[i], t)
}

/** Offscreen cache so the video compositor can draw an animation as a single image. */
const offscreen = new Map<string, HTMLCanvasElement>()
export function animationCanvas(a: AnimationDoc, t: number): HTMLCanvasElement {
  let c = offscreen.get(a.id)
  if (!c) { c = document.createElement('canvas'); offscreen.set(a.id, c) }
  if (c.width !== a.width || c.height !== a.height) { c.width = a.width; c.height = a.height }
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, c.width, c.height)
  renderAnimation(ctx, a, t)
  return c
}
