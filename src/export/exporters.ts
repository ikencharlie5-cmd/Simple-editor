import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer'
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer'
import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import UPNG from 'upng-js'
import JSZip from 'jszip'
import type { AnimationDoc, Project } from '../core/types'
import { clipEnd, makeClip, newTrack, projectDuration } from '../core/store'
import { getVideo, seekVideo, getBlob, getImage } from '../core/media'
import { renderFrame, videoClipTime } from '../video/render'
import { mixdown } from '../audio/engine'
import { preloadAnimation, renderAnimation } from '../animator/render'
import { saveBlob } from '../core/db'
import { loadSegmenter } from '../core/segment'

export type Progress = (p: number, label?: string) => void
export class Cancelled extends Error {}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

async function pickVideoCodec(fmt: 'mp4' | 'webm', w: number, h: number, fps: number, bitrate: number) {
  const cands = fmt === 'mp4'
    ? ['avc1.640033', 'avc1.640028', 'avc1.4d0028', 'avc1.42001f']
    : ['vp09.00.40.08', 'vp09.00.10.08', 'vp8']
  for (const codec of cands) {
    const cfg: VideoEncoderConfig = { codec, width: w, height: h, bitrate, framerate: fps, latencyMode: 'quality' }
    if (codec.startsWith('avc1')) (cfg as VideoEncoderConfig & { avc?: { format: 'avc' } }).avc = { format: 'avc' }
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg } catch { /* try next */ }
  }
  return null
}
async function pickAudioCodec(fmt: 'mp4' | 'webm', sr: number) {
  const cands = fmt === 'mp4' ? [{ codec: 'mp4a.40.2', mux: 'aac' as const }, { codec: 'opus', mux: 'opus' as const }] : [{ codec: 'opus', mux: 'opus' as const }]
  for (const c of cands) {
    const cfg: AudioEncoderConfig = { codec: c.codec, sampleRate: sr, numberOfChannels: 2, bitrate: 192000 }
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux: c.mux } } catch { /* next */ }
  }
  return null
}

export interface VideoExportOpts { format: 'mp4' | 'webm' | 'mov'; height: number; fps: number; bitrate: number; from: number; to: number; audio: boolean }

