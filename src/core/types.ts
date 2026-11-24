export type MediaKind = 'video' | 'image' | 'audio' | 'animation'

export interface MediaItem {
  id: string
  name: string
  kind: MediaKind
  duration: number // seconds (images: 0 = still)
  width: number
  height: number
  hasAudio?: boolean
  animationId?: string // for kind === 'animation'
  builtIn?: boolean
}

export type TrackKind = 'video' | 'audio' | 'text'

export interface Track {
  id: string
  kind: TrackKind
  name: string
  muted: boolean
  hidden: boolean
  locked: boolean
  volume: number
}

export interface Transform {
  x: number // offset from center in project px
  y: number
  scale: number
  rotation: number // degrees
  opacity: number // 0..1
}

export interface Filters {
  brightness: number // 1 = normal
  contrast: number
  saturation: number
  hue: number // degrees
  blur: number // px
  grayscale: number // 0..1
  sepia: number
  invert: number
  temperature: number // -1..1
  vignette: number // 0..1
}

export type TransitionType = 'none' | 'fade' | 'dissolve' | 'slide-left' | 'slide-right' | 'slide-up' | 'zoom-in' | 'zoom-out' | 'wipe' | 'spin' | 'blur'
export type ClipAnim = 'none' | 'fade' | 'pop' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'zoom' | 'spin' | 'bounce' | 'typewriter' | 'shake' | 'pulse' | 'wiggle'

export interface TextStyle {
  font: string
  size: number
  color: string
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right'
  stroke: string
  strokeWidth: number
  background: string // '' = none
  shadow: boolean
}

export type ClipKind = 'video' | 'image' | 'audio' | 'text' | 'animation' | 'color'

export interface Keyframe {
  t: number // seconds relative to clip start
  value: number
  ease: Ease
}
export type Ease = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'bounce' | 'elastic' | 'back' | 'hold'

export interface AudioFx { voice: string; denoise: number; bass: number; treble: number }

export interface Clip {
  id: string
  trackId: string
  kind: ClipKind
  mediaId?: string
  name: string
  start: number // timeline seconds
  duration: number // timeline seconds (after speed)
  inPoint: number // source seconds
  speed: number
  volume: number
  fadeIn: number
  fadeOut: number
  transform: Transform
  filters: Filters
  filterPreset: string
  text?: string
  textStyle?: TextStyle
  color?: string // for color clips
  transitionIn: { type: TransitionType; duration: number }
  animIn: ClipAnim
  animOut: ClipAnim
  animLoop: ClipAnim
  chromaKey?: { enabled: boolean; color: string; tolerance: number }
  keyframes?: Partial<Record<keyof Transform, Keyframe[]>>
  fit: 'contain' | 'cover' | 'stretch'
  flipH?: boolean
  flipV?: boolean
  reverse?: boolean
  speedCurve?: string
  removeBg?: boolean
  audioFx?: AudioFx
  /** volume automation (e.g. auto-ducking): times relative to clip start, v multiplies volume */
  volumeKeys?: { t: number; v: number }[]
  removeBgSoftness?: number
}

export interface Project {
  id: string
  name: string
  width: number
  height: number
  fps: number
  background: string
  tracks: Track[]
  clips: Clip[]
  media: MediaItem[]
  animations: AnimationDoc[]
  updatedAt: number
  /** beat / cue markers on the timeline, in seconds */
  markers?: number[]
}

/* ---------------- Animator ---------------- */

export type AnimProp = 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity' | 'reveal' | 'blur' | 'hue' | 'path'
export const ANIM_PROPS: AnimProp[] = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation', 'opacity', 'reveal', 'blur', 'hue', 'path']

export type AnimLayerKind = 'shape' | 'text' | 'image' | 'drawing'
export type ShapeType = 'rect' | 'ellipse' | 'triangle' | 'star' | 'heart' | 'polygon' | 'line' | 'arrow'

export interface DrawingFrame {
  id: string
  dataUrl: string // '' = empty frame
  hold: number // how many animation frames this drawing frame lasts
}

export interface AnimLayer {
  id: string
  name: string
  kind: AnimLayerKind
  visible: boolean
  locked: boolean
  start: number
  end: number
  base: Record<AnimProp, number>
  keys: Partial<Record<AnimProp, Keyframe[]>>
  // shape
  shape?: ShapeType
  w?: number
  h?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  sides?: number
  radius?: number
  // text
  text?: string
  font?: string
  fontSize?: number
  bold?: boolean
  // image
  mediaId?: string
  // drawing (frame-by-frame)
  frames?: DrawingFrame[]
  effect?: 'none' | 'glitch' | 'glow' | 'shadow'
  presetIn?: string
  presetOut?: string
  presetLoop?: string
  /** attach to another layer: follows its movement, rotation and scale */
  parentId?: string
  /** motion path in animation pixels; position follows it by the 'path' property (0..1) */
  path?: { pts: { x: number; y: number }[]; orient: boolean }
}

export interface AnimationDoc {
  id: string
  name: string
  width: number
  height: number
  fps: number
  duration: number
  background: string // '' = transparent
  layers: AnimLayer[]
  onionSkin: boolean
  /** a video shown underneath the animation for reference / rotoscoping */
  audio?: { mediaId: string; offset: number; volume: number }
  refVideo?: { mediaId: string; offset: number; opacity: number; fit: 'contain' | 'cover'; include: boolean }
}

export const DEFAULT_FILTERS: Filters = {
  brightness: 1, contrast: 1, saturation: 1, hue: 0, blur: 0, grayscale: 0, sepia: 0, invert: 0, temperature: 0, vignette: 0,
}
export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }
export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: 'Inter, system-ui, sans-serif', size: 72, color: '#ffffff', bold: true, italic: false, align: 'center',
  stroke: '#000000', strokeWidth: 4, background: '', shadow: true,
}
