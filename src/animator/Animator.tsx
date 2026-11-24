import { useEffect, useMemo, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { useStore } from '../core/store'
import type { AnimLayer, AnimProp, AnimationDoc, Ease, MediaItem, ShapeType } from '../core/types'
import { ANIM_PROPS } from '../core/types'
import { EASES, IN_PRESETS, LOOP_PRESETS, setKey, clamp } from '../core/anim'
import { drawLayer, layerSize, layerValue, renderAnimation, preloadAnimation, worldMatrix, parentMatrix, pathPolyline } from './render'
import { getAudioBuffer, getAudioContext, getPeaks } from '../core/media'
import { Graph } from './Graph'
import { Check, Color, Section, Select, Slider, fmtTime } from '../ui/controls'
import { getImage, importFile, pickFiles, getVideo, peekVideo } from '../core/media'
import { newTrack, clipEnd, makeClip } from '../core/store'
import { drawVideoFit, trackPoint } from './track'

const BASE: Record<AnimProp, number> = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, reveal: 1, blur: 0, hue: 0, path: 0 }
const PROP_RANGE: Record<AnimProp, [number, number, number]> = {
  x: [-2000, 2000, 1], y: [-2000, 2000, 1], scale: [0, 5, 0.01], scaleX: [-3, 3, 0.01], scaleY: [-3, 3, 0.01], rotation: [-720, 720, 1],
  opacity: [0, 1, 0.01], reveal: [0, 1, 0.01], blur: [0, 50, 0.5], hue: [-180, 180, 1], path: [0, 1, 0.001],
}

function isDescendant(a: AnimationDoc, id: string, ancestor: string): boolean {
  let cur = a.layers.find((x) => x.id === id), n = 0
  while (cur?.parentId && n++ < 20) { if (cur.parentId === ancestor) return true; cur = a.layers.find((x) => x.id === cur!.parentId) }
  return false
}

function AudioLane({ mediaId, offset, duration, width }: { mediaId: string; offset: number; duration: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => { void getAudioBuffer(mediaId).then(() => setReady(true)) }, [mediaId])
  useEffect(() => {
    const cv = ref.current
    if (!cv || !ready) return
    const w = Math.max(1, Math.round(width)); cv.width = w; cv.height = 30
    const x = cv.getContext('2d')!
    x.clearRect(0, 0, w, 30)
    const peaks = getPeaks(mediaId, 4000)
    const total = useStore.getState().project.media.find((m) => m.id === mediaId)?.duration || 1
    if (!peaks) return
    x.fillStyle = '#7dffbf'
    for (let i = 0; i < w; i++) { const t = offset + (i / w) * duration; const v = peaks[Math.min(peaks.length - 1, Math.floor((t / total) * peaks.length))] ?? 0; const h = Math.max(1, v * 28); x.fillRect(i, 15 - h / 2, 1, h) }
  }, [ready, mediaId, offset, duration, width])
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.8 }} />
}

export function newAnimation(name = 'Animation 1'): AnimationDoc {
  return { id: nanoid(10), name, width: 1920, height: 1080, fps: 24, duration: 4, background: '', layers: [], onionSkin: true }
}

function newLayer(kind: AnimLayer['kind'], a: AnimationDoc, extra: Partial<AnimLayer> = {}): AnimLayer {
  return {
    id: nanoid(8), name: kind, kind, visible: true, locked: false, start: 0, end: a.duration, base: { ...BASE }, keys: {},
    fill: '#8b5cf6', stroke: '#ffffff', strokeWidth: 0, w: 300, h: 300, sides: 5, effect: 'none', presetIn: 'none', presetOut: 'none', presetLoop: 'none',
    ...extra,
  }
}

const SHAPES: { s: ShapeType; icon: string }[] = [
  { s: 'rect', icon: '▭' }, { s: 'ellipse', icon: '◯' }, { s: 'triangle', icon: '△' }, { s: 'star', icon: '☆' },
  { s: 'heart', icon: '♡' }, { s: 'polygon', icon: '⬠' }, { s: 'line', icon: '╱' }, { s: 'arrow', icon: '➜' },
]

/** One-click motion templates that write real keyframes (editable afterwards). */
const KEY_TEMPLATES: Record<string, (l: AnimLayer, a: AnimationDoc, t: number) => Partial<Record<AnimProp, { t: number; v: number; e?: Ease }[]>>> = {
  'Fly across': (_l, a, t) => ({ x: [{ t, v: -a.width / 2 - 300 }, { t: t + 2, v: a.width / 2 + 300, e: 'easeInOut' }] }),
  'Bounce drop': (l, a, t) => ({ y: [{ t, v: -a.height / 2 - 200 }, { t: t + 1.2, v: l.base.y, e: 'bounce' }] }),
  'Grow & spin': (_l, _a, t) => ({ scale: [{ t, v: 0 }, { t: t + 1, v: 1, e: 'back' }], rotation: [{ t, v: -180 }, { t: t + 1, v: 0, e: 'easeOut' }] }),
  'Squash & stretch': (_l, _a, t) => ({ scaleX: [{ t, v: 1 }, { t: t + 0.2, v: 1.3, e: 'easeOut' }, { t: t + 0.4, v: 0.85, e: 'easeInOut' }, { t: t + 0.7, v: 1, e: 'elastic' }], scaleY: [{ t, v: 1 }, { t: t + 0.2, v: 0.7, e: 'easeOut' }, { t: t + 0.4, v: 1.2, e: 'easeInOut' }, { t: t + 0.7, v: 1, e: 'elastic' }] }),
  'Fade in/out': (l, _a, t) => ({ opacity: [{ t, v: 0 }, { t: t + 0.5, v: 1 }, { t: l.end - 0.5, v: 1 }, { t: l.end, v: 0 }] }),
  'Write on': (_l, _a, t) => ({ reveal: [{ t, v: 0 }, { t: t + 1.5, v: 1, e: 'linear' }] }),
  'Heartbeat': (_l, _a, t) => ({ scale: [0, 0.15, 0.3, 0.45, 1].map((d, i) => ({ t: t + d, v: [1, 1.2, 1, 1.15, 1][i], e: 'easeOut' as Ease })) }),
  'Rainbow': (_l, _a, t) => ({ hue: [{ t, v: -180 }, { t: t + 3, v: 180, e: 'linear' }] }),
  'Focus pull': (_l, _a, t) => ({ blur: [{ t, v: 30 }, { t: t + 1, v: 0, e: 'easeOut' }] }),
}

