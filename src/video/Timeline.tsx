import { useEffect, useRef, useState } from 'react'
import { useStore, clipEnd, projectDuration, newTrack } from '../core/store'
import type { Clip, Project, Track } from '../core/types'
import { getPeaks, getAudioBuffer, peekVideo } from '../core/media'
import { fmtTime } from '../ui/controls'
import { nanoid } from 'nanoid'

const HEAD = 150

function trackAccepts(t: Track, c: Clip) {
  if (t.kind === 'audio') return c.kind === 'audio'
  return c.kind !== 'audio'
}

export function splitAt(p: Project, ids: string[], t: number) {
  const targets = p.clips.filter((c) => (ids.length ? ids.includes(c.id) : true) && t > c.start + 0.02 && t < clipEnd(c) - 0.02)
  for (const c of targets) {
    const leftDur = t - c.start
    const right: Clip = JSON.parse(JSON.stringify(c))
    right.id = nanoid(8)
    right.start = t
    right.duration = c.duration - leftDur
    right.inPoint = c.inPoint + leftDur * c.speed
    right.transitionIn = { type: 'none', duration: 0.5 }
    right.animIn = 'none'
    right.fadeIn = 0
    c.duration = leftDur
    c.animOut = 'none'
    c.fadeOut = 0
    if (c.keyframes) {
      const kfR: Clip['keyframes'] = {}
      for (const [k, arr] of Object.entries(c.keyframes)) {
        kfR[k as keyof Clip['transform']] = arr!.filter((x) => x.t >= leftDur).map((x) => ({ ...x, t: x.t - leftDur }))
        c.keyframes[k as keyof Clip['transform']] = arr!.filter((x) => x.t < leftDur)
      }
      right.keyframes = kfR
    }
    p.clips.push(right)
  }
  return targets.length
}

function Waveform({ mediaId, inPoint, duration, speed, width, color }: { mediaId: string; inPoint: number; duration: number; speed: number; width: number; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => { void getAudioBuffer(mediaId).then(() => setReady(true)) }, [mediaId])
  useEffect(() => {
    const cv = ref.current
    if (!cv || !ready) return
    const w = Math.max(1, Math.min(4000, Math.round(width)))
    cv.width = w; cv.height = 40
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, w, 40)
    const peaks = getPeaks(mediaId, 4000)
    const total = useStore.getState().project.media.find((m) => m.id === mediaId)?.duration || 1
    if (!peaks) return
    ctx.fillStyle = color
    for (let x = 0; x < w; x++) {
      const st = inPoint + (x / w) * duration * speed
      const idx = Math.floor((st / total) * peaks.length)
      const v = peaks[Math.min(peaks.length - 1, Math.max(0, idx))] ?? 0
      const h = Math.max(1, v * 36)
      ctx.fillRect(x, 20 - h / 2, 1, h)
    }
  }, [ready, mediaId, inPoint, duration, speed, width, color])
  return <canvas ref={ref} />
}

function Thumbs({ clip, width }: { clip: Clip; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    const v = peekVideo(clip.id)
    if (!cv || !v || v.readyState < 2) return
    const w = Math.max(1, Math.min(3000, Math.round(width)))
    cv.width = w; cv.height = 46
    const ctx = cv.getContext('2d')!
    const tw = (v.videoWidth / v.videoHeight) * 46
    for (let x = 0; x < w; x += tw) ctx.drawImage(v, x, 0, tw, 46)
  }, [clip.id, width])
  return <canvas ref={ref} />
}

