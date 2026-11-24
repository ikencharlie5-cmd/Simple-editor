/** Audio effects: voice changers, noise reduction, EQ. Work in both live (AudioContext) and offline rendering. */
import type { AudioFx, Clip } from '../core/types'

export const VOICES = ['none', 'deep', 'chipmunk', 'robot', 'echo', 'reverb', 'radio', 'telephone', 'megaphone', 'underwater', 'monster', 'alien'] as const
export type Voice = (typeof VOICES)[number]
export const VOICE_LABELS: Record<Voice, string> = {
  none: 'None', deep: 'Deep voice', chipmunk: 'Chipmunk', robot: 'Robot', echo: 'Echo', reverb: 'Big room', radio: 'Old radio',
  telephone: 'Telephone', megaphone: 'Megaphone', underwater: 'Underwater', monster: 'Monster', alien: 'Alien',
}
export const DEFAULT_FX = (): AudioFx => ({ voice: 'none', denoise: 0, bass: 0, treble: 0 })
export const hasFx = (fx?: AudioFx) => !!fx && (fx.voice !== 'none' || fx.denoise > 0 || fx.bass !== 0 || fx.treble !== 0)

/* ---------------- offline buffer processing (pitch, noise) ---------------- */

/** Granular pitch shift that keeps duration (overlap-add with Hann windows). */
export function pitchShift(buf: AudioBuffer, semitones: number): AudioBuffer {
  const ratio = Math.pow(2, semitones / 12)
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: buf.sampleRate })
  const G = Math.round(buf.sampleRate * 0.06), hop = G / 4
  const win = new Float32Array(G)
  for (let i = 0; i < G; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (G - 1))
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch), dst = out.getChannelData(ch)
    const norm = new Float32Array(dst.length)
    for (let pos = 0; pos < dst.length; pos += hop) {
      for (let i = 0; i < G; i++) {
        const sp = pos + i * ratio - (G * (ratio - 1)) / 2
        const i0 = Math.floor(sp), f = sp - i0
        if (i0 < 0 || i0 + 1 >= src.length || pos + i >= dst.length) continue
        dst[pos + i] += (src[i0] * (1 - f) + src[i0 + 1] * f) * win[i]
        norm[pos + i] += win[i]
      }
    }
    for (let i = 0; i < dst.length; i++) if (norm[i] > 1e-3) dst[i] /= norm[i]
  }
  return out
}

/** Noise reduction: rumble/hiss filtering plus a soft downward expander between words. */
export function denoise(buf: AudioBuffer, amount: number): AudioBuffer {
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: buf.sampleRate })
  const sr = buf.sampleRate
  const win = Math.round(sr * 0.02)
  // envelope from the mix
  const n = Math.ceil(buf.length / win)
  const env = new Float32Array(n)
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch)
    for (let b = 0; b < n; b++) { let s = 0; for (let i = b * win; i < Math.min(d.length, (b + 1) * win); i++) s += d[i] * d[i]; env[b] += s / win }
  }
  for (let b = 0; b < n; b++) env[b] = Math.sqrt(env[b] / buf.numberOfChannels)
  const sorted = Float32Array.from(env).sort()
  const floor = sorted[Math.floor(n * 0.15)] || 1e-4
  const thr = floor * (2 + amount * 4)
  const gain = new Float32Array(n)
  let g = 1
  for (let b = 0; b < n; b++) {
    const target = env[b] >= thr ? 1 : Math.pow(Math.max(env[b], 1e-6) / thr, 1 + amount * 3)
    g = target > g ? g + (target - g) * 0.6 : g + (target - g) * 0.15 // fast attack, slow release
    gain[b] = Math.max(1 - amount * 0.97, g)
  }
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const s = buf.getChannelData(ch), d = out.getChannelData(ch)
    // one-pole high-pass (~80 Hz) and low-pass (hiss) filters
    const hpA = Math.exp((-2 * Math.PI * 80) / sr), lpA = Math.exp((-2 * Math.PI * (12000 - amount * 6000)) / sr)
    let hpPrevIn = 0, hpPrevOut = 0, lp = 0
    for (let i = 0; i < s.length; i++) {
      const hp = hpA * (hpPrevOut + s[i] - hpPrevIn); hpPrevIn = s[i]; hpPrevOut = hp
      lp = lp * lpA + hp * (1 - lpA)
      const b = Math.min(n - 1, Math.floor(i / win)), f = (i % win) / win
      const gg = gain[b] * (1 - f) + (gain[Math.min(n - 1, b + 1)] ?? gain[b]) * f
      d[i] = (amount > 0.3 ? lp : hp) * gg
    }
  }
  return out
}

