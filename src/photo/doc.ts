import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { antsCanvases, maskToCanvas, type Mask } from './algos'
import { loadDoc, saveDoc, saveBlob, loadBlob, deleteBlob, deleteDoc, docKeys } from '../core/db'
import { drawText, drawShapeProps, renderStyles, hasStyles, type TextProps, type ShapeProps, type LayerStyles } from './live'
import { FILTERS } from './filters'

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
  /** raster (default), editable text, editable shape, or adjustment layer */
  kind?: 'raster' | 'text' | 'shape' | 'adjust'
  text?: TextProps
  shape?: ShapeProps
  adjust?: { filterId: string; values: Record<string, number> }
  /** greyscale, opaque: white shows the layer, black hides it */
  mask?: HTMLCanvasElement | null
  maskEnabled?: boolean
  styles?: LayerStyles
}

type LayerMeta = Omit<Layer, 'canvas' | 'mask'> & { hasMask?: boolean }
const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))
export function layerMeta(l: Layer): LayerMeta {
  return { id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, locked: l.locked, frame: clone(l.frame), kind: l.kind, text: clone(l.text), shape: clone(l.shape), adjust: clone(l.adjust), maskEnabled: l.maskEnabled, styles: clone(l.styles), hasMask: !!l.mask }
}

/** Re-render the pixels of an editable text/shape layer from its properties. */
export function renderLive(l: Layer) {
  if (l.kind !== 'text' && l.kind !== 'shape') return
  const x = ctx2d(l.canvas)
  x.clearRect(0, 0, l.canvas.width, l.canvas.height)
  if (l.kind === 'text' && l.text) drawText(x, l.text)
  if (l.kind === 'shape' && l.shape) drawShapeProps(x, l.shape)
}
/** Convert an editable layer into plain pixels. */
export function rasterize(l: Layer) {
  if (l.kind === 'text' || l.kind === 'shape') { l.kind = 'raster'; l.text = undefined; l.shape = undefined; return true }
  return false
}
export function newMask(w: number, h: number, sel?: Uint8ClampedArray | null) {
  const c = makeCanvas(w, h), x = ctx2d(c)
  if (sel) {
    const id = x.createImageData(w, h)
    for (let i = 0; i < sel.length; i++) { const v = sel[i]; id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255 }
    x.putImageData(id, 0, 0)
  } else { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h) }
  return c
}
/** Convert the greyscale mask into an alpha mask usable with destination-in. */
const alphaCache = new WeakMap<HTMLCanvasElement, { v: number; c: HTMLCanvasElement }>()
function alphaMask(m: HTMLCanvasElement, v: number) {
  const hit = alphaCache.get(m)
  if (hit && hit.v === v) return hit.c
  const c = hit?.c ?? makeCanvas(m.width, m.height)
  if (c.width !== m.width || c.height !== m.height) { c.width = m.width; c.height = m.height }
  const d = ctx2d(m).getImageData(0, 0, m.width, m.height)
  for (let i = 0; i < d.data.length; i += 4) { d.data[i + 3] = d.data[i]; d.data[i] = d.data[i + 1] = d.data[i + 2] = 0 }
  ctx2d(c).putImageData(d, 0, 0)
  alphaCache.set(m, { v, c })
  return c
}
let renderVersion = 0
export const nextRenderVersion = () => ++renderVersion

interface Snapshot {
  label: string
  w: number
  h: number
  layers: (LayerMeta & { data: ImageData; maskData?: ImageData })[]
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
  id = ''
  /** when true, painting tools edit the active layer's mask */
  maskEdit = false
  private compCache: { v: number; c: HTMLCanvasElement } | null = null
  private tmp1 = makeCanvas(1, 1)
  private tmp2 = makeCanvas(1, 1)
  private styleOut = new WeakMap<Layer, HTMLCanvasElement>()

  /** Canvas that painting tools should modify. */
  paintCanvas(l = this.layer) { return this.maskEdit && l.mask ? l.mask : l.canvas }

