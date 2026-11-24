import { useCallback, useEffect, useRef, useState } from 'react'
import { doc, bump, usePhoto, makeCanvas, ctx2d, BLENDS, BLEND_LABELS, loadPhotoDoc } from './doc'
import { TOOL_GROUPS, toolDef, groupOf, type ToolId, BRUSH_TOOLS } from './toolDefs'
import { ts, setTool, onDown, onMove, onUp, drawOverlay, applyPending, commitText, cancelTransient, straightenFromRuler, sampleColorAt, drawFramePlaceholder, pathToPath2D, pathMask, eyedrop } from './tools'
import { FILTERS, applyFilterMasked, type FilterDef } from './filters'
import { blurMask, morphMask, maskBounds, objectSelect, rgbToHex } from './algos'
import { Modal, Slider, Select } from '../ui/controls'
import { pickFiles, importFile } from '../core/media'
import { useStore } from '../core/store'

const notify = (m: string) => useStore.getState().notify(m)

function useVersion() { return usePhoto((s) => s.version) }

/* ------------------------- image loading ------------------------- */
async function fileToCanvas(f: Blob) {
  const bmp = await createImageBitmap(f)
  const c = makeCanvas(bmp.width, bmp.height)
  ctx2d(c).drawImage(bmp, 0, 0)
  return c
}
async function openImage(asLayer: boolean) {
  const [f] = await pickFiles('image/*', false)
  if (!f) return
  await loadImageFile(f, asLayer)
}
export async function loadImageFile(f: Blob & { name?: string }, asLayer: boolean) {
  const c = await fileToCanvas(f)
  const name = (f as File).name?.replace(/\.[^.]+$/, '') ?? 'Image'
  const active = doc.layer
  if (asLayer && active?.frame) {
    drawFramePlaceholder(active.canvas, active.frame, c)
    doc.commit('Place in frame', [active.id]); return
  }
  if (!asLayer) {
    doc.reset(c.width, c.height, null)
    doc.layers[0].name = name
    ctx2d(doc.layers[0].canvas).drawImage(c, 0, 0)
    doc.name = name
    doc.history = []; doc.historyIndex = -1
    doc.commit('Open'); doc.historySource = 0
    fitView()
  } else {
    const l = doc.addLayer(name)
    const s = Math.min(1, doc.width / c.width, doc.height / c.height)
    ctx2d(l.canvas).drawImage(c, (doc.width - c.width * s) / 2, (doc.height - c.height * s) / 2, c.width * s, c.height * s)
    doc.commit('Place')
  }
}

let wrapSize = { w: 800, h: 600 }
export function fitView() {
  const zoom = Math.min((wrapSize.w - 40) / doc.width, (wrapSize.h - 40) / doc.height, 4)
  usePhoto.setState({ view: { zoom, panX: 0, panY: 0, rot: 0 } })
}

/* ------------------------- menu actions ------------------------- */
function selectAll() { doc.setSelection(new Uint8ClampedArray(doc.width * doc.height).fill(255)); doc.commit('Select All', []) }
function deselect() { doc.setSelection(null); doc.commit('Deselect', []) }
function inverse() { const m = doc.selection ? Uint8ClampedArray.from(doc.selection, (v) => 255 - v) : null; doc.setSelection(m); doc.commit('Inverse', []) }
let clipboard: HTMLCanvasElement | null = null
function copySel(cut = false) {
  const l = doc.layer
  const c = makeCanvas(doc.width, doc.height), x = ctx2d(c)
  x.drawImage(l.canvas, 0, 0)
  const sc = doc.selectionCanvas()
  if (sc) { x.globalCompositeOperation = 'destination-in'; x.drawImage(sc, 0, 0) }
  clipboard = c
  c.toBlob((b) => { if (b && navigator.clipboard && 'write' in navigator.clipboard) navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).catch(() => {}) })
  if (cut) clearSel('Cut')
}
function pasteInternal() {
  if (!clipboard) return notify('Nothing copied yet')
  const l = doc.addLayer('Pasted')
  ctx2d(l.canvas).drawImage(clipboard, 0, 0)
  doc.commit('Paste')
}
function clearSel(label = 'Clear') {
  const l = doc.layer
  if (l.locked) return notify('Layer is locked')
  const x = ctx2d(l.canvas)
  const sc = doc.selectionCanvas()
  if (sc) { x.globalCompositeOperation = 'destination-out'; x.drawImage(sc, 0, 0); x.globalCompositeOperation = 'source-over' }
  else x.clearRect(0, 0, doc.width, doc.height)
  doc.commit(label, [l.id])
}
function fillSel(color: string) {
  const l = doc.layer
  const tmp = makeCanvas(doc.width, doc.height), x = ctx2d(tmp)
  x.fillStyle = color; x.fillRect(0, 0, doc.width, doc.height)
  const sc = doc.selectionCanvas()
  if (sc) { x.globalCompositeOperation = 'destination-in'; x.drawImage(sc, 0, 0) }
  ctx2d(l.canvas).drawImage(tmp, 0, 0)
  doc.commit('Fill', [l.id])
}
function strokeSel(width: number) {
  if (!doc.selection) return notify('Make a selection first')
  const l = doc.layer
  const outer = morphMask(doc.selection, doc.width, doc.height, Math.ceil(width / 2))
  const inner = morphMask(doc.selection, doc.width, doc.height, -Math.floor(width / 2))
  const d = doc.layerData()
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(usePhoto.getState().fg.slice(i, i + 2), 16))
  for (let p = 0; p < outer.length; p++) if (outer[p] && !inner[p]) { const i = p * 4; d.data[i] = r; d.data[i + 1] = g; d.data[i + 2] = b; d.data[i + 3] = 255 }
  ctx2d(l.canvas).putImageData(d, 0, 0)
  doc.commit('Stroke', [l.id])
}
function layerViaCopy() {
  const src = doc.layer
  const c = makeCanvas(doc.width, doc.height), x = ctx2d(c)
  x.drawImage(src.canvas, 0, 0)
  const sc = doc.selectionCanvas()
  if (sc) { x.globalCompositeOperation = 'destination-in'; x.drawImage(sc, 0, 0) }
  doc.addLayer(src.name + ' copy', c)
  doc.commit('Layer via Copy')
}
function mergeDown() {
  if (doc.active === 0) return
  const top = doc.layer, below = doc.layers[doc.active - 1]
  const x = ctx2d(below.canvas)
  x.globalAlpha = top.opacity; x.globalCompositeOperation = top.blend
  if (top.visible) x.drawImage(top.canvas, 0, 0)
  x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'
  doc.layers.splice(doc.active, 1)
  doc.active--
  doc.commit('Merge Down')
}
function flatten() {
  const c = makeCanvas(doc.width, doc.height), x = ctx2d(c)
  x.fillStyle = '#fff'; x.fillRect(0, 0, doc.width, doc.height)
  x.drawImage(doc.composite(), 0, 0)
  doc.layers = [{ ...doc.layers[0], name: 'Background', canvas: c, opacity: 1, blend: 'source-over', visible: true, frame: undefined }]
  doc.active = 0
  doc.commit('Flatten Image')
}
function rotateImage(deg: 90 | -90 | 180) {
  const w = deg === 180 ? doc.width : doc.height, h = deg === 180 ? doc.height : doc.width
  doc.transformLayers((x, src) => { x.translate(w / 2, h / 2); x.rotate((deg * Math.PI) / 180); x.drawImage(src, -src.width / 2, -src.height / 2) }, w, h)
  doc.commit('Rotate ' + deg + '°')
}
function flipImage(h: boolean, onlyLayer = false) {
  doc.transformLayers((x, src) => { x.translate(h ? doc.width : 0, h ? 0 : doc.height); x.scale(h ? -1 : 1, h ? 1 : -1); x.drawImage(src, 0, 0) }, doc.width, doc.height, onlyLayer ? doc.layer : undefined)
  doc.commit(onlyLayer ? 'Flip Layer' : 'Flip Canvas')
}
async function sendToVideo() {
  const c = doc.composite()
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
  if (!blob) return
  const m = await importFile(new File([blob], (doc.name || 'Photo') + '.png', { type: 'image/png' }))
  if (!m) return
  const st = useStore.getState()
  st.addMedia(m)
  st.addClipFromMedia(m)
  notify('Image added to the video timeline at the playhead')
}

