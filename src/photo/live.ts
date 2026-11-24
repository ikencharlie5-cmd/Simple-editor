/** Rendering for editable (non-destructive) layers: text, shapes, layer styles, masks. */
import { shapePath } from '../animator/render'

export interface TextProps {
  text: string
  x: number
  y: number
  font: string
  size: number
  color: string
  bold: boolean
  italic: boolean
  vertical: boolean
  align: 'left' | 'center' | 'right'
  lineHeight: number
  letterSpacing: number
}

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'polygon' | 'line' | 'custom'
export type CustomShape = 'star' | 'heart' | 'arrow' | 'bubble' | 'check' | 'bolt' | 'chicken'
export interface ShapeProps {
  kind: ShapeKind
  x: number
  y: number
  w: number
  h: number
  /** for lines: end point relative to (x, y) */
  x2?: number
  y2?: number
  fill: boolean
  fillColor: string
  stroke: boolean
  strokeColor: string
  strokeWidth: number
  sides: number
  custom: CustomShape
  radius: number
}

export interface LayerStyles {
  shadow: { on: boolean; color: string; blur: number; dx: number; dy: number; opacity: number }
  stroke: { on: boolean; color: string; width: number; opacity: number }
  glow: { on: boolean; color: string; blur: number; opacity: number }
  overlay: { on: boolean; color: string; opacity: number }
}
export const DEFAULT_STYLES = (): LayerStyles => ({
  shadow: { on: false, color: '#000000', blur: 12, dx: 8, dy: 10, opacity: 0.6 },
  stroke: { on: false, color: '#ffffff', width: 6, opacity: 1 },
  glow: { on: false, color: '#c084fc', blur: 24, opacity: 0.9 },
  overlay: { on: false, color: '#8b5cf6', opacity: 1 },
})
export const hasStyles = (s?: LayerStyles) => !!s && (s.shadow.on || s.stroke.on || s.glow.on || s.overlay.on)

const fontOf = (t: TextProps) => `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size}px ${t.font}`

export function textBounds(t: TextProps, ctx: CanvasRenderingContext2D) {
  ctx.font = fontOf(t)
  const lines = t.text.split('\n')
  if (t.vertical) {
    const rows = Math.max(...lines.map((l) => [...l].length), 1)
    return { x: t.x, y: t.y, w: lines.length * t.size * t.lineHeight, h: rows * t.size * 1.1 }
  }
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width + Math.max(0, l.length - 1) * t.letterSpacing), 1)
  const x = t.align === 'center' ? t.x - w / 2 : t.align === 'right' ? t.x - w : t.x
  return { x, y: t.y, w, h: lines.length * t.size * t.lineHeight }
}

export function drawText(ctx: CanvasRenderingContext2D, t: TextProps) {
  ctx.save()
  ctx.font = fontOf(t)
  ctx.textBaseline = 'top'
  ctx.fillStyle = t.color
  const lines = t.text.split('\n')
  if (t.vertical) {
    lines.forEach((line, col) => [...line].forEach((ch, row) => {
      const w = ctx.measureText(ch).width
      ctx.fillText(ch, t.x + col * t.size * t.lineHeight + (t.size - w) / 2, t.y + row * t.size * 1.1)
    }))
  } else {
    lines.forEach((line, i) => {
      const y = t.y + i * t.size * t.lineHeight
      const lw = ctx.measureText(line).width + Math.max(0, line.length - 1) * t.letterSpacing
      let x = t.align === 'center' ? t.x - lw / 2 : t.align === 'right' ? t.x - lw : t.x
      if (!t.letterSpacing) { ctx.fillText(line, x, y); return }
      for (const ch of line) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + t.letterSpacing }
    })
  }
  ctx.restore()
}

