import { nanoid } from 'nanoid'
import type { MediaItem } from './types'
import { loadBlob, saveBlob } from './db'

/** Runtime caches for media resources (not persisted). */
const urls = new Map<string, string>()
const images = new Map<string, HTMLImageElement>()
const videos = new Map<string, HTMLVideoElement>()
const audioBuffers = new Map<string, AudioBuffer | null>()
const blobCache = new Map<string, Blob>()

let audioCtx: AudioContext | null = null
export function getAudioContext() {
  if (!audioCtx) audioCtx = new AudioContext()
  return audioCtx
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  if (blobCache.has(id)) return blobCache.get(id)
  const b = await loadBlob(id)
  if (b) blobCache.set(id, b)
  return b
}

export async function getUrl(id: string): Promise<string | undefined> {
  if (urls.has(id)) return urls.get(id)
  const b = await getBlob(id)
  if (!b) return undefined
  const u = URL.createObjectURL(b)
  urls.set(id, u)
  return u
}

export async function getImage(id: string): Promise<HTMLImageElement | undefined> {
  if (images.has(id)) return images.get(id)
  const url = await getUrl(id)
  if (!url) return undefined
  const img = new Image()
  img.src = url
  await img.decode().catch(() => undefined)
  images.set(id, img)
  return img
}
export const peekImage = (id: string) => images.get(id)

/** Returns a dedicated video element for a clip (each clip needs its own playhead). */
export async function getVideo(key: string, mediaId: string): Promise<HTMLVideoElement | undefined> {
  if (videos.has(key)) return videos.get(key)
  const url = await getUrl(mediaId)
  if (!url) return undefined
  const v = document.createElement('video')
  v.src = url
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  v.crossOrigin = 'anonymous'
  videos.set(key, v)
  await new Promise<void>((res) => {
    if (v.readyState >= 2) return res()
    v.addEventListener('loadeddata', () => res(), { once: true })
    v.addEventListener('error', () => res(), { once: true })
  })
  return v
}
export const peekVideo = (key: string) => videos.get(key)
export const allVideos = () => videos

export async function getAudioBuffer(id: string): Promise<AudioBuffer | null> {
  if (audioBuffers.has(id)) return audioBuffers.get(id)!
  const b = await getBlob(id)
  if (!b) return null
  try {
    const buf = await getAudioContext().decodeAudioData(await b.arrayBuffer())
    audioBuffers.set(id, buf)
    return buf
  } catch {
    audioBuffers.set(id, null)
    return null
  }
}
export const peekAudioBuffer = (id: string) => audioBuffers.get(id) ?? null

export function seekVideo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((res) => {
    const target = Math.max(0, Math.min(t, (v.duration || t) - 0.001))
    if (Math.abs(v.currentTime - target) < 0.001 && v.readyState >= 2) return res()
    const done = () => { clearTimeout(to); res() }
    const to = setTimeout(done, 1500)
    v.addEventListener('seeked', done, { once: true })
    v.currentTime = target
  })
}

function kindOf(file: File): MediaItem['kind'] | null {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('audio/')) return 'audio'
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (['mp4', 'webm', 'mov', 'mkv', 'm4v'].includes(ext)) return 'video'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) return 'image'
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio'
  return null
}

/** Imports a file into persistent storage and returns its MediaItem. */
export async function importFile(file: Blob & { name?: string }, nameOverride?: string, builtIn = false): Promise<MediaItem | null> {
  const name = nameOverride ?? (file as File).name ?? 'media'
  const kind = kindOf(file as File)
  if (!kind) return null
  const id = nanoid(10)
  await saveBlob(id, file)
  blobCache.set(id, file)
  const item: MediaItem = { id, name, kind, duration: 0, width: 0, height: 0, builtIn }
  const url = await getUrl(id)
  if (kind === 'image') {
    const img = await getImage(id)
    item.width = img?.naturalWidth ?? 0
    item.height = img?.naturalHeight ?? 0
    item.duration = 5
  } else if (kind === 'video') {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.src = url!
    await new Promise<void>((res) => { v.onloadedmetadata = () => res(); v.onerror = () => res() })
    item.duration = isFinite(v.duration) ? v.duration : 10
    item.width = v.videoWidth
    item.height = v.videoHeight
    const buf = await getAudioBuffer(id)
    item.hasAudio = !!buf
  } else if (kind === 'audio') {
    const buf = await getAudioBuffer(id)
    item.duration = buf?.duration ?? 0
  }
  return item
}

/** Peak data for waveform drawing. */
const peaksCache = new Map<string, Float32Array>()
export function getPeaks(id: string, buckets = 2000): Float32Array | null {
  const key = id + ':' + buckets
  if (peaksCache.has(key)) return peaksCache.get(key)!
  const buf = peekAudioBuffer(id)
  if (!buf) return null
  const data = buf.getChannelData(0)
  const out = new Float32Array(buckets)
  const step = Math.max(1, Math.floor(data.length / buckets))
  for (let i = 0; i < buckets; i++) {
    let m = 0
    const s = i * step
    for (let j = s; j < s + step && j < data.length; j += 4) m = Math.max(m, Math.abs(data[j]))
    out[i] = m
  }
  peaksCache.set(key, out)
  return out
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((res) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = () => res(Array.from(input.files ?? []))
    input.click()
  })
}
