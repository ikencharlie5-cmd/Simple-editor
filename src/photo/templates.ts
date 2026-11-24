/** Photo document templates built from editable text/shape layers. */
import { doc, renderLive, ctx2d, type Layer } from './doc'
import { DEFAULT_STYLES } from './live'
import type { TextProps, ShapeProps } from './live'

const T = (text: string, x: number, y: number, size: number, color: string, extra: Partial<TextProps> = {}): TextProps =>
  ({ text, x, y, font: 'Inter, system-ui, sans-serif', size, color, bold: true, italic: false, vertical: false, align: 'center', lineHeight: 1.1, letterSpacing: 0, ...extra })
const S = (kind: ShapeProps['kind'], x: number, y: number, w: number, h: number, fillColor: string, extra: Partial<ShapeProps> = {}): ShapeProps =>
  ({ kind, x, y, w, h, fill: true, fillColor, stroke: false, strokeColor: '#ffffff', strokeWidth: 6, sides: 6, custom: 'star', radius: 0, ...extra })

function gradientBg(c1: string, c2: string) {
  const l = doc.layers[0], x = ctx2d(l.canvas)
  const g = x.createLinearGradient(0, 0, doc.width, doc.height)
  g.addColorStop(0, c1); g.addColorStop(1, c2)
  x.fillStyle = g; x.fillRect(0, 0, doc.width, doc.height)
}
function addText(name: string, t: TextProps, styles?: (s: ReturnType<typeof DEFAULT_STYLES>) => void) {
  const l: Layer = doc.addLayer(name); l.kind = 'text'; l.text = t
  if (styles) { l.styles = DEFAULT_STYLES(); styles(l.styles) }
  renderLive(l)
}
function addShape(name: string, s: ShapeProps) { const l = doc.addLayer(name); l.kind = 'shape'; l.shape = s; renderLive(l) }

export const PHOTO_TEMPLATES: { name: string; w: number; h: number; build: () => void }[] = [
  { name: 'YouTube thumbnail', w: 1280, h: 720, build: () => {
    gradientBg('#7c3aed', '#db2777')
    addShape('Burst', S('custom', 820, 120, 420, 420, '#fde047', { custom: 'star' }))
    addText('Big title', T('YOU WON\'T\nBELIEVE THIS', 430, 200, 110, '#ffffff'), (s) => { s.stroke.on = true; s.stroke.color = '#111827'; s.stroke.width = 10; s.shadow.on = true })
    addText('Badge', T('NEW!', 1030, 300, 90, '#111827', { align: 'center' }))
  } },
  { name: 'Instagram quote', w: 1080, h: 1080, build: () => {
    gradientBg('#0f172a', '#4c1d95')
    addShape('Quote card', S('rect', 90, 240, 900, 600, '#ffffff22', { radius: 40, stroke: true, strokeColor: '#c084fc', strokeWidth: 4 }))
    addText('Quote', T('“Make something\nyou are proud of.”', 540, 400, 72, '#ffffff', { font: 'Georgia, serif', bold: false, italic: true, lineHeight: 1.3 }))
    addText('Author', T('— Your Name', 540, 700, 40, '#c084fc', { bold: false }))
  } },
  { name: 'Event poster', w: 1080, h: 1350, build: () => {
    gradientBg('#111827', '#7c3aed')
    addShape('Circle', S('ellipse', 240, 120, 600, 600, '#f0abfc'))
    addText('Event', T('SUMMER\nPARTY', 540, 760, 150, '#ffffff', { lineHeight: 1 }), (s) => { s.glow.on = true; s.glow.color = '#f0abfc' })
    addText('Details', T('Saturday · 8 PM · Main Hall', 540, 1120, 46, '#fde047', { bold: false }))
  } },
  { name: 'Sale banner', w: 1500, h: 500, build: () => {
    gradientBg('#fde047', '#f97316')
    addText('Sale', T('50% OFF', 750, 110, 200, '#111827'), (s) => { s.shadow.on = true })
    addText('Sub', T('This weekend only', 750, 340, 60, '#111827', { bold: false }))
  } },
  { name: 'Profile banner', w: 1500, h: 500, build: () => {
    gradientBg('#1e1b4b', '#8b5cf6')
    for (let i = 0; i < 6; i++) addShape('Dot ' + (i + 1), S('ellipse', 100 + i * 240, 60 + (i % 2) * 280, 90, 90, '#ffffff33'))
    addText('Name', T('YOUR NAME', 750, 170, 130, '#ffffff'), (s) => { s.shadow.on = true })
    addText('Tagline', T('Videos · Art · Games', 750, 330, 48, '#e9d5ff', { bold: false }))
  } },
]

export function applyPhotoTemplate(i: number) {
  const t = PHOTO_TEMPLATES[i]
  doc.reset(t.w, t.h, '#ffffff')
  doc.name = t.name
  doc.layers[0].name = 'Background'
  t.build()
  doc.history = []; doc.historyIndex = -1
  doc.commit('Template: ' + t.name)
  doc.historySource = 0
}
