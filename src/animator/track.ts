/** Point tracking on the Animator's reference video (template matching). */
import type { AnimationDoc } from '../core/types'
import { getVideo, seekVideo } from '../core/media'

export function drawVideoFit(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, W: number, H: number, fit: 'contain' | 'cover') {
  const vw = v.videoWidth || W, vh = v.videoHeight || H
  const r = fit === 'contain' ? Math.min(W / vw, H / vh) : Math.max(W / vw, H / vh)
  ctx.drawImage(v, (W - vw * r) / 2, (H - vh * r) / 2, vw * r, vh * r)
}

function gray(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const d = ctx.getImageData(0, 0, w, h).data
  const g = new Float32Array(w * h)
  for (let i = 0; i < g.length; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114
  return g
}

/**
 * Track `pt` (animation coordinates) from t0 to t1. Returns one point per animation frame.
 */
export async function trackPoint(a: AnimationDoc, pt: { x: number; y: number }, t0: number, t1: number,
  onProgress: (p: number) => void, cancelled: () => boolean) {
  const rv = a.refVideo!
  const v = await getVideo('animtrack-' + a.id, rv.mediaId)
  if (!v) throw new Error('video not loaded')
  const k = Math.min(1, 480 / a.width)
  const w = Math.round(a.width * k), h = Math.round(a.height * k)
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  const frame = async (t: number) => {
    await seekVideo(v, t + rv.offset)
    ctx.clearRect(0, 0, w, h)
    drawVideoFit(ctx, v, w, h, rv.fit)
    return gray(ctx, w, h)
  }
  const S = 22
  let cx = pt.x * k, cy = pt.y * k
  let g = await frame(t0)
  // grow the patch until it contains enough detail (edges/texture) to lock onto
  let R = 9
  const variance = (r: number) => {
    let s1 = 0, s2 = 0, n = 0
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = Math.min(w - 1, Math.max(0, Math.round(cx) + dx)), yy = Math.min(h - 1, Math.max(0, Math.round(cy) + dy))
      const v = g[yy * w + xx]; s1 += v; s2 += v * v; n++
    }
    return s2 / n - (s1 / n) ** 2
  }
  while (R < 40 && variance(R) < 400) R += 4
  const tpl = new Float32Array((2 * R + 1) ** 2)
  const grab = (src: Float32Array, x: number, y: number, out: Float32Array, blend = 1) => {
    let i = 0
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = Math.min(w - 1, Math.max(0, Math.round(x) + dx)), yy = Math.min(h - 1, Math.max(0, Math.round(y) + dy))
      out[i] = out[i] * (1 - blend) + src[yy * w + xx] * blend; i++
    }
  }
  grab(g, cx, cy, tpl)
  const orig = Float32Array.from(tpl)
  const cur = new Float32Array(tpl.length)
  const out: { t: number; x: number; y: number }[] = [{ t: t0, x: pt.x, y: pt.y }]
  const end = Math.min(t1, (v.duration || t1) - rv.offset)
  const step = 1 / a.fps
  for (let t = t0 + step; t <= end + 1e-6; t += step) {
    if (cancelled()) break
    g = await frame(t)
    let best = Infinity, bx = cx, by = cy
    for (let oy = -S; oy <= S; oy++) for (let ox = -S; ox <= S; ox++) {
      const x0 = Math.round(cx) + ox, y0 = Math.round(cy) + oy
      if (x0 - R < 0 || y0 - R < 0 || x0 + R >= w || y0 + R >= h) continue
      let ssd = 0, i = 0
      for (let dy = -R; dy <= R && ssd < best; dy++) {
        const row = (y0 + dy) * w + x0
        for (let dx = -R; dx <= R; dx++) { const d = g[row + dx] - tpl[i++]; ssd += d * d }
      }
      ssd += (ox * ox + oy * oy) * 2 // prefer small motion
      if (ssd < best) { best = ssd; bx = x0; by = y0 }
    }
    cx = bx; cy = by
    // adapt to appearance changes but stay anchored to the original look (prevents drift)
    grab(g, cx, cy, cur)
    for (let i = 0; i < tpl.length; i++) tpl[i] = orig[i] * 0.7 + cur[i] * 0.3
    out.push({ t, x: cx / k, y: cy / k })
    onProgress((t - t0) / Math.max(1e-6, end - t0))
    if (out.length % 5 === 0) await new Promise((r) => setTimeout(r))
  }
  return out
}