export async function exportVideo(p: Project, o: VideoExportOpts, onProgress: Progress, signal: AbortSignal): Promise<Blob> {
  if (typeof VideoEncoder === 'undefined') throw new Error('This browser does not support WebCodecs video encoding. Use Chrome (ChromeOS, Windows, Mac) 94 or newer.')
  const fmt = o.format === 'webm' ? 'webm' : 'mp4'
  const h = even(o.height), w = even((o.height * p.width) / p.height)
  const dur = Math.max(0.05, o.to - o.from)
  const vcfg = await pickVideoCodec(fmt, w, h, o.fps, o.bitrate)
  if (!vcfg) throw new Error(`No ${fmt.toUpperCase()} video encoder available at ${w}×${h}. Try a lower resolution or WebM.`)

  // audio first (so we know codec)
  let audioBuf: AudioBuffer | null = null
  let acfg: Awaited<ReturnType<typeof pickAudioCodec>> = null
  if (o.audio && typeof AudioEncoder !== 'undefined') {
    onProgress(0, 'Mixing audio…')
    audioBuf = await mixdown(p, o.from, o.to, 48000)
    let silent = true
    const ch0 = audioBuf.getChannelData(0)
    for (let i = 0; i < ch0.length; i += 97) if (ch0[i] !== 0) { silent = false; break }
    if (silent) audioBuf = null
    else acfg = await pickAudioCodec(fmt, 48000)
  }

  const target = fmt === 'mp4' ? new Mp4Target() : new WebmTarget()
  const muxer = fmt === 'mp4'
    ? new Mp4Muxer({ target: target as Mp4Target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
      video: { codec: 'avc', width: w, height: h, frameRate: o.fps },
      ...(acfg ? { audio: { codec: acfg.mux as 'aac' | 'opus', sampleRate: 48000, numberOfChannels: 2 } } : {}) })
    : new WebmMuxer({ target: target as WebmTarget, firstTimestampBehavior: 'offset',
      video: { codec: vcfg.codec.startsWith('vp8') ? 'V_VP8' : 'V_VP9', width: w, height: h, frameRate: o.fps },
      ...(acfg ? { audio: { codec: 'A_OPUS', sampleRate: 48000, numberOfChannels: 2 } } : {}) })

  let encErr: Error | null = null
  const venc = new VideoEncoder({
    output: (chunk, meta) => (muxer as Mp4Muxer<Mp4Target>).addVideoChunk(chunk, meta),
    error: (e) => { encErr = e },
  })
  venc.configure(vcfg)

  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.imageSmoothingQuality = 'high'

  // preload resources
  if (p.clips.some((c) => c.removeBg)) { onProgress(0, 'Loading background-removal model…'); await loadSegmenter() }
  for (const a of p.animations) await preloadAnimation(a)
  for (const c of p.clips) if (c.kind === 'image' && c.mediaId) await getImage(c.mediaId)
  for (const c of p.clips) if (c.kind === 'video' && c.mediaId) await getVideo(c.id, c.mediaId)

  const total = Math.ceil(dur * o.fps)
  for (let i = 0; i < total; i++) {
    if (signal.aborted) { venc.close(); throw new Cancelled() }
    if (encErr) throw encErr
    const t = o.from + i / o.fps
    const seeks: Promise<void>[] = []
    for (const c of p.clips) {
      if (c.kind !== 'video' || t < c.start || t >= clipEnd(c)) continue
      const v = await getVideo(c.id, c.mediaId!)
      if (v) seeks.push(seekVideo(v, videoClipTime(c, t)))
    }
    // also previous clip for transitions
    await Promise.all(seeks)
    renderFrame(ctx, p, t)
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / o.fps), duration: Math.round(1e6 / o.fps) })
    venc.encode(frame, { keyFrame: i % (o.fps * 2) === 0 })
    frame.close()
    while (venc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5))
    if (i % 3 === 0) onProgress((i / total) * (audioBuf ? 0.9 : 1), `Rendering frame ${i + 1}/${total}`)
  }
  await venc.flush()
  venc.close()

  if (audioBuf && acfg) {
    onProgress(0.92, 'Encoding audio…')
    const aenc = new AudioEncoder({
      output: (chunk, meta) => (muxer as Mp4Muxer<Mp4Target>).addAudioChunk(chunk, meta),
      error: (e) => { encErr = e },
    })
    aenc.configure(acfg.cfg)
    const L = audioBuf.getChannelData(0), R = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : L
    const N = 1024 * 4
    for (let i = 0; i < L.length; i += N) {
      const n = Math.min(N, L.length - i)
      const data = new Float32Array(n * 2)
      data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n)
      const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / 48000) * 1e6), data })
      aenc.encode(ad); ad.close()
      if (aenc.encodeQueueSize > 20) await new Promise((r) => setTimeout(r, 2))
    }
    await aenc.flush(); aenc.close()
    if (encErr) throw encErr
  }
  muxer.finalize()
  onProgress(1, 'Done')
  const buf = (target as Mp4Target).buffer
  const type = o.format === 'mov' ? 'video/quicktime' : fmt === 'mp4' ? 'video/mp4' : 'video/webm'
  return new Blob([buf], { type })
}

/** Wrap an animation as a temporary single-clip project for video export. */
export function animationProject(a: AnimationDoc, bg = '#000000'): Project {
  const tr = newTrack('video', 1)
  const atr = newTrack('audio', 1)
  const mediaId = 'anim-' + a.id
  return {
    id: 'tmp', name: a.name, width: a.width, height: a.height, fps: a.fps, background: a.background || bg,
    tracks: a.audio ? [tr, atr] : [tr],
    clips: [makeClip('animation', tr.id, 0, a.duration, { mediaId }), ...(a.audio ? [makeClip('audio', atr.id, 0, a.duration, { mediaId: a.audio.mediaId, inPoint: a.audio.offset, volume: a.audio.volume })] : [])],
    media: [{ id: mediaId, name: a.name, kind: 'animation', duration: a.duration, width: a.width, height: a.height, animationId: a.id }, ...(a.audio ? [{ id: a.audio.mediaId, name: 'soundtrack', kind: 'audio' as const, duration: a.duration, width: 0, height: 0 }] : [])],
    animations: [a], updatedAt: 0,
  }
}

