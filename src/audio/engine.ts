import type { Clip, Project } from '../core/types'
import { getAudioBuffer, getAudioContext, peekAudioBuffer } from '../core/media'
import { clipEnd, projectDuration } from '../core/store'
import { processBuffer, buildChain } from './fx'

/** Clips that produce sound. */
export function audibleClips(p: Project) {
  return p.clips.filter((c) => {
    const tr = p.tracks.find((t) => t.id === c.trackId)
    if (!tr || tr.muted || c.volume <= 0) return false
    if (c.kind === 'audio') return true
    if (c.kind === 'video') return !!p.media.find((m) => m.id === c.mediaId)?.hasAudio
    return false
  })
}

const revCache = new Map<string, AudioBuffer>()
function reversedSegment(buf: AudioBuffer, start: number, len: number) {
  const key = `${buf.length}:${buf.sampleRate}:${start.toFixed(3)}:${len.toFixed(3)}:${buf.getChannelData(0)[1000] ?? 0}`
  const hit = revCache.get(key)
  if (hit) return hit
  const s0 = Math.floor(start * buf.sampleRate), n = Math.max(1, Math.min(buf.length - s0, Math.floor(len * buf.sampleRate)))
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: n, sampleRate: buf.sampleRate })
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch), dst = out.getChannelData(ch)
    for (let i = 0; i < n; i++) dst[i] = src[s0 + n - 1 - i] ?? 0
  }
  if (revCache.size > 20) revCache.delete(revCache.keys().next().value!)
  revCache.set(key, out)
  return out
}

export function volumeAt(c: Clip, local: number) {
  const k = c.volumeKeys
  if (!k?.length) return 1
  if (local <= k[0].t) return k[0].v
  for (let i = 0; i < k.length - 1; i++) if (local <= k[i + 1].t) { const f = (local - k[i].t) / Math.max(1e-6, k[i + 1].t - k[i].t); return k[i].v + (k[i + 1].v - k[i].v) * f }
  return k[k.length - 1].v
}

function scheduleClip(ctx: BaseAudioContext, dest: AudioNode, p: Project, c: Clip, buf: AudioBuffer, from: number, when: number) {
  const tr = p.tracks.find((t) => t.id === c.trackId)!
  const startT = Math.max(from, c.start)
  const end = clipEnd(c)
  if (startT >= end) return null
  buf = processBuffer(c, buf)
  let offsetBase = c.inPoint
  if (c.reverse) { buf = reversedSegment(buf, c.inPoint, c.duration * c.speed); offsetBase = 0 }
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = c.speed
  const gain = ctx.createGain()
  const vol = c.volume * tr.volume
  const at = when + (startT - from)
  const stopAt = when + (end - from)
  // envelope: fades + volume automation, sampled every 50 ms
  const valueAt = (tt: number) => {
    let v = vol * volumeAt(c, tt - c.start)
    if (c.fadeIn > 0 && tt - c.start < c.fadeIn) v *= (tt - c.start) / c.fadeIn
    if (c.fadeOut > 0 && end - tt < c.fadeOut) v *= (end - tt) / c.fadeOut
    return Math.max(0, v)
  }
  const g = gain.gain
  g.setValueAtTime(valueAt(startT), at)
  const dynamic = c.fadeIn > 0 || c.fadeOut > 0 || (c.volumeKeys?.length ?? 0) > 0
  if (dynamic) for (let tt = startT + 0.05; tt < end; tt += 0.05) g.linearRampToValueAtTime(valueAt(tt), when + (tt - from))
  const chain = buildChain(ctx, c.audioFx)
  src.connect(chain.input)
  chain.output.connect(gain).connect(dest)
  const offset = offsetBase + (startT - c.start) * c.speed
  if (offset >= buf.duration) { chain.stop?.(); return null }
  src.start(at, offset)
  src.stop(stopAt)
  src.onended = () => chain.stop?.()
  return src
}

/** Live preview playback. */
let live: AudioBufferSourceNode[] = []
let master: GainNode | null = null
export const meter: { analyser: AnalyserNode | null } = { analyser: null }

export async function startPlayback(p: Project, from: number) {
  stopPlayback()
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  if (!master) {
    master = ctx.createGain()
    meter.analyser = ctx.createAnalyser()
    meter.analyser.fftSize = 256
    master.connect(meter.analyser).connect(ctx.destination)
  }
  const when = ctx.currentTime + 0.05
  for (const c of audibleClips(p)) {
    const buf = peekAudioBuffer(c.mediaId!) ?? (await getAudioBuffer(c.mediaId!))
    if (!buf) continue
    const n = scheduleClip(ctx, master, p, c, buf, from, when)
    if (n) live.push(n)
  }
  return when
}

export function stopPlayback() {
  for (const n of live) { try { n.stop() } catch { /* already stopped */ } }
  live = []
}

/** Offline mixdown of the timeline. */
export async function mixdown(p: Project, from = 0, to = projectDuration(p), sampleRate = 48000): Promise<AudioBuffer> {
  const len = Math.max(1, Math.ceil((to - from) * sampleRate))
  const ctx = new OfflineAudioContext(2, len, sampleRate)
  for (const c of audibleClips(p)) {
    const buf = await getAudioBuffer(c.mediaId!)
    if (buf) scheduleClip(ctx, ctx.destination, p, c, buf, from, 0)
  }
  return ctx.startRendering()
}

/* ---------- Encoders ---------- */
export function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2))
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ')
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, sr, true)
  out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true)
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i))
  let o = 44
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, chans[c][i])); out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2 }
  return new Blob([out.buffer], { type: 'audio/wav' })
}

export async function encodeMp3(buf: AudioBuffer, kbps = 192, onProgress?: (p: number) => void): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs')
  const ch = Math.min(2, buf.numberOfChannels)
  const enc = new Mp3Encoder(ch, buf.sampleRate, kbps)
  const toI16 = (f: Float32Array) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); o[i] = s < 0 ? s * 0x8000 : s * 0x7fff } return o }
  const L = toI16(buf.getChannelData(0)), R = ch > 1 ? toI16(buf.getChannelData(1)) : L
  const parts: BlobPart[] = []
  const block = 1152 * 20
  for (let i = 0; i < L.length; i += block) {
    const mp3 = ch > 1 ? enc.encodeBuffer(L.subarray(i, i + block), R.subarray(i, i + block)) : enc.encodeBuffer(L.subarray(i, i + block))
    if (mp3.length) parts.push(new Uint8Array(mp3))
    if (i % (block * 20) === 0) { onProgress?.(i / L.length); await new Promise((r) => setTimeout(r)) }
  }
  const end = enc.flush()
  if (end.length) parts.push(new Uint8Array(end))
  return new Blob(parts, { type: 'audio/mpeg' })
}