  constructor(w = 1600, h = 1000, fill: string | null = '#ffffff') {
    this.reset(w, h, fill)
  }

  reset(w: number, h: number, fill: string | null = '#ffffff') {
    // keep the document being replaced: save it before starting a new one
    if (this.id && this.layers.length) void savePhotoDoc(this)
    this.id = nanoid(10)
    this.name = 'Untitled'
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
    if (!target && !opts.hideLayer && this.compCache && this.compCache.v === renderVersion && this.compCache.c.width === this.width && this.compCache.c.height === this.height) return this.compCache.c
    const c = target ?? (this.compCache?.c && !opts.hideLayer ? this.compCache.c : makeCanvas(this.width, this.height))
    if (c.width !== this.width || c.height !== this.height) { c.width = this.width; c.height = this.height }
    const x = ctx2d(c)
    x.clearRect(0, 0, c.width, c.height)
    for (const l of this.layers) {
      if (!l.visible || l.id === opts.hideLayer) continue
      if (l.kind === 'adjust' && l.adjust) { this.applyAdjust(c, l); continue }
      let src: HTMLCanvasElement = l.canvas
      if (l.mask && l.maskEnabled !== false) {
        const t = this.sized(this.tmp1), tx = ctx2d(t)
        tx.globalCompositeOperation = 'source-over'; tx.clearRect(0, 0, t.width, t.height)
        tx.drawImage(l.canvas, 0, 0)
        tx.globalCompositeOperation = 'destination-in'; tx.drawImage(alphaMask(l.mask, renderVersion), 0, 0)
        tx.globalCompositeOperation = 'source-over'
        src = t
      }
      if (hasStyles(l.styles)) {
        let out = this.styleOut.get(l)
        if (!out) { out = makeCanvas(1, 1); this.styleOut.set(l, out) }
        src = renderStyles(src, l.styles!, out)
      }
      x.globalAlpha = l.opacity
      x.globalCompositeOperation = l.blend
      x.drawImage(src, 0, 0)
    }
    x.globalAlpha = 1
    x.globalCompositeOperation = 'source-over'
    if (!target && !opts.hideLayer) this.compCache = { v: renderVersion, c }
    return c
  }
  private sized(c: HTMLCanvasElement) { if (c.width !== this.width || c.height !== this.height) { c.width = this.width; c.height = this.height } return c }
  private applyAdjust(acc: HTMLCanvasElement, l: Layer) {
    const f = FILTERS.find((x) => x.id === l.adjust!.filterId)
    if (!f) return
    const ax = ctx2d(acc)
    const d = ax.getImageData(0, 0, acc.width, acc.height)
    f.apply(d, l.adjust!.values)
    const t = this.sized(this.tmp2), tx = ctx2d(t)
    tx.globalCompositeOperation = 'source-over'
    tx.putImageData(d, 0, 0)
    if (l.mask && l.maskEnabled !== false) { tx.globalCompositeOperation = 'destination-in'; tx.drawImage(alphaMask(l.mask, renderVersion), 0, 0); tx.globalCompositeOperation = 'source-over' }
    ax.globalAlpha = l.opacity
    ax.globalCompositeOperation = l.blend
    ax.drawImage(t, 0, 0)
    ax.globalAlpha = 1; ax.globalCompositeOperation = 'source-over'
  }
  /** Render a list of layers (with masks, styles and adjustments) into a new canvas. */
  renderLayers(list: Layer[]) {
    const saved = this.layers
    this.layers = list
    try { return this.composite(makeCanvas(this.width, this.height)) } finally { this.layers = saved }
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
        return { ...layerMeta(l), data: reuse ? pl.data : this.layerData(l), maskData: l.mask ? (reuse && pl.maskData ? pl.maskData : ctx2d(l.mask).getImageData(0, 0, l.mask.width, l.mask.height)) : undefined }
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
      let mask: HTMLCanvasElement | null = null
      if (l.maskData) { mask = makeCanvas(l.maskData.width, l.maskData.height); ctx2d(mask).putImageData(l.maskData, 0, 0) }
      const { data: _d, maskData: _m, hasMask: _h, ...meta } = l
      return { ...clone(meta), canvas: c, mask }
    })
    if (!this.layers[this.active]?.mask) this.maskEdit = false
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
      if (l.mask) { const m = newMask(w, h); ctx2d(m).drawImage(l.mask, -Math.round(x), -Math.round(y)); l.mask = m }
      if (l.frame) { l.frame.x -= x; l.frame.y -= y }
      if (l.text) { l.text.x -= x; l.text.y -= y }
      if (l.shape) { l.shape.x -= x; l.shape.y -= y }
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
      if (l.mask) { const m = newMask(w, h); const mx = ctx2d(m); mx.fillStyle = '#000'; mx.fillRect(0, 0, w, h); fn(mx, l.mask); l.mask = m }
      rasterize(l)
    }
    this.width = w; this.height = h
    if (!only) this.setSelection(null)
  }

  flatten(): HTMLCanvasElement { return this.composite() }
}

