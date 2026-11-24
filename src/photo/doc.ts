import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { antsCanvases, maskToCanvas, type Mask } from './algos'
import { loadDoc, saveDoc, saveBlob, loadBlob } from '../core/db'

export interface Anchor { x: number; y: number; ix: number; iy: number; ox: number; oy: number; smooth: boolean }
export interface VPath { id: string; name: string; anchors: Anchor[]; closed: boolean }
export interface Rect { x: number; y: number; w: number; h: number }
export interface FrameInfo { x: number; y: number; w: number; h: number; shape: 'rect' | 'ellipse' }

export interface Layer {
  id: string
  name: string
  canvas: HTMLCanvasElement
  visible: boolean
  opacity: number
  blend: GlobalCompositeOperation
  locked: boolean
  frame?: FrameInfo
}

interface Snapshot {
  label: string
  w: number
  h: number
  layers: { id: string; name: string; visible: boolean; opacity: number; blend: GlobalCompositeOperation; locked: boolean; frame?: FrameInfo; data: ImageData }[]
  active: number
  selection: Mask | null
}

export const BLENDS: GlobalCompositeOperation[] = ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']
export const BLEND_LABELS: Record<string, string> = { 'source-over': 'Normal' }

export function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  return c
}
export const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!

export class PhotoDoc {
  width = 1600
  height = 1000
  layers: Layer[] = [] // index 0 = bottom
  active = 0
  selection: Mask | null = null
  private selCanvas: HTMLCanvasElement | null = null
  private ants: [HTMLCanvasElement, HTMLCanvasElement] | null = null
  private qmCanvas: HTMLCanvasElement | null = null
  paths: VPath[] = []
  activePath: string | null = null
  slices: Rect[] = []
  activeSlice = -1
  notes: { x: number; y: number; text: string }[] = []
  counts: { x: number; y: number }[] = []
  samplers: { x: number; y: number }[] = []
  ruler: { x1: number; y1: number; x2: number; y2: number } | null = null
  history: Snapshot[] = []
  historyIndex = -1
  historySource = 0 // for history brush
  name = 'Untitled'

  constructor(w = 1600, h = 1000, fill: string | null = '#ffffff') {
    this.reset(w, h, fill)
  }

  reset(w: number, h: number, fill: string | null = '#ffffff') {
    this.width = w; this.height = h
    const c = makeCanvas(w, h)
    if (fill) { const x = ctx2d(c); x.fillStyle = fill; x.fillRect(0, 0, w, h) }
    this.layers = [{ id: nanoid(8), name: 'Background', canvas: c, visible: true, opacity: 1, blend: 'source-over', locked: false }]
    this.active = 0
    this.selection = null
    this.paths = []; this.slices = []; this.notes = []; this.counts = []; this.samplers = []; this.ruler = null
    this.history = []; this.historyIndex = -1
    this.invalidateSel()
    this.commit('New document')
    this.historySource = 0
  }

  get layer() { return this.layers[this.active] }

  addLayer(name = `Layer ${this.layers.length}`, canvas?: HTMLCanvasElement): Layer {
    const l: Layer = { id: nanoid(8), name, canvas: canvas ?? makeCanvas(this.width, this.height), visible: true, opacity: 1, blend: 'source-over', locked: false }
    this.layers.splice(this.active + 1, 0, l)
    this.active = this.active + 1
    return l
  }

  /* ---- selection ---- */
  setSelection(m: Mask | null) {
    if (m) { let any = false; for (let i = 0; i < m.length; i += 7) if (m[i]) { any = true; break } if (!any) for (let i = 0; i < m.length; i++) if (m[i]) { any = true; break } if (!any) m = null }
    this.selection = m
    this.invalidateSel()
  }
  invalidateSel() { this.selCanvas = null; this.ants = null; this.qmCanvas = null }
  selectionCanvas() {
    if (!this.selection) return null
    if (!this.selCanvas) this.selCanvas = maskToCanvas(this.selection, this.width, this.height)
    return this.selCanvas
  }
  antsCanvas(phase: number) {
    if (!this.selection) return null
    if (!this.ants) this.ants = antsCanvases(this.selection, this.width, this.height)
    return this.ants[phase % 2]
  }
  quickMaskCanvas() {
    if (!this.qmCanvas) this.qmCanvas = maskToCanvas(this.selection ?? new Uint8ClampedArray(this.width * this.height), this.width, this.height, [255, 0, 0], true)
    return this.qmCanvas
  }
  selAt(x: number, y: number) {
    if (!this.selection) return 255
    x = Math.floor(x); y = Math.floor(y)
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0
    return this.selection[y * this.width + x]
  }

