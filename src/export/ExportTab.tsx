import { useRef, useState } from 'react'
import JSZip from 'jszip'
import { useStore, projectDuration } from '../core/store'
import { downloadBlob, pickFiles, getVideo, seekVideo } from '../core/media'
import { doc, photoBundle, restorePhotoBundle } from '../photo/doc'
import { mixdown, encodeWav, encodeMp3 } from '../audio/engine'
import { renderFrame, videoClipTime } from '../video/render'
import { ensureVideos } from '../video/player'
import {
  exportVideo, exportGif, exportApng, exportSpriteSheet, animationSource, timelineSource, animationProject,
  canvasToBlob, scaledCanvas, exportProjectFile, importProjectFile, Cancelled, type Progress,
} from './exporters'
import { Select, Slider, Check, fmtTime } from '../ui/controls'

const safe = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'export'

const RES = [{ h: 360, l: '360p' }, { h: 480, l: '480p' }, { h: 720, l: '720p HD' }, { h: 1080, l: '1080p Full HD' }, { h: 1440, l: '1440p 2K' }, { h: 2160, l: '2160p 4K' }]
const PRESETS: { name: string; fmt: 'mp4' | 'webm' | 'mov'; h: number; fps: number; mbps: number }[] = [
  { name: 'YouTube 1080p', fmt: 'mp4', h: 1080, fps: 30, mbps: 12 },
  { name: 'TikTok / Reels / Shorts', fmt: 'mp4', h: 1920, fps: 30, mbps: 10 },
  { name: 'Instagram feed', fmt: 'mp4', h: 1080, fps: 30, mbps: 8 },
  { name: 'Small file (720p)', fmt: 'mp4', h: 720, fps: 30, mbps: 4 },
  { name: '4K master', fmt: 'mp4', h: 2160, fps: 30, mbps: 40 },
  { name: 'Web (WebM)', fmt: 'webm', h: 1080, fps: 30, mbps: 8 },
]

function useJob() {
  const [state, setState] = useState<{ p: number; label: string; running: boolean; error?: string }>({ p: 0, label: '', running: false })
  const ctrl = useRef<AbortController | null>(null)
  const run = async (label: string, fn: (onProgress: Progress, signal: AbortSignal) => Promise<void>) => {
    ctrl.current = new AbortController()
    setState({ p: 0, label, running: true })
    try {
      await fn((p, l) => setState({ p, label: l ?? label, running: true }), ctrl.current.signal)
      setState({ p: 1, label: 'Done ✓ (check your Downloads folder)', running: false })
    } catch (e) {
      setState({ p: 0, label: '', running: false, error: e instanceof Cancelled ? 'Cancelled' : (e as Error).message })
    }
  }
  const view = (state.running || state.label || state.error) ? (
    <div className="section-body" style={{ padding: 0 }}>
      <div className="progress"><div style={{ width: `${state.p * 100}%` }} /></div>
      <div className="row"><span className="small">{state.error ? <span style={{ color: 'var(--danger)' }}>{state.error}</span> : state.label}</span>
        {state.running && <button onClick={() => ctrl.current?.abort()}>Cancel</button>}</div>
    </div>
  ) : null
  return { run, view, running: state.running }
}