/* ---- persistence (one record per photo document) ---- */
interface SavedMeta { id?: string; w: number; h: number; name: string; layers: LayerMeta[]; active: number; paths: VPath[]; slices: Rect[]; notes: PhotoDoc['notes']; counts: PhotoDoc['counts']; updatedAt?: number; thumb?: string }
export interface PhotoDocInfo { id: string; name: string; w: number; h: number; updatedAt: number; thumb?: string; layers: number }

function thumbOf(d: PhotoDoc) {
  const c = d.composite(), s = Math.min(1, 200 / Math.max(c.width, c.height))
  const t = makeCanvas(Math.max(1, Math.round(c.width * s)), Math.max(1, Math.round(c.height * s)))
  ctx2d(t).drawImage(c, 0, 0, t.width, t.height)
  return t.toDataURL('image/jpeg', 0.7)
}

export async function savePhotoDoc(d: PhotoDoc) {
  const id = d.id
  if (!id) return
  const meta: SavedMeta = { id, w: d.width, h: d.height, name: d.name, active: d.active, paths: d.paths, slices: d.slices, notes: d.notes, counts: d.counts, layers: d.layers.map(layerMeta), updatedAt: Date.now(), thumb: thumbOf(d) }
  const put = (c: HTMLCanvasElement, key: string) => new Promise<void>((res) => c.toBlob(async (b) => { if (b) await saveBlob(key, b); res() }, 'image/png'))
  await Promise.all(d.layers.flatMap((l) => [put(l.canvas, 'photo-layer:' + l.id), ...(l.mask ? [put(l.mask, 'photo-mask:' + l.id)] : [])]))
  await saveDoc('photo-doc:' + id, meta)
  if (d.id === id) await saveDoc('photo-current', id)
}

/** Load a photo document (the last one used if no id is given). */
export async function loadPhotoDoc(d: PhotoDoc, id?: string) {
  let meta: SavedMeta | undefined
  const cur = id ?? (await loadDoc<string>('photo-current'))
  if (cur) meta = await loadDoc<SavedMeta>('photo-doc:' + cur)
  if (!meta && !id) {
    // older versions stored a single document under 'photo-doc'
    meta = await loadDoc<SavedMeta>('photo-doc')
    if (meta) meta.id = nanoid(10)
  }
  if (!meta) return false
  const layers: Layer[] = []
  for (const lm of meta.layers) {
    const c = makeCanvas(meta.w, meta.h)
    const b = await loadBlob('photo-layer:' + lm.id)
    if (b) { const bmp = await createImageBitmap(b); ctx2d(c).drawImage(bmp, 0, 0) }
    let mask: HTMLCanvasElement | null = null
    if (lm.hasMask) {
      const mb = await loadBlob('photo-mask:' + lm.id)
      mask = newMask(meta.w, meta.h)
      if (mb) { const bmp = await createImageBitmap(mb); ctx2d(mask).drawImage(bmp, 0, 0) }
    }
    const { hasMask: _h, ...rest } = lm
    layers.push({ ...rest, canvas: c, mask })
  }
  if (!layers.length) return false
  d.id = meta.id!
  d.width = meta.w; d.height = meta.h; d.name = meta.name; d.layers = layers; d.active = Math.min(meta.active, layers.length - 1)
  d.paths = meta.paths ?? []; d.slices = meta.slices ?? []; d.notes = meta.notes ?? []; d.counts = meta.counts ?? []
  d.history = []; d.historyIndex = -1; d.selection = null; d.maskEdit = false; d.invalidateSel()
  d.commit('Open')
  d.historySource = 0
  await saveDoc('photo-current', d.id)
  return true
}