  /* ---- composite ---- */
  composite(target?: HTMLCanvasElement, opts: { hideLayer?: string } = {}) {
    const c = target ?? makeCanvas(this.width, this.height)
    const x = ctx2d(c)
    x.clearRect(0, 0, c.width, c.height)
    for (const l of this.layers) {
      if (!l.visible || l.id === opts.hideLayer) continue
      x.globalAlpha = l.opacity
      x.globalCompositeOperation = l.blend
      x.drawImage(l.canvas, 0, 0)
    }
    x.globalAlpha = 1
    x.globalCompositeOperation = 'source-over'
    return c
  }
  compositeData() { return ctx2d(this.composite()).getImageData(0, 0, this.width, this.height) }
  layerData(l = this.layer) { return ctx2d(l.canvas).getImageData(0, 0, this.width, this.height) }

  /* ---- history ---- */
  commit(label: string, changed?: string[]) {
    const prev = this.history[this.historyIndex]
    const snap: Snapshot = {
      label, w: this.width, h: this.height, active: this.active,
      selection: this.selection ? Uint8ClampedArray.from(this.selection) : null,
      layers: this.layers.map((l) => {
        const pl = prev?.layers.find((p) => p.id === l.id)
        const reuse = changed && pl && !changed.includes(l.id) && prev.w === this.width && prev.h === this.height
        return { id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, locked: l.locked, frame: l.frame ? { ...l.frame } : undefined, data: reuse ? pl.data : this.layerData(l) }
      }),
    }
    this.history = this.history.slice(0, this.historyIndex + 1)
    this.history.push(snap)
    if (this.history.length > 40) { this.history.shift(); this.historySource = Math.max(0, this.historySource - 1) }
    this.historyIndex = this.history.length - 1
    bump(true)
  }
  restore(i: number) {
    const s = this.history[i]
    if (!s) return
    this.historyIndex = i
    this.width = s.w; this.height = s.h
    this.layers = s.layers.map((l) => {
      const c = makeCanvas(s.w, s.h)
      ctx2d(c).putImageData(l.data, 0, 0)
      return { id: l.id, name: l.name, canvas: c, visible: l.visible, opacity: l.opacity, blend: l.blend, locked: l.locked, frame: l.frame ? { ...l.frame } : undefined }
    })
    this.active = Math.min(s.active, this.layers.length - 1)
    this.selection = s.selection ? Uint8ClampedArray.from(s.selection) : null
    this.invalidateSel()
    bump(true)
  }
  undo() { if (this.historyIndex > 0) this.restore(this.historyIndex - 1) }
  redo() { if (this.historyIndex < this.history.length - 1) this.restore(this.historyIndex + 1) }
  historyLayerData(layerId: string): ImageData | null {
    const s = this.history[this.historySource]
    return s?.layers.find((l) => l.id === layerId)?.data ?? s?.layers[0]?.data ?? null
  }

  /* ---- canvas ops ---- */
  resizeCanvas(x: number, y: number, w: number, h: number, fill?: string) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h))
    for (const [i, l] of this.layers.entries()) {
      const c = makeCanvas(w, h)
      const cx = ctx2d(c)
      if (fill && i === 0) { cx.fillStyle = fill; cx.fillRect(0, 0, w, h) }
      cx.drawImage(l.canvas, -Math.round(x), -Math.round(y))
      l.canvas = c
      if (l.frame) { l.frame.x -= x; l.frame.y -= y }
    }
    this.width = w; this.height = h
    this.setSelection(null)
    this.slices = []
    const shift = (p: { x: number; y: number }) => { p.x -= x; p.y -= y }
    this.notes.forEach(shift); this.counts.forEach(shift); this.samplers.forEach(shift)
    this.paths.forEach((p) => p.anchors.forEach((a) => { a.x -= x; a.y -= y; a.ix -= x; a.iy -= y; a.ox -= x; a.oy -= y }))
  }
  transformLayers(fn: (ctx: CanvasRenderingContext2D, src: HTMLCanvasElement) => void, w = this.width, h = this.height, only?: Layer) {
    for (const l of only ? [only] : this.layers) {
      const c = makeCanvas(w, h)
      fn(ctx2d(c), l.canvas)
      l.canvas = c
    }
    this.width = w; this.height = h
    if (!only) this.setSelection(null)
  }

  flatten(): HTMLCanvasElement { return this.composite() }
}

