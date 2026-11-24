/** Auto-ducking: lower music clips wherever voice/other audio is active. */
import type { Clip, Project } from '../core/types'
import { getAudioBuffer } from '../core/media'
import { clipEnd } from '../core/store'
import { videoClipTime } from '../video/render'

export async function computeDucking(p: Project, musicTrackId: string, amount: number) {
  const step = 0.05
  const end = Math.max(0, ...p.clips.map(clipEnd))
  const n = Math.ceil(end / step) + 1
  const act = new Float32Array(n)
  const voices = p.clips.filter((c) => c.trackId !== musicTrackId && (c.kind === 'audio' || (c.kind === 'video' && p.media.find((m) => m.id === c.mediaId)?.hasAudio)) && c.volume > 0 && !p.tracks.find((t) => t.id === c.trackId)?.muted)
  for (const c of voices) {
    const buf = await getAudioBuffer(c.mediaId!)
    if (!buf) continue
    const d = buf.getChannelData(0), sr = buf.sampleRate
    for (let i = Math.floor(c.start / step); i < Math.min(n, Math.ceil(clipEnd(c) / step)); i++) {
      const st = videoClipTime(c, i * step), s0 = Math.floor(st * sr), len = Math.floor(step * sr * c.speed)
      let e = 0
      for (let k = 0; k < len; k += 4) { const v = d[s0 + k] ?? 0; e += v * v }
      act[i] = Math.max(act[i], Math.sqrt(e / Math.max(1, len / 4)))
    }
  }
  // gate with hysteresis + hold
  const thr = 0.02
  const on = new Uint8Array(n)
  let hold = 0
  for (let i = 0; i < n; i++) { if (act[i] > thr) hold = Math.round(0.35 / step); on[i] = hold > 0 ? 1 : 0; if (hold > 0) hold-- }
  const level = 1 - amount
  const music = p.clips.filter((c) => c.trackId === musicTrackId)
  const result = new Map<string, Clip['volumeKeys']>()
  for (const c of music) {
    const keys: { t: number; v: number }[] = [{ t: 0, v: on[Math.floor(c.start / step)] ? level : 1 }]
    let prev = keys[0].v
    for (let i = Math.ceil(c.start / step); i < Math.min(n, Math.floor(clipEnd(c) / step)); i++) {
      const v = on[i] ? level : 1
      if (v !== prev) {
        const t = i * step - c.start
        const ramp = v < prev ? 0.15 : 0.4 // fast duck, slow recovery
        keys.push({ t: Math.max(0, t - (v < prev ? ramp : 0)), v: prev }, { t: t + (v < prev ? 0 : ramp), v })
        prev = v
      }
    }
    result.set(c.id, keys.sort((a, b) => a.t - b.t))
  }
  return { result, voiceCount: voices.length }
}