export async function listPhotoDocs(): Promise<PhotoDocInfo[]> {
  const out: PhotoDocInfo[] = []
  for (const k of (await docKeys()).map(String).filter((k) => k.startsWith('photo-doc:'))) {
    const m = await loadDoc<SavedMeta>(k)
    if (m?.id) out.push({ id: m.id, name: m.name, w: m.w, h: m.h, updatedAt: m.updatedAt ?? 0, thumb: m.thumb, layers: m.layers.length })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}
export async function deletePhotoDoc(id: string) {
  const m = await loadDoc<SavedMeta>('photo-doc:' + id)
  if (m) for (const l of m.layers) { await deleteBlob('photo-layer:' + l.id); await deleteBlob('photo-mask:' + l.id) }
  await deleteDoc('photo-doc:' + id)
}
export async function duplicatePhotoDoc(id: string) {
  const m = await loadDoc<SavedMeta>('photo-doc:' + id)
  if (!m) return
  const copy: SavedMeta = { ...JSON.parse(JSON.stringify(m)), id: nanoid(10), name: m.name + ' copy', updatedAt: Date.now() }
  for (const l of copy.layers) {
    const old = l.id
    l.id = nanoid(8)
    const b = await loadBlob('photo-layer:' + old); if (b) await saveBlob('photo-layer:' + l.id, b)
    const mb = await loadBlob('photo-mask:' + old); if (mb) await saveBlob('photo-mask:' + l.id, mb)
  }
  await saveDoc('photo-doc:' + copy.id, copy)
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
  showMask: boolean
}
export const usePhoto = create<PhotoUI>(() => ({
  version: 0, dirty: false, screenMode: 0, quickMask: false,
  view: { zoom: 1, panX: 0, panY: 0, rot: 0 }, fg: '#000000', bg: '#ffffff', showMask: false,
}))

let saveTimer: ReturnType<typeof setTimeout> | undefined
export function bump(persist = false) {
  nextRenderVersion()
  usePhoto.setState((s) => ({ version: s.version + 1 }))
  if (persist) {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void savePhotoDoc(doc), 2500)
  }
}

/** Bundle the photo document for a project file. */
export async function photoBundle(d: PhotoDoc) {
  await savePhotoDoc(d)
  const meta = await loadDoc<SavedMeta>('photo-doc:' + d.id)
  const layers: { id: string; blob: Blob }[] = []
  for (const l of d.layers) {
    const b = await loadBlob('photo-layer:' + l.id)
    if (b) layers.push({ id: l.id, blob: b })
    const m = l.mask ? await loadBlob('photo-mask:' + l.id) : undefined
    if (m) layers.push({ id: 'mask_' + l.id, blob: m })
  }
  return { meta, layers }
}
export async function restorePhotoBundle(d: PhotoDoc, meta: unknown, layers: Record<string, Blob>) {
  const m = meta as SavedMeta
  if (!m.id) m.id = nanoid(10)
  if (d.id && d.layers.length) await savePhotoDoc(d)
  await saveDoc('photo-doc:' + m.id, m)
  await saveDoc('photo-current', m.id)
  for (const [id, b] of Object.entries(layers)) await saveBlob(id.startsWith('mask_') ? 'photo-mask:' + id.slice(5) : 'photo-layer:' + id, b)
  await loadPhotoDoc(d, m.id)
  bump()
}

/** The single open photo document (created after the store it notifies). */
export const doc = new PhotoDoc()
