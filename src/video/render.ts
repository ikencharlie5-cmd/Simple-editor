import type { Clip, Filters, Project, TextStyle, Transform } from '../core/types'
import { identityMotion, loopMotion, presetMotion, sampleKeys, type Motion } from '../core/anim'
import { peekImage, peekVideo, getImage } from '../core/media'
import { animationCanvas } from '../animator/render'
import { clipEnd } from '../core/store'

export const FILTER_PRESETS: Record<string, Partial<Filters>> = {
  none: {},
  vivid: { saturation: 1.45, contrast: 1.12 },
  cinematic: { contrast: 1.2, saturation: 0.85, temperature: -0.25, vignette: 0.5 },
  warm: { temperature: 0.45, saturation: 1.1 },
  cool: { temperature: -0.45 },
  vintage: { sepia: 0.55, contrast: 0.9, brightness: 1.05, vignette: 0.6 },
  noir: { grayscale: 1, contrast: 1.35 },
  fade: { contrast: 0.78, brightness: 1.1, saturation: 0.8 },
  dream: { blur: 1, brightness: 1.12, saturation: 1.2 },
  retro: { hue: -15, saturation: 1.3, sepia: 0.25 },
  neon: { saturation: 1.9, contrast: 1.3, hue: 20 },
  inverted: { invert: 1 },
}

export function effectiveFilters(c: Clip): Filters {
  const p = FILTER_PRESETS[c.filterPreset] ?? {}
  const f = c.filters
  return {
    brightness: f.brightness * (p.brightness ?? 1),
    contrast: f.contrast * (p.contrast ?? 1),
    saturation: f.saturation * (p.saturation ?? 1),
    hue: f.hue + (p.hue ?? 0),
    blur: f.blur + (p.blur ?? 0),
    grayscale: Math.min(1, f.grayscale + (p.grayscale ?? 0)),
    sepia: Math.min(1, f.sepia + (p.sepia ?? 0)),
    invert: Math.min(1, f.invert + (p.invert ?? 0)),
    temperature: Math.max(-1, Math.min(1, f.temperature + (p.temperature ?? 0))),
    vignette: Math.min(1, f.vignette + (p.vignette ?? 0)),
  }
}