/* ------------------------- Menu bar ------------------------- */
type MenuItem = { label: string; key?: string; action: () => void; disabled?: boolean } | '-'
function MenuBar({ onDialog }: { onDialog: (d: Dialog) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  useVersion()
  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: 'New…', key: 'Ctrl+N', action: () => onDialog({ kind: 'new' }) },
      { label: 'Open image…', key: 'Ctrl+O', action: () => void openImage(false) },
      { label: 'Place image as layer…', action: () => void openImage(true) },
      '-',
      { label: 'Send to Video Editor', action: () => void sendToVideo() },
      { label: 'Export (PNG/JPG/WebP)…', action: () => useStore.getState().setTab('export') },
    ],
    Edit: [
      { label: 'Undo', key: 'Ctrl+Z', action: () => doc.undo() },
      { label: 'Redo', key: 'Ctrl+Shift+Z', action: () => doc.redo() },
      '-',
      { label: 'Cut', key: 'Ctrl+X', action: () => copySel(true) },
      { label: 'Copy', key: 'Ctrl+C', action: () => copySel() },
      { label: 'Paste', key: 'Ctrl+V', action: pasteInternal },
      { label: 'Clear', key: 'Del', action: () => clearSel() },
      '-',
      { label: 'Fill with foreground', key: 'Alt+Del', action: () => fillSel(usePhoto.getState().fg) },
      { label: 'Fill with background', key: 'Ctrl+Del', action: () => fillSel(usePhoto.getState().bg) },
      { label: 'Stroke selection…', action: () => onDialog({ kind: 'stroke' }) },
      { label: 'Transform layer…', key: 'Ctrl+T', action: () => onDialog({ kind: 'transform' }) },
      { label: 'Flip layer horizontal', action: () => flipImage(true, true) },
      { label: 'Flip layer vertical', action: () => flipImage(false, true) },
    ],
    Image: [
      ...FILTERS.filter((f) => f.menu === 'Adjustments').map((f) => ({ label: f.name, action: () => (f.params.length ? onDialog({ kind: 'filter', filter: f }) : runFilter(f, {})) })),
      '-',
      { label: 'Image Size…', key: 'Ctrl+Alt+I', action: () => onDialog({ kind: 'imagesize' }) },
      { label: 'Canvas Size…', key: 'Ctrl+Alt+C', action: () => onDialog({ kind: 'canvassize' }) },
      { label: 'Rotate 90° CW', action: () => rotateImage(90) },
      { label: 'Rotate 90° CCW', action: () => rotateImage(-90) },
      { label: 'Rotate 180°', action: () => rotateImage(180) },
      { label: 'Flip canvas horizontal', action: () => flipImage(true) },
      { label: 'Flip canvas vertical', action: () => flipImage(false) },
      { label: 'Crop to selection', action: () => { const b = doc.selection && maskBounds(doc.selection, doc.width, doc.height); if (!b) return notify('Make a selection first'); doc.resizeCanvas(b.x, b.y, b.w, b.h); doc.commit('Crop') } },
    ],
    Layer: [
      { label: 'New layer', key: 'Ctrl+Shift+N', action: () => { doc.addLayer(); doc.commit('New Layer') } },
      { label: 'Duplicate / layer via copy', key: 'Ctrl+J', action: layerViaCopy },
      { label: 'Delete layer', action: () => deleteLayer() },
      { label: 'Merge down', key: 'Ctrl+E', action: mergeDown },
      { label: 'Flatten image', action: flatten },
      '-',
      { label: 'Place image in frame…', disabled: !doc.layer?.frame, action: () => void openImage(true) },
      { label: 'Rasterize frame (remove frame link)', disabled: !doc.layer?.frame, action: () => { doc.layer.frame = undefined; doc.commit('Rasterize frame') } },
    ],
    Select: [
      { label: 'All', key: 'Ctrl+A', action: selectAll },
      { label: 'Deselect', key: 'Ctrl+D', action: deselect },
      { label: 'Inverse', key: 'Ctrl+Shift+I', action: inverse },
      { label: 'Subject (auto)', action: () => { notify('Finding subject…'); setTimeout(() => { const m = objectSelect(doc.compositeData(), doc.width * 0.04, doc.height * 0.04, doc.width * 0.92, doc.height * 0.92); doc.setSelection(m); doc.commit('Select Subject', []) }, 20) } },
      { label: 'Feather…', key: 'Shift+F6', action: () => onDialog({ kind: 'feather' }) },
      { label: 'Expand…', action: () => onDialog({ kind: 'expand', sign: 1 }) },
      { label: 'Contract…', action: () => onDialog({ kind: 'expand', sign: -1 }) },
      { label: 'Edit in Quick Mask Mode', key: 'Q', action: () => usePhoto.setState((s) => ({ quickMask: !s.quickMask })) },
    ],
    Filter: FILTERS.filter((f) => f.menu === 'Filter').map((f) => ({ label: f.name, action: () => (f.params.length ? onDialog({ kind: 'filter', filter: f }) : runFilter(f, {})) })),
    View: [
      { label: 'Zoom in', key: 'Ctrl++', action: () => zoomBy(1.25) },
      { label: 'Zoom out', key: 'Ctrl+-', action: () => zoomBy(0.8) },
      { label: 'Fit on screen', key: 'Ctrl+0', action: fitView },
      { label: '100%', key: 'Ctrl+1', action: () => usePhoto.setState((s) => ({ view: { ...s.view, zoom: 1 } })) },
      { label: 'Reset rotation', key: 'Esc (Rotate tool)', action: () => usePhoto.setState((s) => ({ view: { ...s.view, rot: 0 } })) },
      { label: 'Change screen mode', key: 'F', action: () => usePhoto.setState((s) => ({ screenMode: ((s.screenMode + 1) % 3) as 0 | 1 | 2 })) },
    ],
  }
  return (
    <div className="row" style={{ gap: 0, position: 'relative' }} onMouseLeave={() => setOpen(null)}>
      {Object.entries(menus).map(([name, items]) => (
        <div key={name} style={{ position: 'relative' }}>
          <button className="icon" style={{ padding: '4px 9px', background: open === name ? 'var(--panel2)' : undefined }}
            onClick={() => setOpen(open === name ? null : name)} onMouseEnter={() => open && setOpen(name)}>{name}</button>
          {open === name && (
            <div className="tool-flyout" style={{ position: 'absolute', top: '100%', left: 0, maxHeight: '75vh', overflow: 'auto' }}>
              {items.map((it, i) => it === '-' ? <hr key={i} style={{ borderColor: 'var(--line)', margin: '3px 0' }} /> : (
                <button key={it.label} disabled={it.disabled} onClick={() => { setOpen(null); it.action() }}>{it.label}<span className="key">{it.key}</span></button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function deleteLayer() {
  if (doc.layers.length <= 1) return notify("Can't delete the only layer")
  doc.layers.splice(doc.active, 1)
  doc.active = Math.max(0, doc.active - 1)
  doc.commit('Delete Layer')
}
function zoomBy(f: number) { usePhoto.setState((s) => ({ view: { ...s.view, zoom: Math.min(64, Math.max(0.02, s.view.zoom * f)) } })) }

function runFilter(f: FilterDef, v: Record<string, number>) {
  const l = doc.layer
  if (l.locked) return notify('Layer is locked')
  const out = applyFilterMasked(doc.layerData(), f, v, doc.selection)
  ctx2d(l.canvas).putImageData(out, 0, 0)
  doc.commit(f.name.replace('…', ''), [l.id])
}

/* ------------------------- Dialogs ------------------------- */
type Dialog = { kind: 'new' } | { kind: 'filter'; filter: FilterDef } | { kind: 'imagesize' } | { kind: 'canvassize' } | { kind: 'feather' } | { kind: 'expand'; sign: 1 | -1 } | { kind: 'stroke' } | { kind: 'transform' }

function FilterDialog({ f, onClose }: { f: FilterDef; onClose: () => void }) {
  const [v, setV] = useState<Record<string, number>>(() => Object.fromEntries(f.params.map((p) => [p.key, p.def])))
  const orig = useRef<ImageData | null>(null)
  const [preview, setPreview] = useState(true)
  useEffect(() => { orig.current = doc.layerData(); return () => { /* noop */ } }, [])
  useEffect(() => {
    const o = orig.current
    if (!o) return
    const t = setTimeout(() => {
      const out = preview ? applyFilterMasked(o, f, v, doc.selection) : o
      ctx2d(doc.layer.canvas).putImageData(out, 0, 0)
      bump()
    }, 60)
    return () => clearTimeout(t)
  }, [v, preview, f])
  const cancel = () => { if (orig.current) ctx2d(doc.layer.canvas).putImageData(orig.current, 0, 0); bump(); onClose() }
  const ok = () => { const out = applyFilterMasked(orig.current!, f, v, doc.selection); ctx2d(doc.layer.canvas).putImageData(out, 0, 0); doc.commit(f.name.replace('…', ''), [doc.layer.id]); onClose() }
  return (
    <Modal title={f.name.replace('…', '')} onClose={cancel}>
      {f.params.map((p) => <Slider key={p.key} label={p.label} min={p.min} max={p.max} step={p.step} value={v[p.key]} onChange={(x) => setV({ ...v, [p.key]: x })} />)}
      <label className="check"><input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> Preview</label>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button onClick={cancel}>Cancel</button><button className="primary" onClick={ok}>OK</button></div>
    </Modal>
  )
}

function Dialogs({ d, onClose }: { d: Dialog; onClose: () => void }) {
  const [a, setA] = useState(0)
  const [b, setB] = useState(0)
  const [c, setC] = useState(0)
  const [s, setS] = useState('#ffffff')
  const [anchor, setAnchor] = useState<'center' | 'tl'>('center')
  useEffect(() => {
    if (d.kind === 'new') { setA(1920); setB(1080); setS('#ffffff') }
    if (d.kind === 'imagesize' || d.kind === 'canvassize') { setA(doc.width); setB(doc.height) }
    if (d.kind === 'feather') setA(5)
    if (d.kind === 'expand') setA(4)
    if (d.kind === 'stroke') setA(4)
    if (d.kind === 'transform') { setA(100); setB(0); setC(100) }
  }, [d])
  if (d.kind === 'filter') return <FilterDialog f={d.filter} onClose={onClose} />
  const footer = (ok: () => void) => <div className="row" style={{ justifyContent: 'flex-end' }}><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => { ok(); onClose() }}>OK</button></div>
  if (d.kind === 'new') return (
    <Modal title="New document" onClose={onClose}>
      <div className="grid2">
        {[['HD 1920×1080', 1920, 1080], ['Square 1080', 1080, 1080], ['Story 1080×1920', 1080, 1920], ['A4 300dpi', 2480, 3508], ['YouTube thumb', 1280, 720], ['4K', 3840, 2160]].map(([n, w, h]) => (
          <button key={n as string} onClick={() => { setA(w as number); setB(h as number) }}>{n}</button>
        ))}
      </div>
      <div className="row"><label className="field"><span>Width</span><input type="number" value={a} onChange={(e) => setA(+e.target.value)} /></label><label className="field"><span>Height</span><input type="number" value={b} onChange={(e) => setB(+e.target.value)} /></label></div>
      <Select label="Background" value={s} options={[{ value: '#ffffff', label: 'White' }, { value: '#000000', label: 'Black' }, { value: '', label: 'Transparent' }]} onChange={setS} />
      {footer(() => { doc.reset(Math.max(1, a), Math.max(1, b), s || null); doc.name = 'Untitled'; fitView() })}
    </Modal>
  )
  if (d.kind === 'imagesize') return (
    <Modal title="Image size (resample)" onClose={onClose}>
      <div className="row"><label className="field"><span>Width</span><input type="number" value={a} onChange={(e) => { setA(+e.target.value); setB(Math.round((+e.target.value * doc.height) / doc.width)) }} /></label><label className="field"><span>Height</span><input type="number" value={b} onChange={(e) => setB(+e.target.value)} /></label></div>
      <div className="hint">Width keeps the aspect ratio; edit height afterwards to stretch.</div>
      {footer(() => { const w = Math.max(1, a), h = Math.max(1, b); doc.transformLayers((x, src) => { x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, h) }, w, h); doc.commit('Image Size') })}
    </Modal>
  )
  if (d.kind === 'canvassize') return (
    <Modal title="Canvas size" onClose={onClose}>
      <div className="row"><label className="field"><span>Width</span><input type="number" value={a} onChange={(e) => setA(+e.target.value)} /></label><label className="field"><span>Height</span><input type="number" value={b} onChange={(e) => setB(+e.target.value)} /></label></div>
      <Select label="Anchor" value={anchor} options={[{ value: 'center', label: 'Center' }, { value: 'tl', label: 'Top-left' }]} onChange={setAnchor} />
      {footer(() => { const ox = anchor === 'center' ? (doc.width - a) / 2 : 0, oy = anchor === 'center' ? (doc.height - b) / 2 : 0; doc.resizeCanvas(ox, oy, a, b); doc.commit('Canvas Size') })}
    </Modal>
  )
  if (d.kind === 'feather') return (
    <Modal title="Feather selection" onClose={onClose}>
      <Slider label="Radius px" min={1} max={100} step={1} value={a} onChange={setA} />
      {footer(() => { if (doc.selection) { doc.setSelection(blurMask(doc.selection, doc.width, doc.height, a)); doc.commit('Feather', []) } })}
    </Modal>
  )
  if (d.kind === 'expand') return (
    <Modal title={d.sign > 0 ? 'Expand selection' : 'Contract selection'} onClose={onClose}>
      <Slider label="Pixels" min={1} max={50} step={1} value={a} onChange={setA} />
      {footer(() => { if (doc.selection) { doc.setSelection(morphMask(doc.selection, doc.width, doc.height, a * d.sign)); doc.commit(d.sign > 0 ? 'Expand' : 'Contract', []) } })}
    </Modal>
  )
  if (d.kind === 'stroke') return (
    <Modal title="Stroke selection" onClose={onClose}>
      <Slider label="Width px" min={1} max={60} step={1} value={a} onChange={setA} />
      <div className="hint">Uses the foreground colour.</div>
      {footer(() => strokeSel(a))}
    </Modal>
  )
  return (
    <Modal title="Transform layer" onClose={onClose}>
      <Slider label="Scale X %" min={1} max={400} step={1} value={a} onChange={setA} />
      <Slider label="Scale Y %" min={1} max={400} step={1} value={c} onChange={setC} />
      <Slider label="Rotate °" min={-180} max={180} step={0.5} value={b} onChange={setB} />
      {footer(() => {
        const l = doc.layer
        const cv = makeCanvas(doc.width, doc.height), x = ctx2d(cv)
        x.translate(doc.width / 2, doc.height / 2); x.rotate((b * Math.PI) / 180); x.scale(a / 100, c / 100); x.translate(-doc.width / 2, -doc.height / 2)
        x.drawImage(l.canvas, 0, 0)
        l.canvas = cv
        doc.commit('Free Transform', [l.id])
      })}
    </Modal>
  )
}

/* ------------------------- Toolbar ------------------------- */
const lastInGroup: Record<string, ToolId> = {}
function Toolbar() {
  useVersion()
  const [fly, setFly] = useState<{ gi: number; x: number; y: number } | null>(null)
  const fg = usePhoto((s) => s.fg), bg = usePhoto((s) => s.bg), qm = usePhoto((s) => s.quickMask)
  return (
    <div className="photo-tools" onMouseLeave={() => setFly(null)}>
      {TOOL_GROUPS.map((g, gi) => {
        const cur = g.tools.find((t) => t.id === ts.tool) ?? g.tools.find((t) => t.id === lastInGroup[g.key + gi]) ?? g.tools[0]
        const on = g.tools.some((t) => t.id === ts.tool)
        return (
          <button key={gi} className={'tool-btn ' + (on ? 'on' : '')} title={`${cur.name}${g.key ? ` (${g.key})` : ''}. Right-click or hold for more.`}
            onClick={() => { lastInGroup[g.key + gi] = cur.id; setTool(cur.id) }}
            onContextMenu={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setFly({ gi, x: r.right + 4, y: r.top }) }}
            onPointerDown={(e) => { const r = e.currentTarget.getBoundingClientRect(); const t = setTimeout(() => setFly({ gi, x: r.right + 4, y: r.top }), 350); const up = () => { clearTimeout(t); window.removeEventListener('pointerup', up) }; window.addEventListener('pointerup', up) }}>
            {cur.icon}{g.tools.length > 1 && <span className="more">◢</span>}
          </button>
        )
      })}
      {fly && (
        <div className="tool-flyout" style={{ left: fly.x, top: Math.min(fly.y, window.innerHeight - 260) }}>
          {TOOL_GROUPS[fly.gi].tools.map((t) => (
            <button key={t.id} onClick={() => { lastInGroup[TOOL_GROUPS[fly.gi].key + fly.gi] = t.id; setTool(t.id); setFly(null) }}>
              <span style={{ width: 20 }}>{t.icon}</span>{t.name}<span className="key">{TOOL_GROUPS[fly.gi].key}</span>
            </button>
          ))}
        </div>
      )}
      <div className="swatches" title="Foreground / background colour (D = default, X = swap)">
        <input type="color" className="fg" value={fg} onChange={(e) => usePhoto.setState({ fg: e.target.value })} />
        <input type="color" className="bg" value={bg} onChange={(e) => usePhoto.setState({ bg: e.target.value })} />
      </div>
      <button className="tool-btn" title="Swap colours (X)" style={{ fontSize: 12, height: 22 }} onClick={() => usePhoto.setState({ fg: bg, bg: fg })}>⇄</button>
      <button className={'tool-btn ' + (qm ? 'on' : '')} title="Edit in Quick Mask Mode (Q)" onClick={() => usePhoto.setState({ quickMask: !qm })}>◘</button>
      <button className="tool-btn" title="Change Screen Mode (F)" onClick={() => usePhoto.setState((s) => ({ screenMode: ((s.screenMode + 1) % 3) as 0 | 1 | 2 }))}>▣</button>
    </div>
  )
}

/* ------------------------- Options bar ------------------------- */
function OptionsBar() {
  useVersion()
  const [, force] = useState(0)
  const o = ts.opts
  const set = <K extends keyof typeof o>(k: K, v: (typeof o)[K]) => { o[k] = v; force((x) => x + 1); bump() }
  const t = ts.tool
  const def = toolDef(t)
  const num = (k: keyof typeof o, label: string, min: number, max: number, step = 1) => (
    <label key={k}>{label} <input type="range" min={min} max={max} step={step} value={o[k] as number} onChange={(e) => set(k, +e.target.value as never)} />
      <input type="number" min={min} max={max} step={step} value={Math.round((o[k] as number) * 100) / 100} onChange={(e) => set(k, +e.target.value as never)} /></label>
  )
  const sel = ['marquee-rect', 'marquee-ellipse', 'marquee-row', 'marquee-col', 'lasso', 'lasso-poly', 'lasso-magnetic', 'magic-wand', 'object-select', 'quick-select', 'selection-brush', 'type-mask-h', 'type-mask-v'].includes(t)
  const brushy = BRUSH_TOOLS.includes(t) || t === 'red-eye'
  return (
    <div className="options-bar">
      <span className="tool-name">{def.icon} {def.name}</span>
      {sel && <span className="row" style={{ gap: 2 }}>{(['new', 'add', 'subtract', 'intersect'] as const).map((m) => <button key={m} className={o.selMode === m ? 'active' : ''} title={m} onClick={() => set('selMode', m)}>{{ new: '▢', add: '⊞', subtract: '⊟', intersect: '⊠' }[m]}</button>)}</span>}
      {sel && !['magic-wand', 'quick-select', 'selection-brush'].includes(t) && num('feather', 'Feather', 0, 100)}
      {brushy && num('size', 'Size', 1, 500)}
      {brushy && !['pencil', 'red-eye'].includes(t) && num('hardness', 'Hardness', 0, 1, 0.01)}
      {['brush', 'pencil', 'eraser', 'clone-stamp', 'heal', 'pattern-stamp', 'history-brush', 'art-history', 'adjust-brush', 'color-replace', 'gradient', 'bucket', 'magic-eraser', 'selection-brush'].includes(t) && num('opacity', 'Opacity', 0.01, 1, 0.01)}
      {['brush', 'eraser', 'clone-stamp', 'heal', 'pattern-stamp', 'history-brush', 'mixer-brush'].includes(t) && num('flow', 'Flow', 0.01, 1, 0.01)}
      {['magic-wand', 'bucket', 'magic-eraser', 'bg-eraser', 'color-replace', 'quick-select'].includes(t) && num('tolerance', 'Tolerance', 0, 255)}
      {['magic-wand', 'bucket', 'magic-eraser'].includes(t) && <label><input type="checkbox" checked={o.contiguous} onChange={(e) => set('contiguous', e.target.checked)} /> Contiguous</label>}
      {['magic-wand', 'bucket', 'magic-eraser', 'clone-stamp', 'heal', 'object-select', 'quick-select'].includes(t) && <label><input type="checkbox" checked={o.sampleAll} onChange={(e) => set('sampleAll', e.target.checked)} /> Sample all layers</label>}
      {['clone-stamp', 'heal'].includes(t) && <label><input type="checkbox" checked={o.aligned} onChange={(e) => set('aligned', e.target.checked)} /> Aligned</label>}
      {['blur', 'sharpen', 'smudge', 'sponge'].includes(t) && num('strength', 'Strength', 0.01, 1, 0.01)}
      {['dodge', 'burn'].includes(t) && <><Select label="Range" value={o.range} options={['shadows', 'midtones', 'highlights'] as const} onChange={(v) => set('range', v)} />{num('exposure', 'Exposure', 0.01, 1, 0.01)}</>}
      {t === 'sponge' && <Select label="Mode" value={o.spongeMode} options={['desaturate', 'saturate'] as const} onChange={(v) => set('spongeMode', v)} />}
      {t === 'pattern-stamp' && <Select label="Pattern" value={o.pattern} options={['checker', 'dots', 'stripes', 'bricks', 'grid', 'noise'] as const} onChange={(v) => set('pattern', v)} />}
      {t === 'mixer-brush' && num('wet', 'Wet', 0, 1, 0.01)}
      {t === 'adjust-brush' && <>{num('adjBrightness', 'Bright', -1, 1, 0.01)}{num('adjSaturation', 'Sat', -1, 1, 0.01)}{num('adjWarmth', 'Warm', -1, 1, 0.01)}</>}
      {t === 'gradient' && <><Select value={o.gradientType} options={['linear', 'radial', 'angle', 'reflected', 'diamond'] as const} onChange={(v) => set('gradientType', v)} /><label><input type="checkbox" checked={o.gradientTransparent} onChange={(e) => set('gradientTransparent', e.target.checked)} /> FG → transparent</label></>}
      {t.startsWith('shape-') && <>
        {t !== 'shape-line' && <label><input type="checkbox" checked={o.shapeFill} onChange={(e) => set('shapeFill', e.target.checked)} /> Fill (FG)</label>}
        {t !== 'shape-line' && <label><input type="checkbox" checked={o.shapeStroke} onChange={(e) => set('shapeStroke', e.target.checked)} /> Stroke (BG)</label>}
        {num('strokeWidth', t === 'shape-line' ? 'Weight' : 'Stroke', 1, 100)}
        {t === 'shape-polygon' && num('sides', 'Sides', 3, 24)}
        {t === 'shape-custom' && <Select label="Shape" value={o.customShape} options={['star', 'heart', 'arrow', 'bubble', 'check', 'bolt', 'chicken'] as const} onChange={(v) => set('customShape', v)} />}
      </>}
      {t.startsWith('type-') && <>
        <Select value={o.fontFamily} options={[{ value: 'Inter, system-ui, sans-serif', label: 'Sans' }, { value: 'Georgia, serif', label: 'Serif' }, { value: 'Impact, sans-serif', label: 'Impact' }, { value: 'ui-monospace, monospace', label: 'Mono' }, { value: '"Comic Sans MS", cursive', label: 'Handwritten' }, { value: '"Brush Script MT", cursive', label: 'Script' }]} onChange={(v) => set('fontFamily', v)} />
        {num('fontSize', 'Size', 6, 400)}
        <label><input type="checkbox" checked={o.bold} onChange={(e) => set('bold', e.target.checked)} /> B</label>
        <label><input type="checkbox" checked={o.italic} onChange={(e) => set('italic', e.target.checked)} /> I</label>
      </>}
      {['eyedropper', 'color-sampler'].includes(t) && <Select label="Sample" value={String(o.sampleSize) as '1' | '3' | '5'} options={[{ value: '1', label: 'Point' }, { value: '3', label: '3×3 avg' }, { value: '5', label: '5×5 avg' }]} onChange={(v) => set('sampleSize', +v as 1 | 3 | 5)} />}
      {t === 'color-sampler' && <button onClick={() => { doc.samplers = []; bump() }}>Clear</button>}
      {t === 'count' && <><span className="muted">Count: {doc.counts.length}</span><button onClick={() => { doc.counts = []; bump() }}>Clear</button></>}
      {t === 'note' && <button onClick={() => { doc.notes = []; bump() }}>Clear all notes</button>}
      {t === 'ruler' && doc.ruler && <>
        <span className="muted">L: {Math.hypot(doc.ruler.x2 - doc.ruler.x1, doc.ruler.y2 - doc.ruler.y1).toFixed(1)}px · A: {(-Math.atan2(doc.ruler.y2 - doc.ruler.y1, doc.ruler.x2 - doc.ruler.x1) * 180 / Math.PI).toFixed(1)}° · W: {(doc.ruler.x2 - doc.ruler.x1).toFixed(0)} H: {(doc.ruler.y2 - doc.ruler.y1).toFixed(0)}</span>
        <button onClick={straightenFromRuler}>Straighten layer</button><button onClick={() => { doc.ruler = null; bump() }}>Clear</button>
      </>}
      {t === 'frame' && <><Select label="Shape" value={o.frameShape} options={['rect', 'ellipse'] as const} onChange={(v) => set('frameShape', v)} />{doc.layer?.frame && <button onClick={() => void openImage(true)}>Place image in frame…</button>}</>}
      {(t === 'crop' || t === 'artboard') && ts.crop && <><button className="primary" onClick={() => { applyPending(); fitView() }}>✓ Apply</button><button onClick={() => { ts.crop = null; bump() }}>✕</button></>}
      {t === 'crop-perspective' && <>{ts.quad.length === 4 && <button className="primary" onClick={() => { applyPending(); fitView() }}>✓ Apply</button>}<button onClick={() => { ts.quad = []; bump() }}>Reset</button></>}
      {t === 'slice-select' && doc.activeSlice >= 0 && <button onClick={() => { doc.slices.splice(doc.activeSlice, 1); doc.activeSlice = -1; bump(true) }}>Delete slice</button>}
      {(t === 'slice' || t === 'slice-select') && <button onClick={() => { doc.slices = []; bump(true) }}>Clear slices</button>}
      {(t === 'heal' || t === 'clone-stamp') && <span className="muted">{ts.cloneSrc ? 'Source set ✓' : 'Alt+click to set source'}</span>}
      {(t === 'patch' || t === 'content-move') && <span className="muted">{doc.selection ? 'Drag the selection to ' + (t === 'patch' ? 'pick the source' : 'move it') : 'Draw around the area first'}</span>}
      <span style={{ flex: 1 }} />
      <span className="hint" style={{ maxWidth: 420 }}>{def.hint}</span>
    </div>
  )
}

/* ------------------------- Right panels ------------------------- */
function LayerThumb({ c }: { c: HTMLCanvasElement }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const v = useVersion()
  useEffect(() => {
    const t = ref.current
    if (!t) return
    t.width = 72; t.height = 56
    const x = t.getContext('2d')!
    const s = Math.min(72 / c.width, 56 / c.height)
    x.clearRect(0, 0, 72, 56)
    x.drawImage(c, (72 - c.width * s) / 2, (56 - c.height * s) / 2, c.width * s, c.height * s)
  }, [c, v])
  return <canvas ref={ref} />
}

function RightPanels() {
  useVersion()
  const fg = usePhoto((s) => s.fg)
  const [info, setInfo] = useState<string>('')
  useEffect(() => {
    const i = setInterval(() => {
      const p = ts.cursor
      if (!p) return
      const c = sampleColorAt(p)
      setInfo(`X ${Math.round(p.x)}  Y ${Math.round(p.y)}${c ? `  ·  ${rgbToHex(c[0], c[1], c[2])}  R${c[0]} G${c[1]} B${c[2]} A${c[3]}` : ''}`)
    }, 150)
    return () => clearInterval(i)
  }, [])
  const SW = ['#000000', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#8e8e93', '#a2845e', '#8b5cf6']
  const selB = doc.selection ? maskBounds(doc.selection, doc.width, doc.height) : null
  const l = doc.layer
  return (
    <div className="photo-right">
      <div className="panel-title">Color</div>
      <div className="section-body">
        <div className="row"><input type="color" value={fg} onChange={(e) => usePhoto.setState({ fg: e.target.value })} /><input value={fg} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && usePhoto.setState({ fg: e.target.value })} style={{ width: 80 }} /></div>
        <div className="row" style={{ gap: 3 }}>{SW.map((c) => <div key={c} onClick={() => usePhoto.setState({ fg: c })} style={{ width: 16, height: 16, background: c, border: '1px solid #555', cursor: 'pointer' }} />)}</div>
      </div>
      <div className="panel-title">Info</div>
      <div className="section-body small">
        <div className="timecode">{info || 'Move over the canvas'}</div>
        <div className="muted">Doc {doc.width}×{doc.height}{selB ? ` · Selection ${selB.w}×${selB.h} @ ${selB.x},${selB.y}` : ''}</div>
        {doc.samplers.map((s, i) => { const c = sampleColorAt(s); return <div key={i} className="timecode">#{i + 1} {c ? `${rgbToHex(c[0], c[1], c[2])} R${c[0]} G${c[1]} B${c[2]}` : ''}</div> })}
      </div>
      <div className="panel-title">Layers <span className="spacer" />
        <button className="icon" title="New layer" onClick={() => { doc.addLayer(); doc.commit('New Layer') }}>＋</button>
        <button className="icon" title="Duplicate (Ctrl+J)" onClick={layerViaCopy}>⧉</button>
        <button className="icon" title="Merge down (Ctrl+E)" onClick={mergeDown}>⤓</button>
        <button className="icon" title="Delete" onClick={deleteLayer}>🗑</button>
      </div>
      <div className="section-body" style={{ paddingBottom: 4 }}>
        <div className="row">
          <select value={l.blend} onChange={(e) => { l.blend = e.target.value as GlobalCompositeOperation; doc.commit('Blend Mode', []) }} style={{ flex: 1 }}>
            {BLENDS.map((b) => <option key={b} value={b}>{BLEND_LABELS[b] ?? b}</option>)}
          </select>
          <input type="number" min={0} max={100} value={Math.round(l.opacity * 100)} style={{ width: 54 }} onChange={(e) => { l.opacity = Math.min(1, Math.max(0, +e.target.value / 100)); bump() }} onBlur={() => doc.commit('Opacity', [])} />%
        </div>
      </div>
      <div style={{ maxHeight: 260, overflow: 'auto' }}>
        {[...doc.layers].reverse().map((ly) => {
          const i = doc.layers.indexOf(ly)
          return (
            <div key={ly.id} className={'layer-row ' + (i === doc.active ? 'on' : '')} onClick={() => { doc.active = i; bump() }}>
              <button className="icon" onClick={(e) => { e.stopPropagation(); ly.visible = !ly.visible; doc.commit(ly.visible ? 'Show layer' : 'Hide layer', []) }}>{ly.visible ? '👁' : '🙈'}</button>
              <LayerThumb c={ly.canvas} />
              <span className="lname" onDoubleClick={() => { const n = prompt('Layer name', ly.name); if (n) { ly.name = n; doc.commit('Rename', []) } }}>{ly.frame ? '🖼 ' : ''}{ly.name}</span>
              <button className="icon" title="Lock" onClick={(e) => { e.stopPropagation(); ly.locked = !ly.locked; bump() }}>{ly.locked ? '🔒' : ''}</button>
              <button className="icon" title="Move up" disabled={i === doc.layers.length - 1} onClick={(e) => { e.stopPropagation(); doc.layers.splice(i, 1); doc.layers.splice(i + 1, 0, ly); doc.active = i + 1; doc.commit('Reorder', []) }}>▲</button>
              <button className="icon" title="Move down" disabled={i === 0} onClick={(e) => { e.stopPropagation(); doc.layers.splice(i, 1); doc.layers.splice(i - 1, 0, ly); doc.active = i - 1; doc.commit('Reorder', []) }}>▼</button>
            </div>
          )
        })}
      </div>
      {doc.paths.length > 0 && <>
        <div className="panel-title">Paths</div>
        {doc.paths.map((p) => (
          <div key={p.id} className={'layer-row ' + (p.id === doc.activePath ? 'on' : '')} onClick={() => { doc.activePath = p.id; bump() }}>
            <span className="lname">✒ {p.name} {p.closed ? '' : '(open)'}</span>
            <button className="icon" title="Fill path with FG" onClick={(e) => { e.stopPropagation(); const x = ctx2d(doc.layer.canvas); x.fillStyle = fg; x.fill(pathToPath2D(p)); doc.commit('Fill Path', [doc.layer.id]) }}>◼</button>
            <button className="icon" title="Stroke path with brush size" onClick={(e) => { e.stopPropagation(); const x = ctx2d(doc.layer.canvas); x.strokeStyle = fg; x.lineWidth = Math.max(1, ts.opts.size / 4); x.lineCap = 'round'; x.lineJoin = 'round'; x.stroke(pathToPath2D(p)); doc.commit('Stroke Path', [doc.layer.id]) }}>◻</button>
            <button className="icon" title="Make selection" onClick={(e) => { e.stopPropagation(); doc.setSelection(pathMask(p)); doc.commit('Path to Selection', []) }}>⬚</button>
            <button className="icon" title="Delete path" onClick={(e) => { e.stopPropagation(); doc.paths = doc.paths.filter((x) => x !== p); bump(true) }}>✕</button>
          </div>
        ))}
      </>}
      <div className="panel-title">History</div>
      <div style={{ maxHeight: 240, overflow: 'auto', paddingBottom: 10 }}>
        {doc.history.map((h, i) => (
          <div key={i} className={'history-row ' + (i === doc.historyIndex ? 'on' : i > doc.historyIndex ? 'future' : '')} onClick={() => doc.restore(i)}>
            <span title="Set as History Brush source" onClick={(e) => { e.stopPropagation(); doc.historySource = i; bump() }} style={{ cursor: 'pointer' }}>{doc.historySource === i ? '◉' : '○'}</span>
            {h.label}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------- Canvas viewport ------------------------- */
function Viewport() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const version = useVersion()
  const view = usePhoto((s) => s.view)
  const qm = usePhoto((s) => s.quickMask)
  const [phase, setPhase] = useState(0)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [typing, setTyping] = useState('')
  const checker = useRef<CanvasPattern | null>(null)
  const typingSince = useRef(0)

  useEffect(() => {
    const el = wrapRef.current!
    const ro = new ResizeObserver(() => { setSize({ w: el.clientWidth, h: el.clientHeight }); wrapSize = { w: el.clientWidth, h: el.clientHeight } })
    ro.observe(el)
    wrapSize = { w: el.clientWidth, h: el.clientHeight }
    return () => ro.disconnect()
  }, [])
  useEffect(() => { const i = setInterval(() => setPhase((p) => p + 1), 350); return () => clearInterval(i) }, [])

  const toDoc = useCallback((cx: number, cy: number) => {
    const r = wrapRef.current!.getBoundingClientRect()
    let x = cx - r.left - size.w / 2 - view.panX, y = cy - r.top - size.h / 2 - view.panY
    const a = (-view.rot * Math.PI) / 180
    ;[x, y] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
    return { x: x / view.zoom + doc.width / 2, y: y / view.zoom + doc.height / 2 }
  }, [size, view])
  const toScreen = (p: { x: number; y: number }) => {
    let x = (p.x - doc.width / 2) * view.zoom, y = (p.y - doc.height / 2) * view.zoom
    const a = (view.rot * Math.PI) / 180
    ;[x, y] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
    return { x: x + size.w / 2 + view.panX, y: y + size.h / 2 + view.panY }
  }

  // render
  useEffect(() => {
    const cv = canvasRef.current!
    const dpr = devicePixelRatio
    if (cv.width !== size.w * dpr) { cv.width = size.w * dpr; cv.style.width = size.w + 'px' }
    if (cv.height !== size.h * dpr) { cv.height = size.h * dpr; cv.style.height = size.h + 'px' }
    const x = cv.getContext('2d')!
    x.setTransform(dpr, 0, 0, dpr, 0, 0)
    x.clearRect(0, 0, size.w, size.h)
    x.save()
    x.translate(size.w / 2 + view.panX, size.h / 2 + view.panY)
    x.rotate((view.rot * Math.PI) / 180)
    x.scale(view.zoom, view.zoom)
    x.translate(-doc.width / 2, -doc.height / 2)
    x.shadowColor = '#0008'; x.shadowBlur = 20
    if (!checker.current) {
      const p = makeCanvas(16, 16), px = ctx2d(p)
      px.fillStyle = '#fff'; px.fillRect(0, 0, 16, 16); px.fillStyle = '#ccc'; px.fillRect(0, 0, 8, 8); px.fillRect(8, 8, 8, 8)
      checker.current = x.createPattern(p, 'repeat')
    }
    x.fillStyle = checker.current!
    x.save(); x.scale(1 / view.zoom, 1 / view.zoom); x.fillRect(0, 0, doc.width * view.zoom, doc.height * view.zoom); x.restore()
    x.shadowBlur = 0
    x.imageSmoothingEnabled = view.zoom < 2
    for (const l of doc.layers) {
      if (!l.visible) continue
      x.globalAlpha = l.opacity
      x.globalCompositeOperation = l.blend
      x.drawImage(l.canvas, 0, 0)
    }
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'
    if (qm) { x.globalAlpha = 0.5; x.drawImage(doc.quickMaskCanvas(), 0, 0); x.globalAlpha = 1 }
    else if (doc.selection && !ts.floating) { const a = doc.antsCanvas(phase); if (a) { x.imageSmoothingEnabled = false; x.drawImage(a, 0, 0) } }
    else if (ts.floating?.selection) { /* hide ants while moving */ }
    drawOverlay(x, view.zoom, phase)
    x.restore()
  }, [version, view, size, phase, qm])

  const onPointerDown = (e: React.PointerEvent) => {
    if (ts.typing) return
    wrapRef.current!.setPointerCapture(e.pointerId)
    const p = toDoc(e.clientX, e.clientY)
    const tool = ts.tool
    if (ts.spaceHeld || tool === 'hand' || e.button === 1) {
      ts.dragView = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY, rot: view.rot, ang: 0 }; return
    }
    if (tool === 'rotate-view') {
      const r = wrapRef.current!.getBoundingClientRect()
      ts.dragView = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY, rot: view.rot, ang: Math.atan2(e.clientY - r.top - size.h / 2, e.clientX - r.left - size.w / 2) }
      return
    }
    if (tool === 'zoom') {
      const f = e.altKey ? 0.8 : 1.25
      const z = Math.min(64, Math.max(0.02, view.zoom * f))
      // keep point under cursor
      const before = toScreen(p)
      usePhoto.setState({ view: { ...view, zoom: z } })
      const nv = { ...view, zoom: z }
      const sx = (p.x - doc.width / 2) * nv.zoom + size.w / 2 + nv.panX, sy = (p.y - doc.height / 2) * nv.zoom + size.h / 2 + nv.panY
      usePhoto.setState({ view: { ...nv, panX: nv.panX + before.x - sx, panY: nv.panY + before.y - sy } })
      return
    }
    if (tool.startsWith('type-')) { e.preventDefault(); typingSince.current = performance.now() }
    if (e.altKey && BRUSH_TOOLS.includes(tool) && !['clone-stamp', 'heal', 'selection-brush', 'quick-select'].includes(tool)) { eyedrop(p, false); return }
    void onDown(p, e.nativeEvent, view.zoom)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = ts.dragView
    if (d) {
      if (ts.tool === 'rotate-view' && !ts.spaceHeld) {
        const r = wrapRef.current!.getBoundingClientRect()
        const ang = Math.atan2(e.clientY - r.top - size.h / 2, e.clientX - r.left - size.w / 2)
        let rot = d.rot + ((ang - d.ang) * 180) / Math.PI
        if (e.shiftKey) rot = Math.round(rot / 15) * 15
        usePhoto.setState({ view: { ...view, rot } })
      } else usePhoto.setState({ view: { ...view, panX: d.panX + e.clientX - d.x, panY: d.panY + e.clientY - d.y } })
      return
    }
    // coalesced events for smooth strokes
    const evs = (e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) as PointerEvent[]
    for (const ev of evs.length ? evs : [e.nativeEvent]) onMove(toDoc(ev.clientX, ev.clientY), ev, view.zoom)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (ts.dragView) { ts.dragView = null; return }
    void onUp(toDoc(e.clientX, e.clientY), e.nativeEvent)
  }
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const p = toDoc(e.clientX, e.clientY)
      const before = toScreen(p)
      const z = Math.min(64, Math.max(0.02, view.zoom * (e.deltaY < 0 ? 1.12 : 0.89)))
      const sx = (p.x - doc.width / 2) * z + size.w / 2 + view.panX, sy = (p.y - doc.height / 2) * z + size.h / 2 + view.panY
      usePhoto.setState({ view: { ...view, zoom: z, panX: view.panX + before.x - sx, panY: view.panY + before.y - sy } })
    } else usePhoto.setState({ view: { ...view, panX: view.panX - e.deltaX, panY: view.panY - e.deltaY } })
  }

  const cursor = ts.spaceHeld || ts.tool === 'hand' ? 'grab' : ts.tool === 'zoom' ? 'zoom-in' : ts.tool === 'move' ? 'move' : ts.tool.startsWith('type') ? 'text' : BRUSH_TOOLS.includes(ts.tool) ? 'none' : 'crosshair'
  const tp = ts.typing ? toScreen(ts.typing) : null
  useEffect(() => { if (ts.typing) setTyping('') }, [ts.typing])
  const o = ts.opts
  return (
    <div className="photo-canvas-wrap" ref={wrapRef} style={{ cursor }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => { ts.cursor = null; bump() }}
      onWheel={onWheel} onDoubleClick={() => { if (ts.tool === 'rotate-view') usePhoto.setState({ view: { ...view, rot: 0 } }) }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) void loadImageFile(f, true) }}>
      <canvas ref={canvasRef} />
      {ts.typing && tp && (
        <textarea className="text-entry" autoFocus value={typing}
          style={{ left: tp.x, top: tp.y, fontSize: o.fontSize * view.zoom, fontFamily: o.fontFamily, fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? 'italic' : 'normal', color: ts.typing.mask ? '#ff3b30' : usePhoto.getState().fg, writingMode: ts.typing.vertical ? 'vertical-rl' : undefined, minWidth: 40, minHeight: o.fontSize * view.zoom * 1.3, width: Math.max(60, typing.split('\n').reduce((m, l) => Math.max(m, l.length), 1) * o.fontSize * view.zoom * 0.62 + 20) }}
          rows={Math.max(1, typing.split('\n').length)}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setTyping(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { ts.typing = null; bump() } if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitText(typing) }}
          onBlur={(e) => { if (performance.now() - typingSince.current < 400) { const t = e.currentTarget; setTimeout(() => t.focus()); return } commitText(typing) }} />
      )}
    </div>
  )
}

/* ------------------------- Main ------------------------- */
let loadedOnce = false
export function PhotoEditor() {
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const screen = usePhoto((s) => s.screenMode)
  const qm = usePhoto((s) => s.quickMask)
  const view = usePhoto((s) => s.view)
  useVersion()

  useEffect(() => {
    if (loadedOnce) return
    loadedOnce = true
    void loadPhotoDoc(doc).catch(() => false).then((ok) => { setTimeout(fitView, 50); if (!ok) bump() })
  }, [])

  // keyboard shortcuts (Photoshop-style)
  useEffect(() => {
    const groupIndexByKey = (k: string) => TOOL_GROUPS.findIndex((g) => g.key === k)
    const onKey = (e: KeyboardEvent) => {
      if (useStore.getState().tab !== 'photo') return
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (dialog) return
      const k = e.key.toUpperCase()
      const ctrl = e.ctrlKey || e.metaKey
      if (e.key === ' ') { if (!ts.spaceHeld) { ts.spaceHeld = true; bump() } e.preventDefault(); return }
      if (ctrl) {
        const map: Record<string, () => void> = {
          Z: () => (e.shiftKey || e.altKey ? doc.redo() : doc.undo()), Y: () => doc.redo(), A: selectAll, D: deselect, J: layerViaCopy, E: mergeDown,
          C: () => copySel(), X: () => copySel(true), V: pasteInternal, T: () => setDialog({ kind: 'transform' }), N: () => (e.shiftKey ? (doc.addLayer(), doc.commit('New Layer')) : setDialog({ kind: 'new' })),
          O: () => void openImage(false), '0': fitView, '1': () => usePhoto.setState((s) => ({ view: { ...s.view, zoom: 1 } })), '=': () => zoomBy(1.25), '+': () => zoomBy(1.25), '-': () => zoomBy(0.8),
          BACKSPACE: () => fillSel(usePhoto.getState().bg), DELETE: () => fillSel(usePhoto.getState().bg),
        }
        if (e.shiftKey && k === 'I') { e.preventDefault(); inverse(); return }
        if (e.altKey && k === 'I') { e.preventDefault(); setDialog({ kind: 'imagesize' }); return }
        if (e.altKey && k === 'C') { e.preventDefault(); setDialog({ kind: 'canvassize' }); return }
        const f = map[k]
        if (f) { e.preventDefault(); f() }
        return
      }
      if (e.key === 'Enter') { if (applyPending()) fitView(); return }
      if (e.key === 'Escape') { if (ts.tool === 'rotate-view') usePhoto.setState((s) => ({ view: { ...s.view, rot: 0 } })); cancelTransient(); ts.crop = null; doc.activePath = null; bump(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (ts.tool === 'slice-select' && doc.activeSlice >= 0) { doc.slices.splice(doc.activeSlice, 1); doc.activeSlice = -1; bump(true); return }
        if (e.altKey) fillSel(usePhoto.getState().fg); else clearSel()
        return
      }
      if (e.key === '[') { ts.opts.size = Math.max(1, Math.round(ts.opts.size * 0.85)); bump(); return }
      if (e.key === ']') { ts.opts.size = Math.min(1000, Math.round(ts.opts.size * 1.18) + 1); bump(); return }
      if (e.key.startsWith('Arrow') && ts.tool === 'move') {
        const d = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
        const l = doc.layer, c = makeCanvas(doc.width, doc.height)
        ctx2d(c).drawImage(l.canvas, dx, dy); l.canvas = c
        doc.commit('Nudge', [l.id]); e.preventDefault(); return
      }
      if (k === 'D') { usePhoto.setState({ fg: '#000000', bg: '#ffffff' }); return }
      if (k === 'X') { usePhoto.setState((s) => ({ fg: s.bg, bg: s.fg })); return }
      if (k === 'Q') { usePhoto.setState((s) => ({ quickMask: !s.quickMask })); return }
      if (k === 'F') { usePhoto.setState((s) => ({ screenMode: ((s.screenMode + 1) % 3) as 0 | 1 | 2 })); return }
      if (/^[0-9]$/.test(e.key) && (BRUSH_TOOLS.includes(ts.tool) || ts.tool === 'gradient' || ts.tool === 'bucket')) { ts.opts.opacity = e.key === '0' ? 1 : +e.key / 10; bump(); return }
      const gi = groupIndexByKey(k)
      if (gi >= 0) {
        const g = TOOL_GROUPS[gi]
        const curIdx = g.tools.findIndex((t) => t.id === ts.tool)
        if (e.shiftKey && curIdx >= 0) setTool(g.tools[(curIdx + 1) % g.tools.length].id)
        else if (curIdx < 0) setTool((g.tools.find((t) => t.id === lastInGroup[g.key + gi]) ?? g.tools[0]).id)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === ' ') { ts.spaceHeld = false; bump() } }
    const onPaste = async (e: ClipboardEvent) => {
      if (useStore.getState().tab !== 'photo') return
      if ((e.target as HTMLElement).closest?.('input, textarea')) return
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'))
      const f = item?.getAsFile()
      if (f) { e.preventDefault(); await loadImageFile(f, true) }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('paste', onPaste)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('paste', onPaste) }
  }, [dialog])

  const g = groupOf(ts.tool)
  return (
    <div className={'photo ' + (screen > 0 ? 'fullscreen' : '')}>
      <Toolbar />
      <div className="photo-center">
        {screen < 2 && <div className="options-bar" style={{ borderBottom: '1px solid var(--line)', minHeight: 32, padding: '2px 6px' }}>
          <MenuBar onDialog={setDialog} />
          <span style={{ flex: 1 }} />
          <button onClick={() => void sendToVideo()}>🎬 Send to video</button>
        </div>}
        <OptionsBar />
        <Viewport />
        <div className="photo-status">
          <span>{doc.name} · {doc.width}×{doc.height}px</span>
          <span>Zoom {(view.zoom * 100).toFixed(0)}%{view.rot ? ` · View rotated ${view.rot.toFixed(0)}°` : ''}</span>
          <span>Layer: {doc.layer?.name}</span>
          {qm && <span style={{ color: '#ff3b30' }}>QUICK MASK. White adds to the selection, black removes, Eraser clears. Press Q to exit.</span>}
          <span style={{ marginLeft: 'auto' }}>{g.section} · {g.key ? `${g.key} / Shift+${g.key} cycles` : 'no shortcut'} · Space = hand · [ ] size</span>
        </div>
      </div>
      {screen === 0 && <RightPanels />}
      {dialog && <Dialogs d={dialog} onClose={() => setDialog(null)} />}
    </div>
  )
}
