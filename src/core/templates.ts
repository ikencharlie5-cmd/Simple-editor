/** Ready-made video project templates. */
import { nanoid } from 'nanoid'
import type { AnimationDoc, Project } from './types'
import { DEFAULT_TEXT_STYLE } from './types'
import { makeClip, newProject, newTrack } from './store'
import { importFile, pickFiles } from './media'
import { BUILTIN_SOUNDS, renderBuiltin } from '../audio/builtin'

export interface Template { id: string; name: string; desc: string; icon: string; build: () => Promise<Project | null> }

async function builtinMusic(p: Project, name: string, dur: number) {
  const def = BUILTIN_SOUNDS.find((s) => s.name === name)!
  const blob = await renderBuiltin(def)
  const m = await importFile(new File([blob], name + '.wav', { type: 'audio/wav' }), name, true)
  if (!m) return
  p.media.push(m)
  const tr = p.tracks.find((t) => t.kind === 'audio')!
  for (let t = 0; t < dur; t += m.duration) p.clips.push(makeClip('audio', tr.id, t, Math.min(m.duration, dur - t), { mediaId: m.id, name, fadeOut: t + m.duration >= dur ? 1.5 : 0 }))
}

function base(name: string, w = 1920, h = 1080) {
  const p = newProject(); p.name = name; p.width = w; p.height = h
  return p
}
const text = (p: Project, trackId: string, start: number, dur: number, t: string, style: Partial<typeof DEFAULT_TEXT_STYLE>, extra: Parameters<typeof makeClip>[4] = {}) =>
  p.clips.push(makeClip('text', trackId, start, dur, { name: t, text: t, textStyle: { ...DEFAULT_TEXT_STYLE, ...style }, ...extra }))

function introAnimation(w: number, h: number, title: string): AnimationDoc {
  const L = (o: Partial<AnimationDoc['layers'][0]>) => ({
    id: nanoid(8), name: 'layer', kind: 'shape' as const, visible: true, locked: false, start: 0, end: 4,
    base: { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, reveal: 1, blur: 0, hue: 0, path: 0 }, keys: {},
    fill: '#8b5cf6', stroke: '#ffffff', strokeWidth: 0, w: 300, h: 300, sides: 5, effect: 'none' as const, presetIn: 'none', presetOut: 'none', presetLoop: 'none', ...o,
  })
  return {
    id: nanoid(10), name: 'Intro', width: w, height: h, fps: 30, duration: 4, background: '', onionSkin: false,
    layers: [
      L({ name: 'Title', kind: 'text', text: title, fontSize: Math.round(h / 8), bold: true, fill: '#ffffff', stroke: '#2e1065', strokeWidth: 10, presetIn: 'pop', presetOut: 'fade', effect: 'glow' }),
      L({ name: 'Ring', shape: 'ellipse', w: h * 0.7, h: h * 0.7, fill: '', stroke: '#c084fc', strokeWidth: 18, presetIn: 'zoom', presetLoop: 'pulse', presetOut: 'fade' }),
      L({ name: 'Star', shape: 'star', w: 120, h: 120, fill: '#fde047', base: { x: -w * 0.3, y: -h * 0.25, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, reveal: 1, blur: 0, hue: 0, path: 0 }, presetIn: 'spin', presetLoop: 'float' }),
      L({ name: 'Star 2', shape: 'star', w: 80, h: 80, fill: '#f0abfc', base: { x: w * 0.32, y: h * 0.22, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, reveal: 1, blur: 0, hue: 0, path: 0 }, presetIn: 'spin', presetLoop: 'wiggle' }),
    ],
  }
}