function VideoCard() {
  const project = useStore((s) => s.project)
  const dur = projectDuration(project)
  const [fmt, setFmt] = useState<'mp4' | 'webm' | 'mov'>('mp4')
  const [h, setH] = useState(Math.min(1080, project.height))
  const [fps, setFps] = useState(project.fps)
  const [mbps, setMbps] = useState(12)
  const [audio, setAudio] = useState(true)
  const [range, setRange] = useState<'all' | 'custom'>('all')
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState(dur)
  const job = useJob()
  const portrait = project.height > project.width
  const outH = h, outW = Math.round((h * project.width) / project.height / 2) * 2
  const size = ((mbps * 1e6 + (audio ? 192000 : 0)) * (range === 'all' ? dur : to - from)) / 8 / 1e6
  return (
    <div className="card">
      <h3>🎬 Video</h3>
      <div className="row">{PRESETS.map((p) => <span key={p.name} className="chip" onClick={() => { setFmt(p.fmt); setH(portrait && p.name.startsWith('TikTok') ? 1920 : Math.min(p.h, portrait ? 1920 : p.h)); setFps(p.fps); setMbps(p.mbps) }}>{p.name}</span>)}</div>
      <Select label="Format" value={fmt} options={[{ value: 'mp4', label: 'MP4 (H.264): plays everywhere' }, { value: 'webm', label: 'WebM (VP9): web' }, { value: 'mov', label: 'MOV (QuickTime, H.264)' }]} onChange={setFmt} />
      <Select label="Resolution" value={String(h)} options={[...RES, ...(portrait ? [{ h: 1920, l: '1920 tall (vertical 1080p)' }] : [])].map((r) => ({ value: String(r.h), label: r.l }))} onChange={(v) => setH(+v)} />
      <Select label="Frame rate" value={String(fps)} options={['24', '25', '30', '50', '60']} onChange={(v) => setFps(+v)} />
      <Slider label="Bitrate Mbps" min={1} max={60} step={0.5} value={mbps} onChange={setMbps} />
      <Check label="Include audio" value={audio} onChange={setAudio} />
      <Select label="Range" value={range} options={[{ value: 'all', label: `Whole timeline (${fmtTime(dur)})` }, { value: 'custom', label: 'Custom range' }]} onChange={(v) => { setRange(v); setTo(dur) }} />
      {range === 'custom' && <><Slider label="From (s)" min={0} max={dur} value={from} onChange={setFrom} /><Slider label="To (s)" min={0} max={dur} value={to} onChange={setTo} /></>}
      <div className="hint">Output {outW}×{outH} · about {size.toFixed(1)} MB</div>
      <button className="primary" disabled={job.running || dur <= 0} onClick={() => job.run('Exporting video…', async (pr, sig) => {
        await ensureVideos(project)
        const blob = await exportVideo(project, { format: fmt, height: h, fps, bitrate: mbps * 1e6, from: range === 'all' ? 0 : from, to: range === 'all' ? dur : to, audio }, pr, sig)
        downloadBlob(blob, `${safe(project.name)}.${fmt}`)
      })}>⬇ Export video</button>
      {dur <= 0 && <div className="hint">Add clips in the Video tab first.</div>}
      {job.view}
    </div>
  )
}