/* ---- persistence ---- */
interface SavedMeta { w: number; h: number; name: string; layers: { id: string; name: string; visible: boolean; opacity: number; blend: GlobalCompositeOperation; locked: boolean; frame?: FrameInfo }[]; active: number; paths: VPath[]; slices: Rect[]; notes: PhotoDoc['notes']; counts: PhotoDoc['counts'] }

export async function savePhotoDoc(d: PhotoDoc) {
  const meta: SavedMeta = { w: d.width, h: d.height, name: d.name, active: d.active, paths: d.paths, slices: d.slices, notes: d.notes, counts: d.counts, layers: d.layers.map(({ canvas: _c, ...rest }) => rest) }
  await Promise.all(d.layers.map((l) => new Promise<void>((res) => l.canvas.toBlob(async (b) => { if (b) await saveBlob('photo-layer:' + l.id, b); res() }, 'image/png'))))
  await saveDoc('photo-doc', meta)
}
export async function loadPhotoDoc(d: PhotoDoc) {
  const meta = await loadDoc<SavedMeta>('photo-doc')
  if (!meta) return false
  const layers: Layer[] = []
  for (const lm of meta.layers) {
    const c = makeCanvas(meta.w, meta.h)
    const b = await loadBlob('photo-layer:' + lm.id)
    if (b) { const bmp = await createImageBitmap(b); ctx2d(c).drawImage(bmp, 0, 0) }
    layers.push({ ...lm, canvas: c })
  }
  if (!layers.length) return false
  d.width = meta.w; d.height = meta.h; d.name = meta.name; d.layers = layers; d.active = Math.min(meta.active, layers.length - 1)
  d.paths = meta.paths ?? []; d.slices = meta.slices ?? []; d.notes = meta.notes ?? []; d.counts = meta.counts ?? []
  d.history = []; d.historyIndex = -1; d.selection = null; d.invalidateSel()
  d.commit('Open')
  d.historySource = 0
  return true
}

/* ---- reactive version counter ---- */

interface PhotoUI {
  version: number
  dirty: boolean
  screenMode: 0 | 1 | 2
  quickMask: boolean
  view: { zoom: number; panX: number; panY: number; rot: number }
  fg: string
  bg: string
}
export const usePhoto = create<PhotoUI>(() => ({
  version: 0, dirty: false, screenMode: 0, quickMask: false,
  view: { zoom: 1, panX: 0, panY: 0, rot: 0 }, fg: '#000000', bg: '#ffffff',
}))

let saveTimer: ReturnType<typeof setTimeout> | undefined
export function bump(persist = false) {
  usePhoto.setState((s) => ({ version: s.version + 1 }))
  if (persist) {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void savePhotoDoc(doc), 2500)
  }
}

/** Bundle the photo document for a project file. */
export async function photoBundle(d: PhotoDoc) {
  await savePhotoDoc(d)
  const meta = await loadDoc<SavedMeta>('photo-doc')
  const layers: { id: string; blob: Blob }[] = []
  for (const l of d.layers) {
    const b = await loadBlob('photo-layer:' + l.id)
    if (b) layers.push({ id: l.id, blob: b })
  }
  return { meta, layers }
}
export async function restorePhotoBundle(d: PhotoDoc, meta: unknown, layers: Record<string, Blob>) {
  await saveDoc('photo-doc', meta)
  for (const [id, b] of Object.entries(layers)) await saveBlob('photo-layer:' + id, b)
  await loadPhotoDoc(d)
  bump()
}

/** The single open photo document (created after the store it notifies). */
export const doc = new PhotoDoc()