export function Animator() {
  const project = useStore((s) => s.project)
  const update = useStore((s) => s.update)
  const [docId, setDocId] = useState<string | null>(project.animations[0]?.id ?? null)
  const doc = project.animations.find((a) => a.id === docId) ?? project.animations[0]
  const [layerId, setLayerId] = useState<string | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [autoKey, setAutoKey] = useState(true)
  const [mode, setMode] = useState<'select' | 'brush' | 'eraser'>('select')
  const [brush, setBrush] = useState({ color: '#222222', size: 8 })
  const [selKey, setSelKey] = useState<{ prop: AnimProp; i: number } | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [frameIdx, setFrameIdx] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawCanvas = useRef<HTMLCanvasElement | null>(null)
  const [stageSize, setStageSize] = useState({ w: 800, h: 450 })
  const [, setRefTick] = useState(0)
  const [trackPick, setTrackPick] = useState(false)
  const [trackStatus, setTrackStatus] = useState<string | null>(null)
  const trackCancel = useRef(false)
  const [keepOffset, setKeepOffset] = useState(false)
  const [pathMode, setPathMode] = useState(false)
  const [graph, setGraph] = useState(false)

  const layer = doc?.layers.find((l) => l.id === layerId)

  const edit = (fn: (a: AnimationDoc) => void, undo = true) => {
    if (!doc) return
    update((p) => { const a = p.animations.find((x) => x.id === doc.id); if (a) fn(a) }, undo)
  }
  const editLayer = (fn: (l: AnimLayer, a: AnimationDoc) => void, undo = true) => edit((a) => { const l = a.layers.find((x) => x.id === layerId); if (l) fn(l, a) }, undo)

  const createDoc = () => {
    const a = newAnimation(`Animation ${project.animations.length + 1}`)
    const t = newLayer('text', a, { name: 'Title', text: 'Hello!', fontSize: 160, bold: true, fill: '#ffffff', stroke: '#8b5cf6', strokeWidth: 8, presetIn: 'pop', presetLoop: 'float' })
    const s = newLayer('shape', a, { name: 'Circle', shape: 'ellipse', w: 500, h: 500, fill: '#8b5cf6', base: { ...BASE, y: 0 }, presetIn: 'zoom' })
    a.layers = [t, s]
    update((p) => { p.animations.push(a) })
    setDocId(a.id); setLayerId(t.id); setTime(0)
  }

  // Fit stage
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStageSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc?.id])
  const view = useMemo(() => {
    if (!doc) return { s: 1, ox: 0, oy: 0 }
    const s = Math.min((stageSize.w - 30) / doc.width, (stageSize.h - 30) / doc.height)
    return { s, ox: (stageSize.w - doc.width * s) / 2, oy: (stageSize.h - doc.height * s) / 2 }
  }, [doc, stageSize])

  // Playback
  useEffect(() => {
    if (!playing || !doc) return
    let raf = 0
    const t0 = performance.now() - time * 1000
    const tick = () => {
      const t = ((performance.now() - t0) / 1000) % Math.max(0.1, doc.duration)
      setTime(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    // soundtrack
    let src: AudioBufferSourceNode | null = null
    let alive = true
    if (doc.audio) {
      const au = doc.audio
      void getAudioBuffer(au.mediaId).then(async (buf) => {
        if (!buf || !alive) return
        const ctx = getAudioContext(); await ctx.resume()
        src = ctx.createBufferSource(); src.buffer = buf; src.loop = false
        const g = ctx.createGain(); g.gain.value = au.volume
        src.connect(g).connect(ctx.destination)
        const off = time + au.offset
        if (off < buf.duration) src.start(0, off, Math.max(0.01, doc.duration - time))
      })
    }
    return () => { alive = false; cancelAnimationFrame(raf); try { src?.stop() } catch { /* */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, doc?.duration])

  useEffect(() => { if (doc) void preloadAnimation(doc) }, [doc])

  // Drawing layer: current frame index follows time
  const drawingIdx = layer?.kind === 'drawing' ? frameIdx : -1
  useEffect(() => {
    if (layer?.kind !== 'drawing' || !doc || playing) return
    // sync frameIdx with time
    const frames = layer.frames ?? []
    let n = Math.floor((time - layer.start) * doc.fps), idx = 0
    for (let i = 0; i < frames.length; i++) { n -= Math.max(1, frames[i].hold); if (n < 0) { idx = i; break } idx = i }
    setFrameIdx(idx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, layer?.id])

  // Render
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !doc) return
    cv.width = stageSize.w * devicePixelRatio; cv.height = stageSize.h * devicePixelRatio
    cv.style.width = stageSize.w + 'px'; cv.style.height = stageSize.h + 'px'
    const ctx = cv.getContext('2d')!
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    ctx.clearRect(0, 0, stageSize.w, stageSize.h)
    ctx.save()
    ctx.translate(view.ox, view.oy); ctx.scale(view.s, view.s)
    // checkerboard / background
    if (!doc.background) {
      const sz = 20 / view.s
      ctx.fillStyle = '#bbb'; ctx.fillRect(0, 0, doc.width, doc.height); ctx.fillStyle = '#ddd'
      for (let y = 0; y < doc.height; y += sz) for (let x = (Math.floor(y / sz) % 2) * sz; x < doc.width; x += sz * 2) ctx.fillRect(x, y, sz, sz)
    }
    ctx.beginPath(); ctx.rect(0, 0, doc.width, doc.height); ctx.clip()
    if (doc.background) { ctx.fillStyle = doc.background; ctx.fillRect(0, 0, doc.width, doc.height) }
    const rv = doc.refVideo && peekVideo('animref-' + doc.id)
    if (rv && rv.readyState >= 2) { ctx.save(); ctx.globalAlpha = doc.refVideo!.opacity; drawVideoFit(ctx, rv, doc.width, doc.height, doc.refVideo!.fit); ctx.restore() }
    // onion skin for drawing layer
    if (doc.onionSkin && layer?.kind === 'drawing' && !playing) {
      for (const [off, alpha] of [[-1, 0.25], [1, 0.15]] as const) {
        const idx = drawingIdx + off
        if (layer.frames?.[idx]?.dataUrl) {
          ctx.save(); ctx.globalAlpha = alpha; ctx.filter = off < 0 ? 'sepia(1) hue-rotate(-50deg) saturate(4)' : 'sepia(1) hue-rotate(90deg) saturate(4)'
          drawLayer(ctx, doc, layer, time, idx); ctx.restore()
        }
      }
    }
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const l = doc.layers[i]
      if (l.kind === 'drawing' && l.id === layer?.id && !playing && drawCanvas.current && mode !== 'select') {
        ctx.drawImage(drawCanvas.current, 0, 0, doc.width, doc.height)
      } else drawLayer(ctx, doc, l, time, l.id === layer?.id && l.kind === 'drawing' && !playing ? drawingIdx : undefined)
    }
    ctx.restore()
    // selection box
    // motion path of selected layer
    if (layer?.path && layer.path.pts.length) {
      ctx.save(); ctx.translate(view.ox, view.oy); ctx.scale(view.s, view.s)
      const poly = layer.path.pts.length > 1 ? pathPolyline(layer.path) : layer.path.pts
      ctx.strokeStyle = '#c084fc'; ctx.lineWidth = 2 / view.s; ctx.setLineDash([6 / view.s, 4 / view.s])
      ctx.beginPath(); poly.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#8b5cf6'
      layer.path.pts.forEach((q) => { ctx.beginPath(); ctx.arc(q.x, q.y, 6 / view.s, 0, Math.PI * 2); ctx.fill(); ctx.stroke() })
      ctx.restore()
    }
    if (layer && layer.kind !== 'drawing' && !playing && time >= layer.start && time <= layer.end) {
      const [w, h] = layerSize(layer, doc)
      const M = new DOMMatrix().translate(view.ox, view.oy).scale(view.s).multiply(worldMatrix(doc, layer, time))
      const c4 = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([u, v]) => M.transformPoint(new DOMPoint(u, v)))
      ctx.save()
      ctx.strokeStyle = '#8b5cf6'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4])
      ctx.beginPath(); c4.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.stroke()
      ctx.setLineDash([]); ctx.fillStyle = '#8b5cf6'
      ctx.fillRect(c4[2].x - 5, c4[2].y - 5, 10, 10)
      if (layer.parentId) { const par = doc.layers.find((x) => x.id === layer.parentId); if (par) { const pm = new DOMMatrix().translate(view.ox, view.oy).scale(view.s).multiply(worldMatrix(doc, par, time)).transformPoint(new DOMPoint(0, 0)); const cm = M.transformPoint(new DOMPoint(0, 0)); ctx.strokeStyle = '#c084fc88'; ctx.beginPath(); ctx.moveTo(cm.x, cm.y); ctx.lineTo(pm.x, pm.y); ctx.stroke() } }
      ctx.restore()
    }
  })

  // load current drawing frame into draw canvas
  useEffect(() => {
    if (!doc || layer?.kind !== 'drawing') { drawCanvas.current = null; return }
    const c = document.createElement('canvas'); c.width = doc.width; c.height = doc.height
    const f = layer.frames?.[frameIdx]
    if (f?.dataUrl) { const img = new Image(); img.onload = () => { c.getContext('2d')!.drawImage(img, 0, 0); drawCanvas.current = c; setStageSize((s) => ({ ...s })) }; img.src = f.dataUrl }
    drawCanvas.current = c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer?.id, frameIdx, layer?.frames?.[frameIdx]?.dataUrl, doc?.width, doc?.height])

  // reference video under the animation
  const refKey = doc ? 'animref-' + doc.id : ''
  useEffect(() => {
    if (!doc?.refVideo) return
    void getVideo(refKey, doc.refVideo.mediaId).then((v) => { if (v) { v.onseeked = () => setRefTick((x) => x + 1); setRefTick((x) => x + 1) } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.refVideo?.mediaId, refKey])
  useEffect(() => {
    const v = doc?.refVideo ? peekVideo(refKey) : undefined
    if (!v || !doc?.refVideo) return
    const target = Math.max(0, time + doc.refVideo.offset)
    if (playing) {
      if (v.paused) { v.currentTime = target; void v.play().catch(() => {}) }
      else if (Math.abs(v.currentTime - target) > 0.25) v.currentTime = target
    } else {
      if (!v.paused) v.pause()
      if (Math.abs(v.currentTime - target) > 0.01) v.currentTime = target
    }
  }, [time, playing, doc?.refVideo, refKey])

  const runTrack = async (pt: { x: number; y: number }) => {
    if (!doc?.refVideo || !layer) return
    const l0 = layer
    trackCancel.current = false
    setTrackStatus('Tracking… 0%')
    try {
      const t0 = Math.max(time, l0.start)
      const ox = keepOffset ? layerValue(l0, 'x', t0) - (pt.x - doc.width / 2) : 0, oy = keepOffset ? layerValue(l0, 'y', t0) - (pt.y - doc.height / 2) : 0
      const pts = await trackPoint(doc, pt, t0, l0.end, (p) => setTrackStatus(`Tracking… ${Math.round(p * 100)}%`), () => trackCancel.current)
      if (!pts.length) { setTrackStatus('Nothing to track here'); return }
      edit((a) => {
        const l = a.layers.find((x) => x.id === l0.id)!
        const s0 = t0 - l.start, s1 = pts[pts.length - 1].t - l.start
        const keep = (k?: typeof l.keys.x) => (k ?? []).filter((q) => q.t < s0 - 1e-3 || q.t > s1 + 1e-3)
        l.keys.x = [...keep(l.keys.x), ...pts.map((q) => ({ t: q.t - l.start, value: Math.round((q.x - doc.width / 2 + ox) * 10) / 10, ease: 'linear' as Ease }))].sort((p, q) => p.t - q.t)
        l.keys.y = [...keep(l.keys.y), ...pts.map((q) => ({ t: q.t - l.start, value: Math.round((q.y - doc.height / 2 + oy) * 10) / 10, ease: 'linear' as Ease }))].sort((p, q) => p.t - q.t)
      })
      setTrackStatus(`Tracked ${pts.length} frames ✓`)
    } catch (e) { setTrackStatus('Tracking failed: ' + (e as Error).message) }
  }

  const toDoc = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left - view.ox) / view.s, y: (e.clientY - r.top - view.oy) / view.s }
  }

  const setProp = (l: AnimLayer, prop: AnimProp, v: number) => {
    const local = time - l.start
    if (autoKey && (l.keys[prop]?.length ?? 0) > 0) l.keys[prop] = setKey(l.keys[prop], local, v, l.keys[prop]!.at(-1)!.ease)
    else if (autoKey && Object.values(l.keys).some((k) => k?.length) && local > 0.01) {
      // first change after other keys exist: key both the old value at 0 and new at t
      l.keys[prop] = setKey(setKey(undefined, 0, l.base[prop]), local, v)
    } else l.base[prop] = v
  }

  const onStageDown = (e: React.PointerEvent) => {
    if (!doc) return
    const p0 = toDoc(e)
    if (trackPick) { setTrackPick(false); void runTrack(p0); return }
    if (mode !== 'select' && layer?.kind === 'drawing') {
      const c = drawCanvas.current!
      const ctx = c.getContext('2d')!
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.strokeStyle = brush.color; ctx.lineWidth = brush.size
      ctx.globalCompositeOperation = mode === 'eraser' ? 'destination-out' : 'source-over'
      let last = p0
      ctx.beginPath(); ctx.arc(p0.x, p0.y, brush.size / 2, 0, Math.PI * 2); ctx.fillStyle = brush.color; ctx.fill()
      const move = (ev: PointerEvent) => {
        const p = toDoc(ev)
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p
        setStageSize((s) => ({ ...s }))
      }
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
        ctx.globalCompositeOperation = 'source-over'
        const url = c.toDataURL('image/png')
        editLayer((l) => { if (!l.frames) l.frames = []; if (!l.frames[frameIdx]) l.frames[frameIdx] = { id: nanoid(6), dataUrl: '', hold: 1 }; l.frames[frameIdx].dataUrl = url })
      }
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
      return
    }
    // motion path drawing / point dragging
    if (pathMode && layer && layer.kind !== 'drawing') {
      edit((a) => { const l = a.layers.find((x) => x.id === layer.id)!; l.path = { pts: [...(l.path?.pts ?? []), { x: Math.round(p0.x), y: Math.round(p0.y) }], orient: l.path?.orient ?? false } })
      return
    }
    if (layer?.path && mode === 'select') {
      const pi = layer.path.pts.findIndex((q) => Math.hypot(q.x - p0.x, q.y - p0.y) < 10 / view.s)
      if (pi >= 0) {
        useStore.getState().checkpoint()
        const move = (ev: PointerEvent) => { const p = toDoc(ev); edit((a) => { const l = a.layers.find((x) => x.id === layer.id)!; l.path!.pts[pi] = { x: Math.round(p.x), y: Math.round(p.y) }; l.path = { ...l.path! } }, false) }
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
        return
      }
    }
    // hit test top-most
    let hit: AnimLayer | undefined
    let handle = false
    for (const l of doc.layers) {
      if (!l.visible || l.locked || l.kind === 'drawing' || time < l.start || time > l.end) continue
      const [w, h] = layerSize(l, doc)
      const inv = worldMatrix(doc, l, time).inverse()
      const q = inv.transformPoint(new DOMPoint(p0.x, p0.y))
      const sc = Math.hypot(inv.a, inv.b) / view.s
      if (l.id === layerId && Math.abs(q.x - w / 2) < 14 * sc && Math.abs(q.y - h / 2) < 14 * sc) { hit = l; handle = true; break }
      if (Math.abs(q.x) <= w / 2 && Math.abs(q.y) <= h / 2) { hit = l; break }
    }
    if (!hit) { setLayerId(null); return }
    setLayerId(hit.id)
    const l0 = hit
    const ox = layerValue(l0, 'x', time), oy = layerValue(l0, 'y', time), os = layerValue(l0, 'scale', time)
    const center0 = worldMatrix(doc, l0, time).transformPoint(new DOMPoint(0, 0))
    const d0 = Math.hypot(p0.x - center0.x, p0.y - center0.y)
    // convert world-space drags into the parent's space
    const pinv = parentMatrix(doc, l0, time).inverse()
    useStore.getState().checkpoint()
    const move = (ev: PointerEvent) => {
      const p = toDoc(ev)
      edit((a) => {
        const l = a.layers.find((x) => x.id === l0.id)!
        if (handle) setProp(l, 'scale', Math.max(0.02, os * (Math.hypot(p.x - center0.x, p.y - center0.y) / Math.max(1, d0))))
        else {
          const dx = p.x - p0.x, dy = p.y - p0.y
          const lx = pinv.a * dx + pinv.c * dy, ly = pinv.b * dx + pinv.d * dy
          setProp(l, 'x', Math.round(ox + lx)); setProp(l, 'y', Math.round(oy + ly))
        }
      }, false)
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  const sendToVideo = () => {
    if (!doc) return
    const st = useStore.getState()
    let m = st.project.media.find((x) => x.animationId === doc.id)
    if (!m) {
      m = { id: nanoid(10), name: doc.name, kind: 'animation', duration: doc.duration, width: doc.width, height: doc.height, animationId: doc.id }
      st.addMedia(m)
    }
    const media: MediaItem = m
    const animClipId = st.addClipFromMedia(media)
    const rvm = doc.refVideo?.include ? st.project.media.find((x) => x.id === doc.refVideo!.mediaId) : undefined
    if (rvm && animClipId) {
      const rv = doc.refVideo!
      useStore.getState().update((p) => {
        const ac = p.clips.find((c) => c.id === animClipId)!
        const ti = p.tracks.findIndex((t) => t.id === ac.trackId)
        const dur = Math.min(ac.duration, Math.max(0.1, rvm.duration - rv.offset))
        let tr = p.tracks.slice(ti + 1).find((t) => t.kind === 'video' && !p.clips.some((c) => c.trackId === t.id && c.start < ac.start + dur && clipEnd(c) > ac.start))
        if (!tr) { tr = newTrack('video', p.tracks.filter((t) => t.kind === 'video').length + 1); p.tracks.splice(ti + 1, 0, tr) }
        p.clips.push(makeClip('video', tr.id, ac.start, dur, { mediaId: rvm.id, name: rvm.name, inPoint: rv.offset, fit: rv.fit }))
      })
    }
    if (doc.audio && animClipId) {
      const au = doc.audio
      const am = useStore.getState().project.media.find((x) => x.id === au.mediaId)
      if (am) useStore.getState().update((p) => {
        const ac = p.clips.find((c) => c.id === animClipId)!
        const dur = Math.min(ac.duration, Math.max(0.1, am.duration - au.offset))
        let tr = p.tracks.find((t) => t.kind === 'audio' && !p.clips.some((c) => c.trackId === t.id && c.start < ac.start + dur && clipEnd(c) > ac.start))
        if (!tr) { tr = newTrack('audio', p.tracks.filter((t) => t.kind === 'audio').length + 1); p.tracks.push(tr) }
        p.clips.push(makeClip('audio', tr.id, ac.start, dur, { mediaId: am.id, name: am.name, inPoint: au.offset, volume: au.volume }))
      })
    }
    st.setTab('video')
    st.notify(`"${doc.name}" added to the video timeline. Edits in the Animator update it automatically.`)
  }

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (useStore.getState().tab !== 'animator') return
      const k = e.key.toLowerCase()
      if (k === ' ') { e.preventDefault(); setPlaying((p) => !p) }
      else if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) useStore.getState().redo(); else useStore.getState().undo() }
      else if ((k === 'delete' || k === 'backspace') && selKey && layer) { editLayer((l) => { l.keys[selKey.prop]!.splice(selKey.i, 1) }); setSelKey(null) }
      else if ((k === 'delete' || k === 'backspace') && layer) { edit((a) => { a.layers = a.layers.filter((x) => x.id !== layer.id) }); setLayerId(null) }
      else if (k === 'arrowright') setTime((t) => Math.min(doc?.duration ?? 0, t + 1 / (doc?.fps ?? 24)))
      else if (k === 'arrowleft') setTime((t) => Math.max(0, t - 1 / (doc?.fps ?? 24)))
      else if (k === 'b') setMode('brush')
      else if (k === 'e') setMode('eraser')
      else if (k === 'v') setMode('select')
      else if (k === ',' && layer?.kind === 'drawing') setFrameIdx((i) => Math.max(0, i - 1))
      else if (k === '.' && layer?.kind === 'drawing') setFrameIdx((i) => Math.min((layer.frames?.length ?? 1) - 1, i + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!doc) return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
      <div className="card" style={{ maxWidth: 460, textAlign: 'center' }}>
        <h3>🐔 Animator</h3>
        <p className="hint">Make keyframed motion graphics, hand-drawn frame-by-frame animation, or one-click preset animations, then send them straight into your video.</p>
        <button className="primary" onClick={createDoc}>＋ New animation</button>
      </div>
    </div>
  )

  const pps = 140
  const tlWidth = doc.duration * pps
  const timeToX = (t: number) => t * pps
  const scrub = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement
    const r = el.getBoundingClientRect()
    const f = (ev: { clientX: number }) => setTime(clamp((ev.clientX - r.left) / pps, 0, doc.duration))
    f(e)
    const move = (ev: PointerEvent) => f(ev)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const dragKey = (e: React.PointerEvent, l: AnimLayer, prop: AnimProp, i: number) => {
    e.stopPropagation()
    setLayerId(l.id); setSelKey({ prop, i })
    const k0 = l.keys[prop]![i]
    setTime(l.start + k0.t)
    const sx = e.clientX
    useStore.getState().checkpoint()
    const move = (ev: PointerEvent) => {
      const nt = clamp(k0.t + (ev.clientX - sx) / pps, 0, l.end - l.start)
      edit((a) => { const ll = a.layers.find((x) => x.id === l.id)!; ll.keys[prop]![i].t = Math.round(nt * doc.fps) / doc.fps; ll.keys[prop]!.sort((p, q) => p.t - q.t) }, false)
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const dragBar = (e: React.PointerEvent, l: AnimLayer) => {
    e.stopPropagation(); setLayerId(l.id)
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const edge = e.clientX - r.left < 6 ? 'l' : r.right - e.clientX < 6 ? 'r' : 'm'
    const sx = e.clientX, s0 = l.start, e0 = l.end
    useStore.getState().checkpoint()
    const move = (ev: PointerEvent) => {
      const d = Math.round(((ev.clientX - sx) / pps) * doc.fps) / doc.fps
      edit((a) => {
        const ll = a.layers.find((x) => x.id === l.id)!
        if (edge === 'l') ll.start = clamp(s0 + d, 0, e0 - 0.1)
        else if (edge === 'r') ll.end = clamp(e0 + d, s0 + 0.1, a.duration)
        else { const len = e0 - s0; ll.start = clamp(s0 + d, 0, a.duration - len); ll.end = ll.start + len }
      }, false)
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  const addLayer = (l: AnimLayer) => { edit((a) => { a.layers.unshift(l) }); setLayerId(l.id) }

  return (
    <div className="animator">
      {/* LEFT */}
      <div className="panel">
        <div className="panel-title">Animations <span className="spacer" /><button className="icon" title="New animation" onClick={createDoc}>＋</button></div>
        <div className="section-body">
          <Select value={doc.id} options={project.animations.map((a) => ({ value: a.id, label: a.name }))} onChange={(v) => { setDocId(v); setLayerId(null); setTime(0) }} />
          <input value={doc.name} onChange={(e) => edit((a) => { a.name = e.target.value }, false)} />
          <button className="primary" onClick={sendToVideo}>🎬 Send to video editor</button>
        </div>
        <div className="panel-title">Add layer</div>
        <div className="section-body">
          <div className="grid3" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
            {SHAPES.map(({ s, icon }) => <button key={s} title={s} style={{ fontSize: 16 }} onClick={() => addLayer(newLayer('shape', doc, { name: s, shape: s, h: s === 'line' ? 20 : s === 'arrow' ? 160 : 300, strokeWidth: s === 'line' ? 12 : 0, stroke: s === 'line' ? '#ffffff' : '#ffffff' }))}>{icon}</button>)}
          </div>
          <button onClick={() => addLayer(newLayer('text', doc, { name: 'Text', text: 'Text', fontSize: 120, bold: true, fill: '#ffffff', stroke: '#000000', strokeWidth: 6 }))}>T Text</button>
          <button onClick={async () => {
            const [f] = await pickFiles('image/*', false)
            if (!f) return
            const m = await importFile(f)
            if (!m) return
            useStore.getState().addMedia(m)
            await getImage(m.id)
            addLayer(newLayer('image', doc, { name: m.name, mediaId: m.id }))
          }}>🖼 Image…</button>
          <button onClick={() => { addLayer(newLayer('drawing', doc, { name: 'Drawing', frames: [{ id: nanoid(6), dataUrl: '', hold: 2 }] })); setMode('brush'); setFrameIdx(0) }}>✏️ Frame-by-frame drawing</button>
        </div>
        <div className="panel-title">Layers</div>
        {doc.layers.map((l, i) => (
          <div key={l.id} className={'layer-row ' + (l.id === layerId ? 'on' : '')} onClick={() => setLayerId(l.id)}>
            <button className="icon" onClick={(e) => { e.stopPropagation(); edit((a) => { a.layers[i].visible = !a.layers[i].visible }) }}>{l.visible ? '👁' : '🙈'}</button>
            <span className="lname">{{ shape: '◆', text: 'T', image: '🖼', drawing: '✏️' }[l.kind]} {l.name}</span>
            <button className="icon" title="Move up" disabled={i === 0} onClick={(e) => { e.stopPropagation(); edit((a) => { const [x] = a.layers.splice(i, 1); a.layers.splice(i - 1, 0, x) }) }}>▲</button>
            <button className="icon" title="Move down" disabled={i === doc.layers.length - 1} onClick={(e) => { e.stopPropagation(); edit((a) => { const [x] = a.layers.splice(i, 1); a.layers.splice(i + 1, 0, x) }) }}>▼</button>
          </div>
        ))}
        <Section title="🎞 Video underneath" defaultOpen={!!doc.refVideo}>
          <div className="hint">Put a video under your animation to animate over it (rotoscope) and track real motion.</div>
          <Select value={doc.refVideo?.mediaId ?? ''} options={[{ value: '', label: 'None' }, ...project.media.filter((m) => m.kind === 'video').map((m) => ({ value: m.id, label: m.name }))]}
            onChange={(v) => edit((a) => { a.refVideo = v ? { mediaId: v, offset: 0, opacity: 1, fit: 'contain', include: true, ...(a.refVideo?.mediaId === v ? a.refVideo : {}) } : undefined })} />
          <button onClick={async () => {
            const [f] = await pickFiles('video/*', false)
            if (!f) return
            useStore.getState().notify('Importing video…')
            const m = await importFile(f)
            if (!m) return
            useStore.getState().addMedia(m)
            edit((a) => { a.refVideo = { mediaId: m.id, offset: 0, opacity: 1, fit: 'contain', include: true } })
          }}>＋ Import a video…</button>
          {doc.refVideo && (() => {
            const vm = project.media.find((m) => m.id === doc.refVideo!.mediaId)
            return <>
              <Slider label="Opacity" min={0} max={1} value={doc.refVideo.opacity} onChange={(v) => edit((a) => { a.refVideo!.opacity = v }, false)} />
              <Slider label="Start at (s)" min={0} max={Math.max(0.1, (vm?.duration ?? 1) - 0.1)} value={doc.refVideo.offset} onChange={(v) => edit((a) => { a.refVideo!.offset = v }, false)} />
              <Select label="Fit" value={doc.refVideo.fit} options={['contain', 'cover'] as const} onChange={(v) => edit((a) => { a.refVideo!.fit = v })} />
              <Check label="Include video when sending to the editor" value={doc.refVideo.include} onChange={(v) => edit((a) => { a.refVideo!.include = v })} />
              {vm && <button onClick={() => edit((a) => { const d = Math.max(0.5, vm.duration - a.refVideo!.offset); a.duration = Math.round(d * 100) / 100; a.layers.forEach((l) => { l.end = a.duration; l.start = Math.min(l.start, a.duration - 0.1) }) })}>Match animation length to video</button>}
              {vm && <button onClick={() => edit((a) => { a.width = vm.width || a.width; a.height = vm.height || a.height })}>Match size to video ({vm.width}×{vm.height})</button>}
            </>
          })()}
        </Section>
        <Section title="🎵 Soundtrack" defaultOpen={!!doc.audio}>
          <div className="hint">Animate to music or dialogue (lip-sync). The waveform shows in the timeline.</div>
          <Select value={doc.audio?.mediaId ?? ''} options={[{ value: '', label: 'None' }, ...project.media.filter((m) => m.kind === 'audio' || (m.kind === 'video' && m.hasAudio)).map((m) => ({ value: m.id, label: m.name }))]}
            onChange={(v) => edit((a) => { a.audio = v ? { mediaId: v, offset: 0, volume: 1 } : undefined })} />
          <button onClick={async () => {
            const [f] = await pickFiles('audio/*', false)
            if (!f) return
            const m = await importFile(f)
            if (!m) return
            useStore.getState().addMedia(m)
            edit((a) => { a.audio = { mediaId: m.id, offset: 0, volume: 1 } })
          }}>＋ Import audio…</button>
          {doc.audio && <>
            <Slider label="Start at (s)" min={0} max={Math.max(0.1, (project.media.find((m) => m.id === doc.audio!.mediaId)?.duration ?? 1))} value={doc.audio.offset} onChange={(v) => edit((a) => { a.audio!.offset = v }, false)} />
            <Slider label="Volume" min={0} max={1.5} value={doc.audio.volume} onChange={(v) => edit((a) => { a.audio!.volume = v }, false)} />
          </>}
        </Section>
        <Section title="Animation settings" defaultOpen={false}>
          <div className="grid2">
            <label className="field"><span>W</span><input type="number" value={doc.width} onChange={(e) => edit((a) => { a.width = Math.max(16, +e.target.value) })} /></label>
            <label className="field"><span>H</span><input type="number" value={doc.height} onChange={(e) => edit((a) => { a.height = Math.max(16, +e.target.value) })} /></label>
          </div>
          <button onClick={() => edit((a) => { a.width = project.width; a.height = project.height })}>Match video size ({project.width}×{project.height})</button>
          <Slider label="Duration" min={0.5} max={60} step={0.1} value={doc.duration} onChange={(v) => edit((a) => { a.duration = v; a.layers.forEach((l) => { if (l.end > v || l.end === doc.duration) l.end = v; l.start = Math.min(l.start, v - 0.1) }) }, false)} onCommit={useStore.getState().checkpoint} />
          <Select label="FPS" value={String(doc.fps)} options={['8', '12', '15', '24', '30', '60']} onChange={(v) => edit((a) => { a.fps = +v })} />
          <Check label="Transparent background" value={!doc.background} onChange={(v) => edit((a) => { a.background = v ? '' : '#ffffff' })} />
          {doc.background && <Color label="Background" value={doc.background} onChange={(v) => edit((a) => { a.background = v })} />}
          <button className="danger" onClick={() => { if (confirm(`Delete animation "${doc.name}"?`)) { update((p) => { p.animations = p.animations.filter((a) => a.id !== doc.id); const m = p.media.find((x) => x.animationId === doc.id); if (m) { p.clips = p.clips.filter((c) => c.mediaId !== m.id); p.media = p.media.filter((x) => x !== m) } }); setDocId(null) } }}>Delete animation</button>
        </Section>
      </div>

      {/* STAGE */}
      <div className="anim-stage">
        <div className="options-bar">
          <button className={mode === 'select' ? 'active' : ''} onClick={() => setMode('select')} title="Select / move (V)">↖ Select</button>
          <button className={mode === 'brush' ? 'active' : ''} disabled={layer?.kind !== 'drawing'} onClick={() => setMode('brush')} title="Brush (B)">🖌 Brush</button>
          <button className={mode === 'eraser' ? 'active' : ''} disabled={layer?.kind !== 'drawing'} onClick={() => setMode('eraser')} title="Eraser (E)">⌫ Eraser</button>
          {layer?.kind === 'drawing' && <>
            <Color value={brush.color} onChange={(c) => setBrush({ ...brush, color: c })} />
            <label>Size <input type="range" min={1} max={80} value={brush.size} onChange={(e) => setBrush({ ...brush, size: +e.target.value })} /></label>
            <Check label="Onion skin" value={doc.onionSkin} onChange={(v) => edit((a) => { a.onionSkin = v }, false)} />
          </>}
          <span style={{ flex: 1 }} />
          <Check label="Auto-key" value={autoKey} onChange={setAutoKey} />
        </div>
        <div className="stage" ref={stageRef} onPointerDown={onStageDown} style={{ cursor: trackPick || mode !== 'select' ? 'crosshair' : 'default' }}>
          <canvas ref={canvasRef} />
        </div>
        <div className="preview-bar">
          <button onClick={() => setTime(0)}>⏮</button>
          <button className="primary" style={{ width: 70 }} onClick={() => setPlaying(!playing)}>{playing ? '⏸ Pause' : '▶ Play'}</button>
          <span className="timecode">{fmtTime(time)} / {fmtTime(doc.duration)} · frame {Math.floor(time * doc.fps)}</span>
          <span style={{ flex: 1 }} />
          <span className="hint">Drag to move · drag the corner square to scale · Space play · ←/→ step</span>
        </div>
      </div>

      {/* INSPECTOR */}
      <div className="panel inspector" style={{ borderLeft: '1px solid var(--line)' }}>
        {!layer ? <div className="hint" style={{ padding: 10 }}>Select a layer to edit it. With <b>Auto-key</b> on, changing a property after keys exist adds a keyframe at the playhead.</div> : <>
          <div className="panel-title"><input style={{ flex: 1 }} value={layer.name} onChange={(e) => editLayer((l) => { l.name = e.target.value }, false)} /></div>
          {layer.kind === 'text' && <Section title="Text">
            <textarea rows={2} value={layer.text} onChange={(e) => editLayer((l) => { l.text = e.target.value }, false)} />
            <Slider label="Size" min={8} max={400} step={1} value={layer.fontSize ?? 80} onChange={(v) => editLayer((l) => { l.fontSize = v }, false)} />
            <Select label="Font" value={layer.font ?? 'Inter, system-ui, sans-serif'} options={[{ value: 'Inter, system-ui, sans-serif', label: 'Sans' }, { value: 'Georgia, serif', label: 'Serif' }, { value: 'Impact, sans-serif', label: 'Impact' }, { value: 'ui-monospace, monospace', label: 'Mono' }, { value: '"Comic Sans MS", cursive', label: 'Handwritten' }]} onChange={(v) => editLayer((l) => { l.font = v })} />
            <Check label="Bold" value={!!layer.bold} onChange={(v) => editLayer((l) => { l.bold = v })} />
          </Section>}
          {(layer.kind === 'shape' || layer.kind === 'text') && <Section title="Style">
            <div className="row"><Color label="Fill" value={layer.fill ?? '#ffffff'} onChange={(v) => editLayer((l) => { l.fill = v }, false)} /><Color label="Stroke" value={layer.stroke ?? '#000000'} onChange={(v) => editLayer((l) => { l.stroke = v }, false)} /></div>
            <Slider label="Stroke" min={0} max={40} step={0.5} value={layer.strokeWidth ?? 0} onChange={(v) => editLayer((l) => { l.strokeWidth = v }, false)} />
            {layer.kind === 'shape' && <>
              <Slider label="Width" min={2} max={3000} step={1} value={layer.w ?? 200} onChange={(v) => editLayer((l) => { l.w = v }, false)} />
              <Slider label="Height" min={2} max={3000} step={1} value={layer.h ?? 200} onChange={(v) => editLayer((l) => { l.h = v }, false)} />
              {(layer.shape === 'polygon' || layer.shape === 'star') && <Slider label="Points" min={3} max={16} step={1} value={layer.sides ?? 5} onChange={(v) => editLayer((l) => { l.sides = v }, false)} />}
            </>}
          </Section>}
          {layer.kind === 'drawing' && <Section title="Frames">
            <div className="hint">{layer.frames?.length ?? 0} drawings · current #{frameIdx + 1}. Each drawing holds for N animation frames.</div>
            <Slider label="Hold" min={1} max={12} step={1} value={layer.frames?.[frameIdx]?.hold ?? 1} onChange={(v) => editLayer((l) => { if (l.frames?.[frameIdx]) l.frames[frameIdx].hold = v })} />
            <button onClick={() => editLayer((l) => { l.frames?.forEach((f) => { f.hold = layer.frames![frameIdx]?.hold ?? 1 }) })}>Apply hold to all</button>
          </Section>}
          <Section title="Properties  (◆ = keyframe at playhead)">
            {ANIM_PROPS.filter((pp) => pp !== 'path' || layer.path).map((prop) => {
              const v = layerValue(layer, prop, time)
              const keys = layer.keys[prop] ?? []
              const local = time - layer.start
              const onKey = keys.findIndex((k) => Math.abs(k.t - local) < 0.5 / doc.fps)
              const [mn, mx, st] = PROP_RANGE[prop]
              return (
                <div className="row kfrow" key={prop}>
                  <div style={{ flex: 1, minWidth: 0 }}><Slider label={prop} min={mn} max={mx} step={st} value={v} onCommit={useStore.getState().checkpoint}
                    onChange={(nv) => editLayer((l) => setProp(l, prop, nv), false)} /></div>
                  <button className="icon" title="Toggle keyframe" style={{ color: onKey >= 0 ? '#8b5cf6' : keys.length ? '#a78bfa88' : '#666' }}
                    onClick={() => editLayer((l) => { l.keys[prop] = onKey >= 0 ? keys.filter((_, i) => i !== onKey) : setKey(keys, Math.max(0, local), v) })}>◆</button>
                </div>
              )
            })}
            {selKey && layer.keys[selKey.prop]?.[selKey.i] && <Select label={`Ease (${selKey.prop} key)`} value={layer.keys[selKey.prop]![selKey.i].ease} options={EASES} onChange={(v) => editLayer((l) => { l.keys[selKey.prop]![selKey.i].ease = v })} />}
            <button onClick={() => editLayer((l) => { l.keys = {} })}>Clear all keyframes</button>
          </Section>
          <Section title="Motion templates (writes keyframes)">
            <div className="grid2">{Object.keys(KEY_TEMPLATES).map((n) => <button key={n} onClick={() => editLayer((l, a) => {
              const local = Math.max(0, time - l.start)
              for (const [prop, ks] of Object.entries(KEY_TEMPLATES[n](l, a, local))) {
                l.keys[prop as AnimProp] = ks!.map((k) => ({ t: clamp(k.t, 0, l.end - l.start), value: k.v, ease: k.e ?? 'easeInOut' })).sort((p, q) => p.t - q.t)
              }
            })}>{n}</button>)}</div>
          </Section>
          <Section title="🔗 Parent & motion path">
            <Select label="Attach to" value={layer.parentId ?? ''} options={[{ value: '', label: 'None' }, ...doc.layers.filter((x) => x.id !== layer.id && !isDescendant(doc, x.id, layer.id)).map((x) => ({ value: x.id, label: x.name }))]}
              onChange={(v) => edit((a) => { const l = a.layers.find((x) => x.id === layer.id)!; l.parentId = v || undefined })} />
            <div className="hint">An attached layer follows its parent's movement, rotation and scale (e.g. a hat on a head, a wheel on a car).</div>
            {layer.kind !== 'drawing' && <>
              <div className="row">
                <button className={pathMode ? 'active' : ''} onClick={() => {
                  if (!pathMode) { edit((a) => { const l = a.layers.find((x) => x.id === layer.id)!; if (!l.path) { l.path = { pts: [], orient: false }; l.base.x = 0; l.base.y = 0; delete l.keys.x; delete l.keys.y } }); setPathMode(true) }
                  else {
                    setPathMode(false)
                    edit((a) => { const l = a.layers.find((x) => x.id === layer.id)!; if (!l.path || l.path.pts.length < 2) { l.path = undefined; return } if (!l.keys.path?.length) l.keys.path = [{ t: 0, value: 0, ease: 'linear' }, { t: l.end - l.start, value: 1, ease: 'easeInOut' }] })
                  }
                }}>{pathMode ? '✓ Done drawing path' : layer.path ? '〰 Add points to path' : '〰 Draw motion path'}</button>
                {layer.path && <button onClick={() => { setPathMode(false); edit((a) => { const l = a.layers.find((x) => x.id === layer.id)!; l.path = undefined; delete l.keys.path }) }}>Clear path</button>}
              </div>
              {pathMode && <div className="hint">Click on the stage to add points along the path, then press "Done". Drag the white dots later to reshape it.</div>}
              {layer.path && <Check label="Rotate to follow the path" value={layer.path.orient} onChange={(v) => edit((a) => { const l = a.layers.find((x) => x.id === layer.id)!; l.path = { ...l.path!, orient: v } })} />}
              {layer.path && <div className="hint">Speed along the path is the "path" property (0 → 1). Shape the timing in the Graph view.</div>}
            </>}
          </Section>
          {layer.kind !== 'drawing' && <Section title="🎯 Motion tracking" defaultOpen={!!doc.refVideo}>
            {!doc.refVideo ? <div className="hint">Add a video underneath (left panel) to track real motion.</div> : <>
              <div className="hint">Move the playhead to where tracking should start, click "Pick point", then click a clear, high-contrast spot in the video (an eye, a logo, a corner). This layer will follow it.</div>
              <div className="row">
                <button className={trackPick ? 'active' : 'primary'} onClick={() => setTrackPick(!trackPick)}>{trackPick ? 'Click the video…' : '🎯 Pick point & track'}</button>
                {trackStatus?.startsWith('Tracking…') && <button onClick={() => { trackCancel.current = true }}>Stop</button>}
              </div>
              <Check label="Keep the layer's current distance from the point" value={keepOffset} onChange={setKeepOffset} />
              {trackStatus && <div className="small">{trackStatus}</div>}
            </>}
          </Section>}
          <Section title="Preset animations">
            <Select label="In" value={layer.presetIn ?? 'none'} options={IN_PRESETS} onChange={(v) => editLayer((l) => { l.presetIn = v })} />
            <Select label="Out" value={layer.presetOut ?? 'none'} options={IN_PRESETS} onChange={(v) => editLayer((l) => { l.presetOut = v })} />
            <Select label="Loop" value={layer.presetLoop ?? 'none'} options={LOOP_PRESETS} onChange={(v) => editLayer((l) => { l.presetLoop = v })} />
            <Select label="Effect" value={layer.effect ?? 'none'} options={['none', 'glow', 'shadow', 'glitch'] as const} onChange={(v) => editLayer((l) => { l.effect = v })} />
          </Section>
          <div className="section-body">
            <button onClick={() => edit((a) => { const i = a.layers.findIndex((x) => x.id === layer.id); const d = JSON.parse(JSON.stringify(layer)); d.id = nanoid(8); d.name += ' copy'; d.base.x += 40; d.base.y += 40; a.layers.splice(i, 0, d) })}>Duplicate layer</button>
            <button className="danger" onClick={() => { edit((a) => { a.layers = a.layers.filter((x) => x.id !== layer.id); a.layers.forEach((x) => { if (x.parentId === layer.id) x.parentId = undefined }) }); setLayerId(null) }}>Delete layer</button>
          </div>
        </>}
      </div>

      {/* TIMELINE */}
      <div className="anim-tl">
        <div className="row" style={{ padding: '4px 8px', borderBottom: '1px solid var(--line)' }}>
          <button className={!graph ? 'active' : ''} onClick={() => setGraph(false)}>▤ Keyframes</button>
          <button className={graph ? 'active' : ''} disabled={!layer} title={layer ? '' : 'Select a layer first'} onClick={() => setGraph(true)}>📈 Graph editor</button>
          <span className="hint">{graph ? 'Drag points to change value and timing (Shift: time only, Alt: value only). Double-click to add a key.' : 'Drag ◆ keys to retime them. Click a layer name to expand its properties.'}</span>
        </div>
        {graph && layer ? <Graph doc={doc} layer={layer} time={time} pps={pps} onSeek={setTime} onEdit={(fn, undo = true) => editLayer((l) => fn(l), undo)} /> :
        <div className="anim-rows">
          <div className="anim-row" style={{ position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 3 }}>
            <div className="rname muted">Time</div>
            <div className="lane" style={{ minWidth: tlWidth, cursor: 'pointer' }} onPointerDown={scrub}>
              {Array.from({ length: Math.ceil(doc.duration * 4) + 1 }, (_, i) => i / 4).map((t) => (
                <div key={t} style={{ position: 'absolute', left: timeToX(t), top: t % 1 ? 14 : 0, bottom: 0, borderLeft: '1px solid #555', fontSize: 10, paddingLeft: 2, color: '#888' }}>{t % 1 ? '' : t + 's'}</div>
              ))}
            </div>
          </div>
          {doc.audio && <div className="anim-row" style={{ height: 34 }}>
            <div className="rname">🎵 {project.media.find((m) => m.id === doc.audio!.mediaId)?.name ?? 'Audio'}</div>
            <div className="lane" style={{ minWidth: tlWidth }} onPointerDown={scrub}><AudioLane mediaId={doc.audio.mediaId} offset={doc.audio.offset} duration={doc.duration} width={tlWidth} /></div>
          </div>}
          {doc.layers.map((l) => {
            const propsWithKeys = ANIM_PROPS.filter((p) => l.keys[p]?.length)
            return (
              <div key={l.id}>
                <div className={'anim-row ' + (l.id === layerId ? 'on' : '')}>
                  <div className="rname" onClick={() => { setLayerId(l.id); setExpanded((x) => ({ ...x, [l.id]: !x[l.id] })) }}>{propsWithKeys.length ? (expanded[l.id] ? '▾ ' : '▸ ') : '  '}{l.name}</div>
                  <div className="lane" style={{ minWidth: tlWidth }} onPointerDown={scrub}>
                    <div className="anim-bar" style={{ left: timeToX(l.start), width: timeToX(l.end - l.start) }} onPointerDown={(e) => dragBar(e, l)} />
                    {propsWithKeys.flatMap((p) => l.keys[p]!.map((k, i) => (
                      <div key={p + i} className="kf" style={{ left: timeToX(l.start + k.t), opacity: 0.6 }} onPointerDown={(e) => dragKey(e, l, p, i)} />
                    )))}
                  </div>
                </div>
                {expanded[l.id] && propsWithKeys.map((p) => (
                  <div key={p} className="anim-row prop">
                    <div className="rname">{p}</div>
                    <div className="lane" style={{ minWidth: tlWidth }} onPointerDown={scrub}>
                      {l.keys[p]!.map((k, i) => (
                        <div key={i} title={`${p} = ${k.value.toFixed(2)} @ ${(l.start + k.t).toFixed(2)}s (${k.ease})`} className={'kf ' + (selKey?.prop === p && selKey.i === i && l.id === layerId ? 'sel' : '')}
                          style={{ left: timeToX(l.start + k.t) }} onPointerDown={(e) => dragKey(e, l, p, i)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 180 + timeToX(time), width: 2, background: 'var(--accent)', pointerEvents: 'none', zIndex: 4 }} />
        </div>}
        {layer?.kind === 'drawing' && <div className="frame-strip">
          {(layer.frames ?? []).map((f, i) => (
            <div key={f.id} className={'frame-thumb ' + (i === frameIdx ? 'on' : '')} onClick={() => {
              setFrameIdx(i)
              const before = (layer.frames ?? []).slice(0, i).reduce((s, x) => s + Math.max(1, x.hold), 0)
              setTime(layer.start + (before + 0.01) / doc.fps)
            }}>
              {f.dataUrl && <img src={f.dataUrl} alt="" />}<span>{i + 1}{f.hold > 1 ? ` ×${f.hold}` : ''}</span>
            </div>
          ))}
          <button onClick={() => editLayer((l) => { l.frames!.splice(frameIdx + 1, 0, { id: nanoid(6), dataUrl: '', hold: l.frames![frameIdx]?.hold ?? 2 }) })}>＋ Blank</button>
          <button onClick={() => editLayer((l) => { const f = l.frames![frameIdx]; l.frames!.splice(frameIdx + 1, 0, { ...f, id: nanoid(6) }) })}>⧉ Duplicate</button>
          <button disabled={(layer.frames?.length ?? 0) < 2} onClick={() => { editLayer((l) => { l.frames!.splice(frameIdx, 1) }); setFrameIdx((i) => Math.max(0, i - 1)) }}>🗑</button>
          <button onClick={() => editLayer((l) => { if (l.frames?.[frameIdx]) l.frames[frameIdx].dataUrl = '' })}>Clear</button>
          <span className="hint">, and . step drawings</span>
        </div>}
      </div>
    </div>
  )
}

export { renderAnimation }