function ImageCard() {
  const project = useStore((s) => s.project)
  const playhead = useStore((s) => s.playhead)
  const [fmt, setFmt] = useState<'png' | 'jpeg' | 'webp'>('png')
  const [q, setQ] = useState(0.92)
  const [scale, setScale] = useState(1)
  const job = useJob()
  const mime = `image/${fmt}`
  const ext = fmt === 'jpeg' ? 'jpg' : fmt
  return (
    <div className="card">
      <h3>🖼 Images</h3>
      <Select label="Format" value={fmt} options={[{ value: 'png', label: 'PNG (lossless, transparency)' }, { value: 'jpeg', label: 'JPG (small, no transparency)' }, { value: 'webp', label: 'WebP (small, transparency)' }]} onChange={setFmt} />
      {fmt !== 'png' && <Slider label="Quality" min={0.1} max={1} value={q} onChange={setQ} />}
      <Slider label="Scale" min={0.1} max={4} value={scale} onChange={setScale} />
      <div className="hint">Photo document: {Math.round(doc.width * scale)}×{Math.round(doc.height * scale)} · {doc.slices.length} slice(s)</div>
      <div className="row">
        <button className="primary" disabled={job.running} onClick={() => job.run('Exporting image…', async () => {
          const c = scaledCanvas(doc.composite(), scale, fmt === 'jpeg' ? '#ffffff' : undefined)
          downloadBlob(await canvasToBlob(c, mime, q), `${safe(doc.name)}.${ext}`)
        })}>⬇ Photo document</button>
        <button disabled={job.running || !doc.slices.length} onClick={() => job.run('Exporting slices…', async (pr) => {
          const zip = new JSZip()
          const full = doc.composite()
          for (const [i, s] of doc.slices.entries()) {
            const c = document.createElement('canvas'); c.width = s.w; c.height = s.h
            const x = c.getContext('2d')!
            if (fmt === 'jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, s.w, s.h) }
            x.drawImage(full, -s.x, -s.y)
            zip.file(`${safe(doc.name)}_${String(i + 1).padStart(2, '0')}.${ext}`, await canvasToBlob(scaledCanvas(c, scale), mime, q))
            pr(i / doc.slices.length)
          }
          downloadBlob(await zip.generateAsync({ type: 'blob' }), `${safe(doc.name)}-slices.zip`)
        })}>⬇ Slices (.zip)</button>
        <button disabled={job.running || projectDuration(project) <= 0} onClick={() => job.run('Exporting frame…', async () => {
          await ensureVideos(project)
          const c = document.createElement('canvas'); c.width = Math.round(project.width * scale); c.height = Math.round(project.height * scale)
          for (const cl of project.clips) if (cl.kind === 'video' && playhead >= cl.start && playhead < cl.start + cl.duration) { const v = await getVideo(cl.id, cl.mediaId!); if (v) await seekVideo(v, videoClipTime(cl, playhead)) }
          renderFrame(c.getContext('2d')!, project, playhead)
          downloadBlob(await canvasToBlob(c, mime, q), `frame-${playhead.toFixed(2)}s.${ext}`)
        })}>⬇ Video frame @ {fmtTime(playhead)}</button>
      </div>
      {job.view}
    </div>
  )
}

function AnimationCard() {
  const project = useStore((s) => s.project)
  const [src, setSrc] = useState<string>(project.animations[0]?.id ?? 'timeline')
  const [fmt, setFmt] = useState<'gif' | 'apng' | 'sprite' | 'webm' | 'mp4'>('gif')
  const [scale, setScale] = useState(0.5)
  const [fps, setFps] = useState(15)
  const [cols, setCols] = useState(8)
  const [loop, setLoop] = useState(true)
  const job = useJob()
  const anim = project.animations.find((a) => a.id === src)
  const dur = anim ? anim.duration : projectDuration(project)
  const w = Math.round((anim?.width ?? project.width) * scale), h = Math.round((anim?.height ?? project.height) * scale)
  return (
    <div className="card">
      <h3>🐔 Animation</h3>
      <Select label="Source" value={src} options={[...project.animations.map((a) => ({ value: a.id, label: `Animator: ${a.name}` })), { value: 'timeline', label: 'Video timeline' }]} onChange={setSrc} />
      <Select label="Format" value={fmt} options={[{ value: 'gif', label: 'GIF' }, { value: 'apng', label: 'APNG (animated PNG, full colour)' }, { value: 'sprite', label: 'Sprite sheet (PNG + JSON)' }, { value: 'webm', label: 'WebM video' }, { value: 'mp4', label: 'MP4 video' }]} onChange={setFmt} />
      <Slider label="Scale" min={0.1} max={1} value={scale} onChange={setScale} />
      {fmt !== 'webm' && fmt !== 'mp4' && <Slider label="FPS" min={1} max={60} step={1} value={fps} onChange={setFps} />}
      {fmt === 'gif' && <Check label="Loop forever" value={loop} onChange={setLoop} />}
      {fmt === 'sprite' && <Slider label="Columns" min={1} max={32} step={1} value={cols} onChange={setCols} />}
      <div className="hint">{w}×{h} · {Math.ceil(dur * fps)} frames · {anim && !anim.background ? 'transparent background' : 'opaque'}</div>
      <button className="primary" disabled={job.running || dur <= 0} onClick={() => job.run('Exporting animation…', async (pr, sig) => {
        const name = safe(anim?.name ?? project.name)
        if (fmt === 'webm' || fmt === 'mp4') {
          const p = anim ? animationProject(anim) : project
          const blob = await exportVideo(p, { format: fmt, height: Math.round((anim?.height ?? project.height) * scale / 2) * 2, fps: anim?.fps ?? project.fps, bitrate: 8e6, from: 0, to: dur, audio: true }, pr, sig)
          downloadBlob(blob, `${name}.${fmt}`); return
        }
        if (!anim) await ensureVideos(project)
        const source = anim ? animationSource(anim) : timelineSource(project, 0, dur, fps)
        if (fmt === 'gif') downloadBlob(await exportGif(source, { scale, fps, loop }, pr, sig), `${name}.gif`)
        else if (fmt === 'apng') downloadBlob(await exportApng(source, { scale, fps }, pr, sig), `${name}.png`)
        else downloadBlob(await exportSpriteSheet(source, { scale, fps, columns: cols }, pr, sig), `${name}-spritesheet.zip`)
      })}>⬇ Export animation</button>
      {!project.animations.length && <div className="hint">Create animations in the Animator tab, or export the video timeline as a GIF.</div>}
      {job.view}
    </div>
  )
}

function AudioCard() {
  const project = useStore((s) => s.project)
  const dur = projectDuration(project)
  const [fmt, setFmt] = useState<'wav' | 'mp3'>('mp3')
  const [kbps, setKbps] = useState('192')
  const job = useJob()
  return (
    <div className="card">
      <h3>🎵 Audio</h3>
      <div className="hint">Exports the full mix of the timeline (music, voiceover, video sound).</div>
      <Select label="Format" value={fmt} options={[{ value: 'mp3', label: 'MP3' }, { value: 'wav', label: 'WAV (lossless)' }]} onChange={setFmt} />
      {fmt === 'mp3' && <Select label="Bitrate" value={kbps} options={['128', '192', '256', '320']} onChange={setKbps} />}
      <button className="primary" disabled={job.running || dur <= 0} onClick={() => job.run('Mixing…', async (pr) => {
        const buf = await mixdown(project, 0, dur, 44100)
        pr(0.3, 'Encoding…')
        const blob = fmt === 'wav' ? encodeWav(buf) : await encodeMp3(buf, +kbps, (p) => pr(0.3 + p * 0.7, 'Encoding MP3…'))
        downloadBlob(blob, `${safe(project.name)}.${fmt}`)
      })}>⬇ Export audio</button>
      {job.view}
    </div>
  )
}

function ProjectCard() {
  const project = useStore((s) => s.project)
  const job = useJob()
  return (
    <div className="card">
      <h3>💾 Project file</h3>
      <div className="hint">Your work autosaves in this browser. Use a <b>.chiken</b> project file to back up or move everything (timeline, media, animations, photo layers) to another computer.</div>
      <div className="row">
        <button className="primary" disabled={job.running} onClick={() => job.run('Packing project…', async () => {
          const photo = await photoBundle(doc)
          const blob = await exportProjectFile(project, photo.meta ? photo : null)
          downloadBlob(blob, `${safe(project.name)}.chiken`)
        })}>⬇ Save project file</button>
        <button disabled={job.running} onClick={async () => {
          const [f] = await pickFiles('.chiken,.chicken,.zip', false)
          if (!f) return
          await job.run('Opening project…', async () => {
            const { project: p, photo } = await importProjectFile(f)
            useStore.getState().replaceProject(p)
            if (photo) await restorePhotoBundle(doc, photo.meta, photo.layers)
            useStore.getState().notify(`Opened "${p.name}"`)
          })
        }}>📂 Open project file</button>
      </div>
      {job.view}
    </div>
  )
}

export function ExportTab() {
  return (
    <div className="export-tab">
      <VideoCard />
      <AnimationCard />
      <ImageCard />
      <AudioCard />
      <ProjectCard />
    </div>
  )
}
