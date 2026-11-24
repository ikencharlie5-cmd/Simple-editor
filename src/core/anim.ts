import type { Ease, Keyframe } from './types'

export const EASES: Ease[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'bounce', 'elastic', 'back', 'hold']

export function ease(e: Ease, t: number): number {
  t = Math.min(1, Math.max(0, t))
  switch (e) {
    case 'linear': return t
    case 'easeIn': return t * t * t
    case 'easeOut': return 1 - Math.pow(1 - t, 3)
    case 'easeInOut': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    case 'back': { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2) }
    case 'elastic': return t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
    case 'bounce': {
      const n1 = 7.5625, d1 = 2.75
      if (t < 1 / d1) return n1 * t * t
      if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
      if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
      return n1 * (t -= 2.625 / d1) * t + 0.984375
    }
    case 'hold': return t < 1 ? 0 : 1
  }
}

/** Interpolate a keyframe track at time t. Ease of the *destination* key controls the segment. */
export function sampleKeys(keys: Keyframe[] | undefined, t: number, fallback: number): number {
  if (!keys || keys.length === 0) return fallback
  if (t <= keys[0].t) return keys[0].value
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.value
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1]
    if (t >= a.t && t <= b.t) {
      const k = ease(b.ease, (t - a.t) / Math.max(1e-6, b.t - a.t))
      return a.value + (b.value - a.value) * k
    }
  }
  return fallback
}

export function setKey(keys: Keyframe[] | undefined, t: number, value: number, e: Ease = 'easeInOut'): Keyframe[] {
  const out = (keys ?? []).filter((k) => Math.abs(k.t - t) > 1e-3)
  out.push({ t, value, ease: e })
  return out.sort((a, b) => a.t - b.t)
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Preset motion for clips & animator layers. Returns additive/multiplicative modifiers. */
export interface Motion { dx: number; dy: number; scale: number; rotation: number; opacity: number; reveal: number; blur: number }
export const identityMotion = (): Motion => ({ dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1, reveal: 1, blur: 0 })

/** p = progress 0..1 of the in-animation (1 = done). dir: 'in' or 'out' (out uses reversed progress). */
export function presetMotion(name: string, p: number, w: number, h: number, m: Motion) {
  const q = 1 - p // amount remaining
  switch (name) {
    case 'fade': m.opacity *= p; break
    case 'pop': { const s = ease('back', p); m.scale *= Math.max(0, s); m.opacity *= Math.min(1, p * 3); break }
    case 'zoom': m.scale *= lerp(0.3, 1, ease('easeOut', p)); m.opacity *= p; break
    case 'slide-left': m.dx += w * ease('easeIn', q) * 0.6; m.opacity *= Math.min(1, p * 2); break
    case 'slide-right': m.dx -= w * ease('easeIn', q) * 0.6; m.opacity *= Math.min(1, p * 2); break
    case 'slide-up': m.dy += h * ease('easeIn', q) * 0.6; m.opacity *= Math.min(1, p * 2); break
    case 'slide-down': m.dy -= h * ease('easeIn', q) * 0.6; m.opacity *= Math.min(1, p * 2); break
    case 'spin': m.rotation += -360 * ease('easeIn', q); m.scale *= lerp(0, 1, ease('easeOut', p)); break
    case 'bounce': m.dy -= h * 0.5 * (1 - ease('bounce', p)); break
    case 'typewriter': m.reveal *= p; break
    case 'blur': m.blur += 30 * q; m.opacity *= p; break
    case 'drop': m.dy -= h * 0.6 * (1 - ease('elastic', p)); break
  }
}

/** Looping motion; t in seconds. */
export function loopMotion(name: string, t: number, m: Motion) {
  switch (name) {
    case 'shake': m.dx += Math.sin(t * 60) * 6; m.dy += Math.cos(t * 47) * 4; break
    case 'pulse': m.scale *= 1 + Math.sin(t * Math.PI * 2) * 0.06; break
    case 'wiggle': m.rotation += Math.sin(t * Math.PI * 4) * 6; break
    case 'float': m.dy += Math.sin(t * Math.PI) * 14; break
    case 'spin': m.rotation += t * 180; break
    case 'flicker': m.opacity *= 0.6 + 0.4 * (Math.sin(t * 37) * Math.sin(t * 11) > -0.3 ? 1 : 0); break
    case 'swing': m.rotation += Math.sin(t * Math.PI * 1.5) * 15; break
  }
}

export const IN_PRESETS = ['none', 'fade', 'pop', 'zoom', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'spin', 'bounce', 'typewriter', 'blur', 'drop']
export const LOOP_PRESETS = ['none', 'shake', 'pulse', 'wiggle', 'float', 'spin', 'flicker', 'swing']
