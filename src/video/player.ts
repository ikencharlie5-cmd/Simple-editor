import { useEffect, useRef } from 'react'
import { useStore, projectDuration, clipEnd } from '../core/store'
import { getVideo, peekVideo, seekVideo, getAudioContext } from '../core/media'
import { renderFrame, videoClipTime, instantSpeed } from './render'
import { startPlayback, stopPlayback } from '../audio/engine'
import type { Project } from '../core/types'

/** Ensure video elements exist for all video clips (lazy). */
export async function ensureVideos(p: Project) {
  await Promise.all(p.clips.filter((c) => c.kind === 'video' && c.mediaId).map((c) => getVideo(c.id, c.mediaId!)))
}

/** Hook that drives playback + draws into the given canvas. */
export function usePreview(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const project = useStore((s) => s.project)
  const playhead = useStore((s) => s.playhead)
  const playing = useStore((s) => s.playing)
  const raf = useRef(0)

  // Draw whenever paused state changes / playhead moves while paused
  useEffect(() => {
    if (playing) return
    let cancelled = false
    const draw = async () => {
      await ensureVideos(project)
      const seeks: Promise<void>[] = []
      for (const c of project.clips) {
        if (c.kind !== 'video') continue
        const v = peekVideo(c.id)
        if (!v) continue
        if (!v.paused) v.pause()
        if (playhead >= c.start - 0.5 && playhead < clipEnd(c)) seeks.push(seekVideo(v, videoClipTime(c, playhead)))
      }
      await Promise.all(seeks)
      if (cancelled) return
      const cv = canvasRef.current
      if (!cv) return
      const ctx = cv.getContext('2d')!
      renderFrame(ctx, project, playhead)
    }
    void draw()
    // redraw shortly after for late-loading images
    const t = setTimeout(() => { if (!cancelled) void draw() }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [project, playhead, playing, canvasRef])

  // Playback loop
  useEffect(() => {
    if (!playing) return
    let alive = true
    const p = useStore.getState().project
    const from = useStore.getState().playhead
    const end = projectDuration(p)
    if (from >= end - 0.01) useStore.getState().setPlayhead(0)
    const start = useStore.getState().playhead
    let when = 0
    void (async () => {
      await ensureVideos(p)
      when = await startPlayback(p, start)
      if (!alive) return
      const ctx = getAudioContext()
      const tick = () => {
        if (!alive) return
        const t = start + Math.max(0, ctx.currentTime - when)
        const proj = useStore.getState().project
        if (t >= projectDuration(proj)) {
          useStore.setState({ playing: false, playhead: projectDuration(proj) })
          return
        }
        for (const c of proj.clips) {
          if (c.kind !== 'video') continue
          const v = peekVideo(c.id)
          if (!v) continue
          const active = t >= c.start && t < clipEnd(c)
          if (active) {
            const target = videoClipTime(c, t)
            if (c.reverse) {
              // browsers can't play backwards: step by seeking
              if (!v.paused) v.pause()
              if (!v.seeking && Math.abs(v.currentTime - target) > 1 / 40) v.currentTime = target
            } else {
              const rate = Math.min(16, Math.max(0.0625, c.speedCurve && c.speedCurve !== 'none' ? instantSpeed(c, t - c.start) : c.speed))
              if (Math.abs(v.playbackRate - rate) > 0.02) v.playbackRate = rate
              if (v.paused) { v.currentTime = target; void v.play().catch(() => {}) }
              else if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target
            }
          } else if (!v.paused) v.pause()
          else if (t < c.start && c.start - t < 1 && Math.abs(v.currentTime - c.inPoint) > 0.05) v.currentTime = c.inPoint
        }
        const cv = canvasRef.current
        if (cv) renderFrame(cv.getContext('2d')!, proj, t)
        useStore.setState({ playhead: t })
        raf.current = requestAnimationFrame(tick)
      }
      raf.current = requestAnimationFrame(tick)
    })()
    return () => {
      alive = false
      cancelAnimationFrame(raf.current)
      stopPlayback()
      for (const c of useStore.getState().project.clips) peekVideo(c.id)?.pause()
    }
  }, [playing, canvasRef])
}
