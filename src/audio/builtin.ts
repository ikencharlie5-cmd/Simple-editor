import { encodeWav } from './engine'

/** Procedurally generated, royalty-free sounds. */
type Gen = (ctx: OfflineAudioContext) => void
interface SoundDef { name: string; category: 'Effects' | 'Music loops'; duration: number; gen: Gen }

function noise(ctx: OfflineAudioContext, dur: number) {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const s = ctx.createBufferSource(); s.buffer = b
  return s
}
function env(ctx: OfflineAudioContext, at: number, a: number, peak: number, r: number) {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(peak, at + a)
  g.gain.exponentialRampToValueAtTime(0.0001, at + a + r)
  return g
}
function tone(ctx: OfflineAudioContext, type: OscillatorType, f0: number, f1: number, at: number, dur: number, vol = 0.5, dest: AudioNode = ctx.destination) {
  const o = ctx.createOscillator(); o.type = type
  o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur)
  const g = env(ctx, at, 0.005, vol, dur)
  o.connect(g).connect(dest); o.start(at); o.stop(at + dur + 0.05)
}
function kick(ctx: OfflineAudioContext, at: number, vol = 0.9) { tone(ctx, 'sine', 150, 40, at, 0.35, vol) }
function snare(ctx: OfflineAudioContext, at: number, vol = 0.35) {
  const n = noise(ctx, 0.2); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500
  n.connect(f).connect(env(ctx, at, 0.002, vol, 0.15)).connect(ctx.destination); n.start(at)
  tone(ctx, 'triangle', 220, 120, at, 0.1, 0.2)
}
function hat(ctx: OfflineAudioContext, at: number, vol = 0.12) {
  const n = noise(ctx, 0.06); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000
  n.connect(f).connect(env(ctx, at, 0.001, vol, 0.04)).connect(ctx.destination); n.start(at)
}
const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12)
function chord(ctx: OfflineAudioContext, notes: number[], at: number, dur: number, type: OscillatorType = 'triangle', vol = 0.08) {
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; lp.connect(ctx.destination)
  for (const n of notes) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = NOTE(n); o.detune.value = (Math.random() - 0.5) * 12
    const g = ctx.createGain(); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + 0.08); g.gain.setValueAtTime(vol, at + dur - 0.1); g.gain.linearRampToValueAtTime(0, at + dur)
    o.connect(g).connect(lp); o.start(at); o.stop(at + dur)
  }
}