export function customShapePath(x: CanvasRenderingContext2D, kind: CustomShape, w: number, h: number) {
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

export function drawShapeProps(x: CanvasRenderingContext2D, s: ShapeProps) {
  x.save()
  if (s.kind === 'line') {
    x.beginPath(); x.moveTo(s.x, s.y); x.lineTo(s.x + (s.x2 ?? 0), s.y + (s.y2 ?? 0))
    x.lineWidth = Math.max(1, s.strokeWidth); x.lineCap = 'round'; x.strokeStyle = s.strokeColor; x.stroke()
    x.restore(); return
  }
  x.translate(s.x + s.w / 2, s.y + s.h / 2)
  x.beginPath()
  if (s.kind === 'rect') { if (s.radius > 0) x.roundRect(-s.w / 2, -s.h / 2, s.w, s.h, Math.min(s.radius, s.w / 2, s.h / 2)); else x.rect(-s.w / 2, -s.h / 2, s.w, s.h) }
  else if (s.kind === 'ellipse') x.ellipse(0, 0, s.w / 2, s.h / 2, 0, 0, Math.PI * 2)
  else if (s.kind === 'triangle') shapePath(x, 'triangle', s.w, s.h)
  else if (s.kind === 'polygon') shapePath(x, 'polygon', s.w, s.h, s.sides)
  else customShapePath(x, s.custom, s.w, s.h)
  if (s.fill) { x.fillStyle = s.fillColor; x.fill() }
  if (s.stroke) { x.lineWidth = Math.max(1, s.strokeWidth); x.lineJoin = 'round'; x.strokeStyle = s.strokeColor; x.stroke() }
  x.restore()
}

export function shapeBounds(s: ShapeProps) {
  if (s.kind === 'line') {
    const x2 = s.x + (s.x2 ?? 0), y2 = s.y + (s.y2 ?? 0), pad = s.strokeWidth / 2
    return { x: Math.min(s.x, x2) - pad, y: Math.min(s.y, y2) - pad, w: Math.abs(s.x2 ?? 0) + pad * 2, h: Math.abs(s.y2 ?? 0) + pad * 2 }
  }
  return { x: s.x, y: s.y, w: s.w, h: s.h }
}

/** Apply layer styles: returns a canvas with effects drawn around `src`. */
export function renderStyles(src: HTMLCanvasElement, st: LayerStyles, out: HTMLCanvasElement) {
  const w = src.width, h = src.height
  if (out.width !== w || out.height !== h) { out.width = w; out.height = h }
  const x = out.getContext('2d')!
  x.clearRect(0, 0, w, h)
  const tint = (color: string) => {
    const t = document.createElement('canvas'); t.width = w; t.height = h
    const tx = t.getContext('2d')!
    tx.drawImage(src, 0, 0); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = color; tx.fillRect(0, 0, w, h)
    return t
  }
  if (st.shadow.on) {
    x.save(); x.globalAlpha = st.shadow.opacity
    x.shadowColor = st.shadow.color; x.shadowBlur = st.shadow.blur; x.shadowOffsetX = st.shadow.dx + 20000; x.shadowOffsetY = st.shadow.dy
    x.drawImage(src, -20000, 0); x.restore()
  }
  if (st.glow.on) {
    x.save(); x.globalAlpha = st.glow.opacity
    x.shadowColor = st.glow.color; x.shadowBlur = st.glow.blur; x.shadowOffsetX = 20000
    x.drawImage(src, -20000, 0); x.drawImage(src, -20000, 0); x.restore()
  }
  if (st.stroke.on && st.stroke.width > 0) {
    const t = tint(st.stroke.color)
    x.save(); x.globalAlpha = st.stroke.opacity
    const r = st.stroke.width, steps = Math.max(12, Math.round(r * 2.5))
    for (let i = 0; i < steps; i++) { const a = (i / steps) * Math.PI * 2; x.drawImage(t, Math.cos(a) * r, Math.sin(a) * r) }
    x.restore()
  }
  if (st.overlay.on) {
    const t = tint(st.overlay.color)
    x.drawImage(src, 0, 0)
    x.globalAlpha = st.overlay.opacity; x.drawImage(t, 0, 0); x.globalAlpha = 1
  } else x.drawImage(src, 0, 0)
  return out
}