/* ---------------- frame sources for GIF / APNG / sprites ---------------- */
export type FrameSource = { width: number; height: number; fps: number; duration: number; transparent: boolean; draw: (ctx: CanvasRenderingContext2D, t: number) => Promise<void> }

export function animationSource(a: AnimationDoc): FrameSource {
  return {
    width: a.width, height: a.height, fps: a.fps, duration: a.duration, transparent: !a.background,
    draw: async (ctx, t) => { ctx.clearRect(0, 0, a.width, a.height); renderAnimation(ctx, a, t) },
  }
}
export function timelineSource(p: Project, from: number, to: number, fps: number): FrameSource {
  return {
    width: p.width, height: p.height, fps, duration: to - from, transparent: false,
    draw: async (ctx, t) => {
      const tt = from + t
      for (const c of p.clips) {
        if (c.kind !== 'video' || tt < c.start || tt >= clipEnd(c)) continue
        const v = await getVideo(c.id, c.mediaId!)
        if (v) await seekVideo(v, videoClipTime(c, tt))
      }
      renderFrame(ctx, p, tt)
    },
  }
}

async function renderFrames(src: FrameSource, scale: number, fps: number, onProgress: Progress, signal: AbortSignal) {
  const w = Math.max(1, Math.round(src.width * scale)), h = Math.max(1, Math.round(src.height * scale))
  const full = document.createElement('canvas'); full.width = src.width; full.height = src.height
  const fctx = full.getContext('2d', { willReadFrequently: true })!
  const small = document.createElement('canvas'); small.width = w; small.height = h
  const sctx = small.getContext('2d', { willReadFrequently: true })!
  const n = Math.max(1, Math.ceil(src.duration * fps))
  const frames: ImageData[] = []
  for (let i = 0; i < n; i++) {
    if (signal.aborted) throw new Cancelled()
    await src.draw(fctx, i / fps)
    sctx.clearRect(0, 0, w, h)
    sctx.drawImage(full, 0, 0, w, h)
    frames.push(sctx.getImageData(0, 0, w, h))
    if (i % 2 === 0) { onProgress((i / n) * 0.8, `Rendering frame ${i + 1}/${n}`); await new Promise((r) => setTimeout(r)) }
  }
  return { frames, w, h }
}

export async function exportGif(src: FrameSource, o: { scale: number; fps: number; loop: boolean }, onProgress: Progress, signal: AbortSignal) {
  const { frames, w, h } = await renderFrames(src, o.scale, o.fps, onProgress, signal)
  const gif = GIFEncoder()
  const delay = Math.round(1000 / o.fps)
  for (let i = 0; i < frames.length; i++) {
    if (signal.aborted) throw new Cancelled()
    const data = frames[i].data
    const format = src.transparent ? 'rgba4444' : 'rgb565'
    const palette = quantize(data, 256, { format, oneBitAlpha: src.transparent ? 127 : false, clearAlpha: src.transparent })
    const index = applyPalette(data, palette, format)
    const tIdx = src.transparent ? palette.findIndex((c) => c[3] === 0) : -1
    gif.writeFrame(index, w, h, { palette, delay, repeat: o.loop ? 0 : -1, transparent: tIdx >= 0, transparentIndex: Math.max(0, tIdx), dispose: src.transparent ? 2 : -1 })
    if (i % 3 === 0) { onProgress(0.8 + (i / frames.length) * 0.2, `Encoding GIF ${i + 1}/${frames.length}`); await new Promise((r) => setTimeout(r)) }
  }
  gif.finish()
  return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' })
}