export const BUILTIN_SOUNDS: SoundDef[] = [
  { name: 'Pop', category: 'Effects', duration: 0.25, gen: (c) => tone(c, 'sine', 900, 200, 0, 0.15, 0.7) },
  { name: 'Click', category: 'Effects', duration: 0.1, gen: (c) => tone(c, 'square', 2000, 1500, 0, 0.03, 0.3) },
  { name: 'Ding', category: 'Effects', duration: 1.5, gen: (c) => { tone(c, 'sine', 1318, 1318, 0, 1.4, 0.4); tone(c, 'sine', 2636, 2636, 0, 0.8, 0.12) } },
  { name: 'Whoosh', category: 'Effects', duration: 0.9, gen: (c) => {
    const n = noise(c, 0.9); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2
    f.frequency.setValueAtTime(300, 0); f.frequency.exponentialRampToValueAtTime(4000, 0.45); f.frequency.exponentialRampToValueAtTime(500, 0.85)
    const g = c.createGain(); g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.8, 0.4); g.gain.linearRampToValueAtTime(0, 0.88)
    n.connect(f).connect(g).connect(c.destination); n.start(0)
  } },
  { name: 'Riser', category: 'Effects', duration: 3, gen: (c) => { tone(c, 'sawtooth', 100, 1600, 0, 2.9, 0.15); const n = noise(c, 3); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.setValueAtTime(200, 0); f.frequency.exponentialRampToValueAtTime(8000, 2.9); const g = c.createGain(); g.gain.setValueAtTime(0.001, 0); g.gain.exponentialRampToValueAtTime(0.3, 2.9); n.connect(f).connect(g).connect(c.destination); n.start() } },
  { name: 'Bass drop', category: 'Effects', duration: 2, gen: (c) => { tone(c, 'sine', 120, 30, 0, 1.9, 0.9); tone(c, 'sawtooth', 60, 25, 0, 1.2, 0.15) } },
  { name: 'Boing', category: 'Effects', duration: 0.8, gen: (c) => { const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(200, 0); for (let i = 0; i < 8; i++) o.frequency.setValueAtTime(i % 2 ? 260 : 180 + i * 20, i * 0.08); const g = env(c, 0, 0.01, 0.5, 0.75); o.connect(g).connect(c.destination); o.start(); o.stop(0.8) } },
  { name: 'Error buzz', category: 'Effects', duration: 0.5, gen: (c) => { tone(c, 'square', 140, 130, 0, 0.18, 0.25); tone(c, 'square', 140, 130, 0.22, 0.2, 0.25) } },
  { name: 'Success chime', category: 'Effects', duration: 1.2, gen: (c) => { [72, 76, 79, 84].forEach((n, i) => tone(c, 'triangle', NOTE(n), NOTE(n), i * 0.09, 0.8, 0.25)) } },
  { name: 'Camera shutter', category: 'Effects', duration: 0.3, gen: (c) => { [0, 0.08].forEach((t) => { const n = noise(c, 0.06); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3000; n.connect(f).connect(env(c, t, 0.001, 0.8, 0.05)).connect(c.destination); n.start(t) }) } },
  { name: 'Applause', category: 'Effects', duration: 3, gen: (c) => { for (let i = 0; i < 260; i++) { const t = Math.random() * 2.7; const n = noise(c, 0.03); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800 + Math.random() * 2500; n.connect(f).connect(env(c, t, 0.001, 0.25, 0.03)).connect(c.destination); n.start(t) } } },
  { name: 'Chicken cluck', category: 'Effects', duration: 1.2, gen: (c) => { [0, 0.18, 0.34, 0.6].forEach((t, i) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(i === 3 ? 700 : 520, t); o.frequency.exponentialRampToValueAtTime(i === 3 ? 1100 : 380, t + (i === 3 ? 0.4 : 0.1)); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 3; o.connect(f).connect(env(c, t, 0.005, 0.6, i === 3 ? 0.45 : 0.1)).connect(c.destination); o.start(t); o.stop(t + 0.6) }) } },
  { name: 'Lo-fi beat (8 bars)', category: 'Music loops', duration: 16, gen: (c) => {
    const spb = 60 / 90 // 90 BPM, 4/4 → 8 bars ≈ 21s; use 16s loop with 6 bars
    const prog = [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]]
    for (let bar = 0; bar < 6; bar++) {
      const b0 = bar * spb * 4
      if (b0 >= 16) break
      chord(c, prog[bar % 4], b0, spb * 4, 'triangle', 0.06)
      for (let beat = 0; beat < 4; beat++) {
        const t = b0 + beat * spb
        if (t > 15.8) break
        if (beat === 0 || beat === 2) kick(c, t, 0.7); else snare(c, t, 0.22)
        hat(c, t); hat(c, t + spb * 0.55, 0.07)
      }
    }
  } },
  { name: 'Upbeat pop loop', category: 'Music loops', duration: 15, gen: (c) => {
    const spb = 60 / 128
    const prog = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]
    const bars = Math.floor(15 / (spb * 4))
    for (let bar = 0; bar < bars; bar++) {
      const b0 = bar * spb * 4
      chord(c, prog[bar % 4].map((n) => n + 12), b0, spb * 4, 'sawtooth', 0.035)
      for (let beat = 0; beat < 4; beat++) {
        const t = b0 + beat * spb
        kick(c, t, 0.8); if (beat % 2) snare(c, t, 0.3)
        hat(c, t + spb / 2, 0.12)
        tone(c, 'square', NOTE(prog[bar % 4][0] - 12), NOTE(prog[bar % 4][0] - 12), t + spb / 2, spb / 2 - 0.02, 0.12)
      }
    }
  } },
  { name: 'Ambient pad', category: 'Music loops', duration: 20, gen: (c) => {
    const prog = [[48, 55, 60, 64], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59]]
    prog.forEach((ch, i) => chord(c, ch, i * 5, 5.4, 'sine', 0.07))
  } },
  { name: 'Hip-hop beat', category: 'Music loops', duration: 16, gen: (c) => {
    const spb = 60 / 85
    for (let t = 0, i = 0; t < 15.9; t += spb / 2, i++) {
      const step = i % 8
      if (step === 0 || step === 3 || step === 5) kick(c, t, 0.9)
      if (step === 2 || step === 6) snare(c, t, 0.35)
      hat(c, t, 0.1)
    }
    for (let bar = 0; bar * spb * 4 < 16; bar++) tone(c, 'sine', NOTE(36 + [0, 0, 3, 5][bar % 4]), NOTE(36 + [0, 0, 3, 5][bar % 4]), bar * spb * 4, spb * 3.5, 0.35)
  } },
]

export async function renderBuiltin(def: SoundDef): Promise<Blob> {
  const sr = 44100
  const ctx = new OfflineAudioContext(2, Math.ceil(def.duration * sr), sr)
  def.gen(ctx)
  const buf = await ctx.startRendering()
  return encodeWav(buf)
}
