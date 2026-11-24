// Copies MediaPipe's WebAssembly runtime into public/ so the app can run segmentation offline.
import { cpSync, mkdirSync } from 'node:fs'
mkdirSync('public/mediapipe', { recursive: true })
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) cpSync(`node_modules/@mediapipe/tasks-vision/wasm/${f}`, `public/mediapipe/${f}`)