export async function exportApng(src: FrameSource, o: { scale: number; fps: number }, onProgress: Progress, signal: AbortSignal) {
  const { frames, w, h } = await renderFrames(src, o.scale, o.fps, onProgress, signal)
  onProgress(0.85, 'Encoding APNG…')
  await new Promise((r) => setTimeout(r, 10))
  const bufs = frames.map((f) => f.data.buffer.slice(0) as ArrayBuffer)
  const png = UPNG.encode(bufs, w, h, 0, frames.map(() => Math.round(1000 / o.fps)))
  return new Blob([png], { type: 'image/apng' })
}

export async function exportSpriteSheet(src: FrameSource, o: { scale: number; fps: number; columns: number }, onProgress: Progress, signal: AbortSignal) {
  const { frames, w, h } = await renderFrames(src, o.scale, o.fps, onProgress, signal)
  const cols = Math.max(1, Math.min(o.columns, frames.length))
  const rows = Math.ceil(frames.length / cols)
  const sheet = document.createElement('canvas'); sheet.width = cols * w; sheet.height = rows * h
  const sx = sheet.getContext('2d')!
  frames.forEach((f, i) => sx.putImageData(f, (i % cols) * w, Math.floor(i / cols) * h))
  const png = await new Promise<Blob>((r) => sheet.toBlob((b) => r(b!), 'image/png'))
  const meta = {
    frames: frames.map((_, i) => ({ frame: i, x: (i % cols) * w, y: Math.floor(i / cols) * h, w, h, duration: Math.round(1000 / o.fps) })),
    meta: { app: 'Chiken', size: { w: sheet.width, h: sheet.height }, frameSize: { w, h }, fps: o.fps, columns: cols, rows },
  }
  const zip = new JSZip()
  zip.file('spritesheet.png', png)
  zip.file('spritesheet.json', JSON.stringify(meta, null, 2))
  return zip.generateAsync({ type: 'blob' })
}

/* ---------------- images ---------------- */
export function canvasToBlob(c: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Encoding failed'))), type, quality))
}
export function scaledCanvas(src: HTMLCanvasElement, scale: number, bg?: string) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(src.width * scale)); c.height = Math.max(1, Math.round(src.height * scale))
  const x = c.getContext('2d')!
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height) }
  x.imageSmoothingQuality = 'high'
  x.drawImage(src, 0, 0, c.width, c.height)
  return c
}

/* ---------------- project files (.chiken) ---------------- */
export async function exportProjectFile(p: Project, photo: { meta: unknown; layers: { id: string; blob: Blob }[] } | null) {
  const zip = new JSZip()
  zip.file('project.json', JSON.stringify(p))
  zip.file('format.txt', 'Chiken project v1')
  for (const m of p.media) {
    if (m.kind === 'animation') continue
    const b = await getBlob(m.id)
    if (b) zip.file('media/' + m.id, b)
  }
  if (photo) {
    zip.file('photo/meta.json', JSON.stringify(photo.meta))
    for (const l of photo.layers) zip.file('photo/' + l.id + '.png', l.blob)
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE' })
}

export async function importProjectFile(f: Blob) {
  const zip = await JSZip.loadAsync(f)
  const pj = await zip.file('project.json')?.async('string')
  if (!pj) throw new Error('Not a Chiken project file')
  const p = JSON.parse(pj) as Project
  for (const m of p.media) {
    const e = zip.file('media/' + m.id)
    if (e) await saveBlob(m.id, await e.async('blob'))
  }
  let photo: { meta: unknown; layers: Record<string, Blob> } | null = null
  const meta = await zip.file('photo/meta.json')?.async('string')
  if (meta) {
    const layers: Record<string, Blob> = {}
    for (const name of Object.keys(zip.files)) if (name.startsWith('photo/') && name.endsWith('.png')) layers[name.slice(6, -4)] = await zip.files[name].async('blob')
    photo = { meta: JSON.parse(meta), layers }
  }
  return { project: p, photo }
}

export { projectDuration }
