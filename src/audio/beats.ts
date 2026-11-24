/** Simple onset/beat detection on an AudioBuffer (spectral-flux style on band energy). */
export function detectBeats(buf: AudioBuffer, from = 0, to = buf.duration, sensitivity = 1.4): number[] {
  const sr = buf.sampleRate
  const a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a
  const hop = 512, win = 1024
  const s0 = Math.floor(from * sr), s1 = Math.min(a.length, Math.floor(to * sr))
  const energy: number[] = []
  let prevLow = 0
  for (let i = s0; i + win < s1; i += hop) {
    // emphasise low end (kick drum) with a one-pole low-pass
    let e = 0, low = prevLow
    for (let j = 0; j < win; j++) { const x = (a[i + j] + b[i + j]) / 2; low += 0.08 * (x - low); e += low * low + x * x * 0.15 }
    prevLow = low
    energy.push(Math.sqrt(e / win))
  }
  const flux = energy.map((e, i) => Math.max(0, e - (energy[i - 1] ?? e)))
  const beats: number[] = []
  const W = 43 // ~0.5s window
  let last = -1
  for (let i = 0; i < flux.length; i++) {
    let m = 0, n = 0
    for (let k = Math.max(0, i - W); k < Math.min(flux.length, i + W); k++) { m += flux[k]; n++ }
    m /= n || 1
    const t = from + (i * hop) / sr
    if (flux[i] > m * sensitivity && flux[i] > 0.002 && flux[i] >= (flux[i - 1] ?? 0) && flux[i] >= (flux[i + 1] ?? 0) && t - last > 0.28) { beats.push(t); last = t }
  }
  return beats
}
