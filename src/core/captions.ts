/** Speech-to-text for auto-captions using Whisper running in the browser (transformers.js). */
export interface CaptionChunk { text: string; start: number; end: number }

type ASR = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>
let asr: ASR | null = null

export async function transcribe(audio: AudioBuffer, model: 'tiny' | 'base', onStatus: (s: string, p?: number) => void): Promise<CaptionChunk[]> {
  // resample to 16 kHz mono
  onStatus('Preparing audio…')
  const ctx = new OfflineAudioContext(1, Math.ceil(audio.duration * 16000), 16000)
  const src = ctx.createBufferSource(); src.buffer = audio; src.connect(ctx.destination); src.start()
  const mono = (await ctx.startRendering()).getChannelData(0)
  if (!asr) {
    onStatus('Downloading speech model (first time only, about 40–80 MB)…', 0)
    const { pipeline } = await import('@huggingface/transformers')
    const files = new Map<string, number>()
    asr = (await pipeline('automatic-speech-recognition', model === 'tiny' ? 'Xenova/whisper-tiny' : 'Xenova/whisper-base', {
      dtype: 'q8',
      progress_callback: (x: { status: string; file?: string; progress?: number }) => {
        if (x.status === 'progress' && x.file) {
          files.set(x.file, x.progress ?? 0)
          const avg = [...files.values()].reduce((a, b) => a + b, 0) / files.size
          onStatus('Downloading speech model (first time only)…', avg / 100)
        }
      },
    })) as unknown as ASR
  }
  onStatus('Listening… this can take a minute', undefined)
  const out = await asr(mono, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true })
  const chunks = out.chunks ?? [{ text: out.text, timestamp: [0, audio.duration] as [number, number] }]
  return chunks.map((c) => ({ text: c.text.trim(), start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 2 })).filter((c) => c.text)
}

/** Split long caption chunks into short lines (CapCut-style). */
export function splitCaptions(chunks: CaptionChunk[], maxWords = 6): CaptionChunk[] {
  const out: CaptionChunk[] = []
  for (const c of chunks) {
    const words = c.text.split(/\s+/).filter(Boolean)
    if (words.length <= maxWords) { out.push(c); continue }
    const n = Math.ceil(words.length / maxWords), d = (c.end - c.start) / n
    for (let i = 0; i < n; i++) out.push({ text: words.slice(i * maxWords, (i + 1) * maxWords).join(' '), start: c.start + i * d, end: c.start + (i + 1) * d })
  }
  return out
}