function cssFilter(f: Filters, extraBlur = 0) {
  const parts: string[] = []
  if (f.brightness !== 1) parts.push(`brightness(${f.brightness})`)
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`)
  if (f.saturation !== 1) parts.push(`saturate(${f.saturation})`)
  if (f.hue) parts.push(`hue-rotate(${f.hue}deg)`)
  if (f.blur + extraBlur > 0) parts.push(`blur(${f.blur + extraBlur}px)`)
  if (f.grayscale) parts.push(`grayscale(${f.grayscale})`)
  if (f.sepia) parts.push(`sepia(${f.sepia})`)
  if (f.invert) parts.push(`invert(${f.invert})`)
  return parts.join(' ') || 'none'
}

export function clipTransformAt(c: Clip, local: number): Transform {
  const k = c.keyframes ?? {}
  const t = c.transform
  return {
    x: sampleKeys(k.x, local, t.x), y: sampleKeys(k.y, local, t.y), scale: sampleKeys(k.scale, local, t.scale),
    rotation: sampleKeys(k.rotation, local, t.rotation), opacity: sampleKeys(k.opacity, local, t.opacity),
  }
}

function clipMotion(c: Clip, local: number, W: number, H: number): Motion {
  const m = identityMotion()
  const len = Math.min(0.6, c.duration / 2)
  if (c.animIn !== 'none' && local < len) presetMotion(c.animIn, local / len, W, H, m)
  if (c.animOut !== 'none' && local > c.duration - len) presetMotion(c.animOut, (c.duration - local) / len, W, H, m)
  if (c.animLoop !== 'none') loopMotion(c.animLoop, local, m)
  // transition (entry effect)
  const tr = c.transitionIn
  if (tr.type !== 'none' && local < tr.duration) {
    const p = local / tr.duration
    switch (tr.type) {
      case 'fade': case 'dissolve': m.opacity *= p; break
      case 'slide-left': m.dx += W * (1 - p); break
      case 'slide-right': m.dx -= W * (1 - p); break
      case 'slide-up': m.dy += H * (1 - p); break
      case 'zoom-in': m.scale *= 0.5 + 0.5 * p; m.opacity *= p; break
      case 'zoom-out': m.scale *= 1.6 - 0.6 * p; m.opacity *= p; break
      case 'spin': m.rotation += 180 * (1 - p); m.scale *= p; break
      case 'blur': m.blur += 40 * (1 - p); m.opacity *= p; break
    }
  }
  return m
}

let tmp: HTMLCanvasElement | null = null
function tmpCanvas(w: number, h: number) {
  if (!tmp) tmp = document.createElement('canvas')
  if (tmp.width !== w || tmp.height !== h) { tmp.width = w; tmp.height = h }
  const ctx = tmp.getContext('2d', { willReadFrequently: true })!
  ctx.clearRect(0, 0, w, h)
  return [tmp, ctx] as const
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function chromaKey(src: CanvasImageSource, w: number, h: number, color: string, tol: number): HTMLCanvasElement {
  const [c, ctx] = tmpCanvas(w, h)
  ctx.drawImage(src, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h)
  const [kr, kg, kb] = hexToRgb(color)
  const t = tol * 255 * 1.7
  const px = d.data
  for (let i = 0; i < px.length; i += 4) {
    const dist = Math.hypot(px[i] - kr, px[i + 1] - kg, px[i + 2] - kb)
    if (dist < t) px[i + 3] = dist < t * 0.6 ? 0 : Math.round(((dist - t * 0.6) / (t * 0.4)) * px[i + 3])
  }
  ctx.putImageData(d, 0, 0)
  return c
}

export function drawStyledText(ctx: CanvasRenderingContext2D, text: string, s: TextStyle, reveal = 1) {
  ctx.font = `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${s.size}px ${s.font}`
  ctx.textAlign = s.align
  ctx.textBaseline = 'middle'
  const allLines = text.split('\n')
  const shownChars = Math.round(text.length * reveal)
  let used = 0
  const lh = s.size * 1.2
  const widths = allLines.map((l) => ctx.measureText(l).width)
  const maxW = Math.max(...widths, 1)
  const x0 = s.align === 'left' ? -maxW / 2 : s.align === 'right' ? maxW / 2 : 0
  if (s.background) {
    ctx.fillStyle = s.background
    const pad = s.size * 0.3
    roundRect(ctx, -maxW / 2 - pad, -(allLines.length * lh) / 2 - pad / 2, maxW + pad * 2, allLines.length * lh + pad, s.size * 0.2)
    ctx.fill()
  }
  allLines.forEach((line, i) => {
    const visible = line.slice(0, Math.max(0, shownChars - used))
    used += line.length + 1
    const y = (i - (allLines.length - 1) / 2) * lh
    ctx.save()
    if (s.shadow) { ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = s.size * 0.12; ctx.shadowOffsetY = s.size * 0.05 }
    if (s.strokeWidth > 0) { ctx.lineJoin = 'round'; ctx.strokeStyle = s.stroke; ctx.lineWidth = s.strokeWidth * 2; ctx.strokeText(visible, x0, y); ctx.shadowColor = 'transparent' }
    ctx.fillStyle = s.color
    ctx.fillText(visible, x0, y)
    ctx.restore()
  })
  return { w: maxW, h: allLines.length * lh }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r)
}

/** Returns the drawable + its natural size for a clip, or null. */
export function clipSource(p: Project, c: Clip, local: number): { src: CanvasImageSource; w: number; h: number } | null {
  if (c.kind === 'video') {
    const v = peekVideo(c.id)
    if (!v || v.readyState < 2) return null
    return { src: v, w: v.videoWidth, h: v.videoHeight }
  }
  if (c.kind === 'image' && c.mediaId) {
    const img = peekImage(c.mediaId)
    if (!img) { void getImage(c.mediaId); return null }
    return { src: img, w: img.naturalWidth, h: img.naturalHeight }
  }
  if (c.kind === 'animation') {
    const m = p.media.find((x) => x.id === c.mediaId)
    const a = p.animations.find((x) => x.id === m?.animationId)
    if (!a) return null
    const t = a.duration > 0 ? (local * c.speed) % a.duration : 0
    return { src: animationCanvas(a, t), w: a.width, h: a.height }
  }
  return null
}

/** Draw one clip at timeline time t. */
export function drawClip(ctx: CanvasRenderingContext2D, p: Project, c: Clip, t: number) {
  const W = p.width, H = p.height
  const local = Math.max(0, Math.min(c.duration, t - c.start))
  const tf = clipTransformAt(c, local)
  const m = clipMotion(c, local, W, H)
  const f = effectiveFilters(c)
  const opacity = tf.opacity * m.opacity
  if (opacity <= 0.001) return
  ctx.save()
  ctx.globalAlpha = Math.min(1, opacity)
  ctx.translate(W / 2 + tf.x + m.dx, H / 2 + tf.y + m.dy)
  ctx.rotate(((tf.rotation + m.rotation) * Math.PI) / 180)
  const s = tf.scale * m.scale
  ctx.scale(s * (c.flipH ? -1 : 1), s * (c.flipV ? -1 : 1))
  ctx.filter = cssFilter(f, m.blur)

  if (c.kind === 'text') {
    drawStyledText(ctx, c.text ?? '', c.textStyle!, m.reveal)
  } else if (c.kind === 'color') {
    ctx.fillStyle = c.color ?? '#000'
    ctx.fillRect(-W / 2, -H / 2, W, H)
  } else {
    const s0 = clipSource(p, c, local)
    if (s0) {
      let { src } = s0
      const { w, h } = s0
      let dw = W, dh = H
      if (c.fit !== 'stretch') {
        const r = c.fit === 'contain' ? Math.min(W / w, H / h) : Math.max(W / w, H / h)
        dw = w * r; dh = h * r
      }
      if (c.chromaKey?.enabled) {
        const sw = Math.min(w, 960), sh = Math.round((h * sw) / w)
        src = chromaKey(src, sw, sh, c.chromaKey.color, c.chromaKey.tolerance)
      }
      if (m.reveal < 1) { ctx.beginPath(); ctx.rect(-dw / 2, -dh / 2, dw * m.reveal, dh); ctx.clip() }
      ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh)
      ctx.filter = 'none'
      if (f.temperature) {
        ctx.globalCompositeOperation = 'soft-light'
        ctx.globalAlpha = Math.min(1, opacity) * Math.abs(f.temperature) * 0.8
        ctx.fillStyle = f.temperature > 0 ? '#ff9a2a' : '#2a7bff'
        ctx.fillRect(-dw / 2, -dh / 2, dw, dh)
        ctx.globalCompositeOperation = 'source-over'
      }
      if (f.vignette) {
        ctx.globalAlpha = Math.min(1, opacity)
        const g = ctx.createRadialGradient(0, 0, Math.min(dw, dh) * 0.3, 0, 0, Math.hypot(dw, dh) / 2)
        g.addColorStop(0, 'rgba(0,0,0,0)')
        g.addColorStop(1, `rgba(0,0,0,${f.vignette * 0.85})`)
        ctx.fillStyle = g
        ctx.fillRect(-dw / 2, -dh / 2, dw, dh)
      }
    }
  }
  ctx.restore()
}

export function visualTracksBottomUp(p: Project) {
  return p.tracks.filter((t) => t.kind !== 'audio' && !t.hidden).reverse()
}

export function activeClipsAt(p: Project, t: number) {
  return p.clips.filter((c) => c.kind !== 'audio' && t >= c.start && t < clipEnd(c))
}

/** Composite the full project frame at time t. Video elements must already be positioned. */
export function renderFrame(ctx: CanvasRenderingContext2D, p: Project, t: number) {
  const s = ctx.canvas.width / p.width
  ctx.setTransform(s, 0, 0, s, 0, 0)
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = p.background
  ctx.fillRect(0, 0, p.width, p.height)
  for (const track of visualTracksBottomUp(p)) {
    const clips = p.clips.filter((c) => c.trackId === track.id)
    for (const c of clips) {
      if (t >= c.start && t < clipEnd(c)) {
        // cross transition: keep previous adjacent clip visible underneath
        if (c.transitionIn.type !== 'none' && t - c.start < c.transitionIn.duration) {
          const prev = clips.find((o) => o.id !== c.id && Math.abs(clipEnd(o) - c.start) < 0.05)
          if (prev) drawClip(ctx, p, prev, clipEnd(prev) - 0.001)
        }
        drawClip(ctx, p, c, t)
      }
    }
  }
}

/** Seek all needed video elements for time t (export path). */
export function videoClipTime(c: Clip, t: number) {
  return c.inPoint + Math.max(0, t - c.start) * c.speed
}