export function Timeline() {
  const project = useStore((s) => s.project)
  const playhead = useStore((s) => s.playhead)
  const selected = useStore((s) => s.selectedClipIds)
  const { update, select, setPlayhead, checkpoint, undo, redo } = useStore.getState()
  const [pps, setPps] = useState(60) // pixels per second
  const [snap, setSnap] = useState(true)
  const [dropTrack, setDropTrack] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dur = Math.max(30, projectDuration(project) + 20)

  const xToTime = (clientX: number) => {
    const el = scrollRef.current!
    const r = el.getBoundingClientRect()
    return Math.max(0, (clientX - r.left + el.scrollLeft) / pps)
  }

  const snapTime = (t: number, ignore: string[]) => {
    if (!snap) return t
    const pts = [0, useStore.getState().playhead]
    for (const c of useStore.getState().project.clips) if (!ignore.includes(c.id)) pts.push(c.start, clipEnd(c))
    const thr = 8 / pps
    for (const p of pts) if (Math.abs(p - t) < thr) return p
    return t
  }

  const onClipDown = (e: React.PointerEvent, c: Clip, mode: 'move' | 'l' | 'r') => {
    e.stopPropagation()
    const track = project.tracks.find((t) => t.id === c.trackId)
    if (track?.locked) return
    const ids = e.shiftKey ? Array.from(new Set([...selected, c.id])) : selected.includes(c.id) ? selected : [c.id]
    select(ids)
    const startX = e.clientX
    const orig = JSON.parse(JSON.stringify(useStore.getState().project.clips)) as Clip[]
    const media = project.media.find((m) => m.id === c.mediaId)
    let moved = false
    checkpoint()
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - startX) / pps
      if (!moved && Math.abs(ev.clientX - startX) < 3) return
      moved = true
      // track under pointer
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-track]') as HTMLElement | null
      const overTrack = el?.dataset.track
      update((p) => {
        for (const id of ids) {
          const o = orig.find((x) => x.id === id)!
          const cl = p.clips.find((x) => x.id === id)!
          if (mode === 'move') {
            let ns = Math.max(0, o.start + dt)
            if (id === c.id) {
              const s1 = snapTime(ns, ids), s2 = snapTime(ns + o.duration, ids) - o.duration
              ns = s1 !== ns ? s1 : s2
            } else ns = Math.max(0, o.start + (p.clips.find((x) => x.id === c.id)!.start - orig.find((x) => x.id === c.id)!.start))
            cl.start = Math.max(0, ns)
            if (ids.length === 1 && overTrack) {
              const tr = p.tracks.find((t) => t.id === overTrack)
              if (tr && !tr.locked && trackAccepts(tr, cl)) cl.trackId = tr.id
            }
          } else if (mode === 'l') {
            const maxIn = o.kind === 'video' || o.kind === 'audio' ? o.inPoint / o.speed : Infinity
            let d = Math.min(o.duration - 0.1, Math.max(-maxIn, dt))
            d = snapTime(o.start + d, ids) - o.start
            d = Math.min(o.duration - 0.1, Math.max(-Math.min(maxIn, o.start), d))
            cl.start = o.start + d
            cl.duration = o.duration - d
            if (o.kind === 'video' || o.kind === 'audio') cl.inPoint = o.inPoint + d * o.speed
          } else {
            const maxDur = (o.kind === 'video' || o.kind === 'audio') && media ? (media.duration - o.inPoint) / o.speed : Infinity
            let nd = Math.max(0.1, Math.min(maxDur, o.duration + dt))
            nd = Math.max(0.1, Math.min(maxDur, snapTime(o.start + nd, ids) - o.start))
            cl.duration = nd
          }
        }
      }, false)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!moved) useStore.setState((s) => ({ past: s.past.slice(0, -1) }))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onRulerDown = (e: React.PointerEvent) => {
    setPlayhead(xToTime(e.clientX))
    const move = (ev: PointerEvent) => setPlayhead(xToTime(ev.clientX))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const doSplit = () => {
    let n = 0
    update((p) => { n = splitAt(p, useStore.getState().selectedClipIds, useStore.getState().playhead) })
    if (!n) useStore.getState().notify('Move the playhead over a clip to split it')
  }
  const doDelete = (ripple = false) => update((p) => {
    const del = p.clips.filter((c) => selected.includes(c.id))
    p.clips = p.clips.filter((c) => !selected.includes(c.id))
    if (ripple) for (const d of del) for (const c of p.clips) if (c.trackId === d.trackId && c.start >= clipEnd(d) - 0.001) c.start -= d.duration
  })
  const doDuplicate = () => update((p) => {
    const newIds: string[] = []
    for (const c of p.clips.filter((x) => selected.includes(x.id))) {
      const d: Clip = JSON.parse(JSON.stringify(c)); d.id = nanoid(8); d.start = clipEnd(c)
      p.clips.push(d); newIds.push(d.id)
    }
    setTimeout(() => select(newIds))
  })
  const extractAudio = () => update((p) => {
    for (const c of p.clips.filter((x) => selected.includes(x.id) && x.kind === 'video')) {
      let tr = p.tracks.find((t) => t.kind === 'audio' && !p.clips.some((o) => o.trackId === t.id && o.start < clipEnd(c) && clipEnd(o) > c.start))
      if (!tr) { tr = newTrack('audio', p.tracks.filter((t) => t.kind === 'audio').length + 1); p.tracks.push(tr) }
      const a: Clip = JSON.parse(JSON.stringify(c)); a.id = nanoid(8); a.kind = 'audio'; a.trackId = tr.id; a.name = c.name + ' (audio)'
      p.clips.push(a)
      c.volume = 0
    }
  })

  // keyboard shortcuts for the video tab
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      const st = useStore.getState()
      if (st.tab !== 'video') return
      const k = e.key.toLowerCase()
      if (k === ' ') { e.preventDefault(); st.setPlaying(!st.playing) }
      else if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
      else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo() }
      else if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); doDuplicate() }
      else if ((e.ctrlKey || e.metaKey) && k === 'b') { e.preventDefault(); doSplit() }
      else if (k === 's' && !e.ctrlKey) doSplit()
      else if (k === 'delete' || k === 'backspace') doDelete(e.shiftKey)
      else if (k === 'arrowleft') st.setPlayhead(st.playhead - (e.shiftKey ? 1 : 1 / st.project.fps))
      else if (k === 'arrowright') st.setPlayhead(st.playhead + (e.shiftKey ? 1 : 1 / st.project.fps))
      else if (k === 'home') st.setPlayhead(0)
      else if (k === 'end') st.setPlayhead(projectDuration(st.project))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Auto-scroll to keep playhead visible while playing
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !useStore.getState().playing) return
    const x = playhead * pps
    if (x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 80
  }, [playhead, pps])

  const onDrop = (e: React.DragEvent, track: Track) => {
    e.preventDefault()
    setDropTrack(null)
    const id = e.dataTransfer.getData('application/x-media')
    const m = project.media.find((x) => x.id === id)
    if (m) useStore.getState().addClipFromMedia(m, snapTime(xToTime(e.clientX), []), track.id)
  }

  const step = pps > 120 ? 1 : pps > 40 ? 2 : pps > 15 ? 5 : 10
  const ticks = []
  for (let t = 0; t < dur; t += step) ticks.push(t)

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <button title="Undo (Ctrl+Z)" onClick={undo}>↶</button>
        <button title="Redo (Ctrl+Shift+Z)" onClick={redo}>↷</button>
        <button title="Split at playhead (S / Ctrl+B)" onClick={doSplit}>✂ Split</button>
        <button title="Delete (Del). Shift+Del = ripple delete" disabled={!selected.length} onClick={() => doDelete()}>🗑 Delete</button>
        <button disabled={!selected.length} onClick={() => doDelete(true)}>Ripple delete</button>
        <button title="Duplicate (Ctrl+D)" disabled={!selected.length} onClick={doDuplicate}>⧉ Duplicate</button>
        <button disabled={!selected.some((id) => project.clips.find((c) => c.id === id)?.kind === 'video')} onClick={extractAudio}>🎵 Extract audio</button>
        <span className="spacer" style={{ flex: 1 }} />
        <button onClick={() => update((p) => { p.tracks.splice(p.tracks.findIndex((t) => t.kind === 'video'), 0, newTrack('video', p.tracks.filter((t) => t.kind === 'video').length + 1)) })}>+ Video track</button>
        <button onClick={() => update((p) => { p.tracks.unshift(newTrack('text', p.tracks.filter((t) => t.kind === 'text').length + 1)) })}>+ Text track</button>
        <button onClick={() => update((p) => { p.tracks.push(newTrack('audio', p.tracks.filter((t) => t.kind === 'audio').length + 1)) })}>+ Audio track</button>
        <label className="check"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />Snap</label>
        <label className="check">Zoom <input type="range" min={5} max={300} value={pps} onChange={(e) => setPps(+e.target.value)} /></label>
        <span className="timecode">{fmtTime(playhead)}</span>
      </div>
      <div className="tl-body">
        <div className="tl-heads" style={{ width: HEAD }}>
          <div className="tl-heads-spacer" />
          <div style={{ transform: `translateY(${-(scrollRef.current?.scrollTop ?? 0)}px)` }} id="tl-heads-inner">
            {project.tracks.map((t, i) => (
              <div key={t.id} className={'tl-head ' + (t.kind === 'text' ? 'text' : '')}>
                <span className="name" title={t.name}>{t.kind === 'audio' ? '🎵' : t.kind === 'text' ? 'T' : '🎞'} {t.name}</span>
                {t.kind !== 'audio' && <button className="icon" title="Hide" onClick={() => update((p) => { p.tracks[i].hidden = !p.tracks[i].hidden })}>{t.hidden ? '🙈' : '👁'}</button>}
                <button className="icon" title="Mute" onClick={() => update((p) => { p.tracks[i].muted = !p.tracks[i].muted })}>{t.muted ? '🔇' : '🔊'}</button>
                <button className="icon" title="Lock" onClick={() => update((p) => { p.tracks[i].locked = !p.tracks[i].locked })}>{t.locked ? '🔒' : '🔓'}</button>
                <button className="icon" title="Delete track" onClick={() => update((p) => { p.clips = p.clips.filter((c) => c.trackId !== t.id); p.tracks.splice(i, 1) })}>✕</button>
              </div>
            ))}
          </div>
        </div>
        <div className="tl-scroll" ref={scrollRef} onScroll={(e) => {
          const inner = document.getElementById('tl-heads-inner')
          if (inner) inner.style.transform = `translateY(${-e.currentTarget.scrollTop}px)`
        }} onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('tl-track')) select([]) }}>
          <div style={{ width: dur * pps, position: 'relative', minHeight: '100%' }}>
            <div className="tl-ruler" onPointerDown={onRulerDown}>
              {ticks.map((t) => (
                <div key={t} style={{ position: 'absolute', left: t * pps, top: 0, bottom: 0, borderLeft: '1px solid #444', paddingLeft: 3, fontSize: 10, color: '#888' }}>{fmtTime(t).slice(0, -3)}</div>
              ))}
            </div>
            {project.tracks.map((t) => (
              <div key={t.id} data-track={t.id} className={'tl-track ' + (t.kind === 'text' ? 'text ' : '') + (dropTrack === t.id ? 'drop' : '')}
                onDragOver={(e) => { e.preventDefault(); setDropTrack(t.id) }} onDragLeave={() => setDropTrack(null)} onDrop={(e) => onDrop(e, t)}
                style={{ opacity: t.hidden ? 0.45 : 1 }}>
                {project.clips.filter((c) => c.trackId === t.id).map((c) => {
                  const w = c.duration * pps
                  return (
                    <div key={c.id} className={`clip ${c.kind} ${selected.includes(c.id) ? 'sel' : ''}`} style={{ left: c.start * pps, width: Math.max(4, w) }}
                      onPointerDown={(e) => onClipDown(e, c, 'move')}>
                      {c.kind === 'video' && <Thumbs clip={c} width={w} />}
                      {(c.kind === 'audio' || (c.kind === 'video' && t.kind === 'audio')) && c.mediaId && <Waveform mediaId={c.mediaId} inPoint={c.inPoint} duration={c.duration} speed={c.speed} width={w} color="#7dffbf" />}
                      {c.transitionIn.type !== 'none' && <div className="tr-badge" style={{ width: c.transitionIn.duration * pps }} />}
                      <span className="label">{c.kind === 'text' ? 'T ' + (c.text ?? '').split('\n')[0] : c.name}{c.speed !== 1 ? ` · ${c.speed}x` : ''}</span>
                      <div className="handle l" onPointerDown={(e) => onClipDown(e, c, 'l')} />
                      <div className="handle r" onPointerDown={(e) => onClipDown(e, c, 'r')} />
                    </div>
                  )
                })}
              </div>
            ))}
            <div className="playhead" style={{ left: playhead * pps }} />
          </div>
        </div>
      </div>
    </div>
  )
}
