/** On-device person segmentation (MediaPipe selfie segmenter), used for background removal. */
import type { ImageSegmenter } from '@mediapipe/tasks-vision'

let seg: ImageSegmenter | null = null
let loading: Promise<void> | null = null
let failed = false
const base = new URL('.', document.baseURI).href

export function segmenterStatus() { return seg ? 'ready' : failed ? 'failed' : loading ? 'loading' : 'idle' }

export function loadSegmenter(): Promise<void> {
  if (seg || failed) return Promise.resolve()
  if (!loading) loading = (async () => {
    try {
      const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
      const files = await FilesetResolver.forVisionTasks(base + 'mediapipe')
      seg = await ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: base + 'models/selfie_segmenter.tflite', delegate: 'CPU' },
        runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
      })
    } catch (e) {
      console.warn('Segmentation unavailable', e)
      failed = true
    }
  })()
  return loading
}

const small = document.createElement('canvas')
const maskC = document.createElement('canvas')
const cache = new WeakMap<object, { key: number; c: HTMLCanvasElement }>()

/** Returns an alpha mask canvas (person = opaque) sized `w`×`h`, or null while the model loads. */
export function personMask(src: CanvasImageSource, w: number, h: number, frameKey: number, owner: object, softness = 0.5): HTMLCanvasElement | null {
  if (!seg) { void loadSegmenter(); return null }
  const hit = cache.get(owner)
  if (hit && hit.key === frameKey) return hit.c
  const S = 256
  const sw = w >= h ? S : Math.round((S * w) / h), sh = w >= h ? Math.round((S * h) / w) : S
  small.width = sw; small.height = sh
  small.getContext('2d')!.drawImage(src, 0, 0, sw, sh)
  const res = seg.segment(small)
  const conf = res.confidenceMasks?.[0]
  if (!conf) { res.close(); return null }
  const f = conf.getAsFloat32Array()
  maskC.width = sw; maskC.height = sh
  const mx = maskC.getContext('2d')!
  const id = mx.createImageData(sw, sh)
  const lo = 0.5 - softness * 0.4, hi = 0.5 + softness * 0.4
  for (let i = 0; i < f.length; i++) { const v = Math.min(1, Math.max(0, (f[i] - lo) / (hi - lo || 1))); id.data[i * 4 + 3] = v * 255 }
  mx.putImageData(id, 0, 0)
  res.close()
  const out = hit?.c ?? document.createElement('canvas')
  out.width = w; out.height = h
  const ox = out.getContext('2d')!
  ox.clearRect(0, 0, w, h); ox.imageSmoothingQuality = 'high'
  ox.filter = 'blur(1px)'; ox.drawImage(maskC, 0, 0, w, h); ox.filter = 'none'
  cache.set(owner, { key: frameKey, c: out })
  return out
}