export const TEMPLATES: Template[] = [
  { id: 'blank', name: 'Blank 16:9', desc: 'Empty landscape project (YouTube).', icon: '▭', build: async () => base('Untitled project') },
  { id: 'vertical', name: 'Blank 9:16', desc: 'Empty vertical project (TikTok / Reels / Shorts).', icon: '▯', build: async () => base('Vertical video', 1080, 1920) },
  { id: 'intro', name: 'YouTube intro', desc: 'Animated title with glow, sparkles and music. Edit the text in the Animator.', icon: '🎬',
    build: async () => {
      const p = base('YouTube intro')
      const a = introAnimation(1920, 1080, 'MY CHANNEL')
      p.animations.push(a)
      const m = { id: nanoid(10), name: a.name, kind: 'animation' as const, duration: a.duration, width: a.width, height: a.height, animationId: a.id }
      p.media.push(m)
      const [, v2, v1] = p.tracks
      p.clips.push(makeClip('color', v1.id, 0, 4, { name: 'Background', color: '#1e1b4b' }))
      p.clips.push(makeClip('animation', v2.id, 0, 4, { mediaId: m.id, name: 'Intro' }))
      await builtinMusic(p, 'Upbeat pop loop', 4)
      return p
    } },
  { id: 'slideshow', name: 'Photo slideshow', desc: 'Pick photos: each gets a slow zoom, dissolve and music.', icon: '🖼',
    build: async () => {
      const files = await pickFiles('image/*')
      if (!files.length) return null
      const p = base('Slideshow')
      const v = p.tracks.find((t) => t.kind === 'video')!
      let t = 0
      for (const f of files) {
        const m = await importFile(f)
        if (!m) continue
        p.media.push(m)
        p.clips.push(makeClip('image', v.id, t, 3.5, { mediaId: m.id, name: m.name, fit: 'cover', transitionIn: { type: t ? 'dissolve' : 'fade', duration: 0.7 },
          keyframes: { scale: [{ t: 0, value: 1, ease: 'linear' }, { t: 3.5, value: 1.15, ease: 'linear' }] } }))
        t += 3.5
      }
      text(p, p.tracks[0].id, 0, 3, 'My Slideshow', { size: 110 }, { animIn: 'pop', animOut: 'fade' })
      await builtinMusic(p, 'Ambient pad', t)
      return p
    } },
  { id: 'captions', name: 'Talking video + captions', desc: 'Vertical layout with a big title bar. Import your clip, then use Auto captions.', icon: '💬',
    build: async () => {
      const p = base('Talking video', 1080, 1920)
      text(p, p.tracks[0].id, 0, 5, 'WATCH THIS 👀', { size: 96, background: '#8b5cf6e6', strokeWidth: 0 }, { transform: { x: 0, y: -700, scale: 1, rotation: 0, opacity: 1 }, animIn: 'slide-down' })
      return p
    } },
  { id: 'promo', name: 'Product promo', desc: 'Bold title cards with lower third and beat music.', icon: '🛍',
    build: async () => {
      const p = base('Promo')
      const [tt, v2] = p.tracks
      p.clips.push(makeClip('color', v2.id, 0, 3, { name: 'Card 1', color: '#7c3aed' }))
      p.clips.push(makeClip('color', v2.id, 3, 3, { name: 'Card 2', color: '#db2777', transitionIn: { type: 'slide-left', duration: 0.5 } }))
      p.clips.push(makeClip('color', v2.id, 6, 3, { name: 'Card 3', color: '#0f172a', transitionIn: { type: 'zoom-in', duration: 0.5 } }))
      text(p, tt.id, 0, 3, 'NEW', { size: 220 }, { animIn: 'zoom' })
      text(p, tt.id, 3, 3, 'Better.\nFaster.', { size: 150 }, { animIn: 'slide-right' })
      text(p, tt.id, 6, 3, 'Get it today', { size: 120, color: '#fde047' }, { animIn: 'bounce' })
      await builtinMusic(p, 'Hip-hop beat', 9)
      return p
    } },
  { id: 'meme', name: 'Meme video', desc: 'Top and bottom Impact text over your clip.', icon: '😂',
    build: async () => {
      const p = base('Meme', 1080, 1080)
      const tt = p.tracks[0]
      const t2 = newTrack('text', 2); p.tracks.unshift(t2)
      text(p, tt.id, 0, 5, 'TOP TEXT', { size: 110, font: 'Impact, sans-serif', strokeWidth: 7 }, { transform: { x: 0, y: -420, scale: 1, rotation: 0, opacity: 1 } })
      text(p, t2.id, 0, 5, 'BOTTOM TEXT', { size: 110, font: 'Impact, sans-serif', strokeWidth: 7 }, { transform: { x: 0, y: 420, scale: 1, rotation: 0, opacity: 1 } })
      return p
    } },
]