const procCache = new Map<string, AudioBuffer>()
/** Apply the offline parts of a clip's effects (cached). */
export function processBuffer(c: Clip, buf: AudioBuffer): AudioBuffer {
  const fx = c.audioFx
  if (!fx) return buf
  const semis = fx.voice === 'deep' ? -5 : fx.voice === 'chipmunk' ? 7 : fx.voice === 'monster' ? -9 : fx.voice === 'alien' ? 4 : 0
  if (!semis && fx.denoise <= 0) return buf
  const key = `${c.mediaId}:${semis}:${fx.denoise.toFixed(2)}:${buf.length}`
  const hit = procCache.get(key)
  if (hit) return hit
  let out = buf
  if (fx.denoise > 0) out = denoise(out, fx.denoise)
  if (semis) out = pitchShift(out, semis)
  if (procCache.size > 12) procCache.delete(procCache.keys().next().value!)
  procCache.set(key, out)
  return out
}

/* ---------------- live node chains ---------------- */
function impulse(ctx: BaseAudioContext, secs: number, decay: number) {
  const len = Math.floor(ctx.sampleRate * secs)
  const b = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) }
  return b
}
function shaper(ctx: BaseAudioContext, k: number) {
  const s = ctx.createWaveShaper()
  const curve = new Float32Array(1024)
  for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)) }
  s.curve = curve
  return s
}

/** Build an effect chain; returns input/output nodes. */
export function buildChain(ctx: BaseAudioContext, fx: AudioFx | undefined): { input: AudioNode; output: AudioNode; stop?: () => void } {
  const input = ctx.createGain()
  let node: AudioNode = input
  const add = (n: AudioNode) => { node.connect(n); node = n }
  let stop: (() => void) | undefined
  if (fx) {
    if (fx.bass) { const f = ctx.createBiquadFilter(); f.type = 'lowshelf'; f.frequency.value = 200; f.gain.value = fx.bass; add(f) }
    if (fx.treble) { const f = ctx.createBiquadFilter(); f.type = 'highshelf'; f.frequency.value = 3500; f.gain.value = fx.treble; add(f) }
    const bp = (lo: number, hi: number) => { const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = lo; add(h); const l = ctx.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = hi; add(l) }
    switch (fx.voice) {
      case 'robot': case 'alien': {
        const ring = ctx.createGain(); ring.gain.value = 0
        const osc = ctx.createOscillator(); osc.frequency.value = fx.voice === 'robot' ? 55 : 180; osc.type = 'sine'
        osc.connect(ring.gain); osc.start(); stop = () => { try { osc.stop() } catch { /* */ } }
        add(ring)
        if (fx.voice === 'robot') { const d = ctx.createDelay(); d.delayTime.value = 0.012; const fb = ctx.createGain(); fb.gain.value = 0.5; ring.connect(d).connect(fb).connect(d); const mix = ctx.createGain(); ring.connect(mix); d.connect(mix); node = mix }
        break
      }
      case 'echo': {
        const d = ctx.createDelay(1); d.delayTime.value = 0.28; const fb = ctx.createGain(); fb.gain.value = 0.42
        const mix = ctx.createGain(); node.connect(mix); node.connect(d); d.connect(fb).connect(d); d.connect(mix); node = mix
        break
      }
      case 'reverb': case 'monster': {
        const conv = ctx.createConvolver(); conv.buffer = impulse(ctx, fx.voice === 'reverb' ? 2.6 : 1.2, 2.5)
        const wet = ctx.createGain(); wet.gain.value = 0.5; const mix = ctx.createGain()
        node.connect(mix); node.connect(conv).connect(wet).connect(mix); node = mix
        break
      }
      case 'radio': bp(500, 3000); add(shaper(ctx, 8)); break
      case 'telephone': bp(350, 3400); add(shaper(ctx, 3)); break
      case 'megaphone': bp(700, 4000); add(shaper(ctx, 40)); { const g = ctx.createGain(); g.gain.value = 0.6; add(g) } break
      case 'underwater': { const l = ctx.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = 450; l.Q.value = 6; add(l); break }
    }
  }
  return { input, output: node, stop }
}
