import { useEffect, useRef, useState } from 'react'
import { useStore, makeClip, newTrack, projectDuration, clipEnd } from '../core/store'
import { getAudioBuffer, getAudioContext, getPeaks, importFile, pickFiles } from '../core/media'
import { BUILTIN_SOUNDS, renderBuiltin } from './builtin'
import { importFiles } from '../video/MediaBin'
import { fmtTime, Check } from '../ui/controls'
import type { MediaItem, Clip } from '../core/types'
import { VOICES, VOICE_LABELS, DEFAULT_FX } from './fx'
import { computeDucking } from './duck'
import { detectBeats } from './beats'
import { Slider, Select } from '../ui/controls'
import { startPlayback, stopPlayback } from './engine'

function addAudioClip(m: MediaItem, start: number, inPoint: number, dur: number, opts: { fadeOut?: number; fadeIn?: number; volume?: number } = {}) {
  const st = useStore.getState()
  let id = ''
  st.update((p) => {
    let tr = p.tracks.find((t) => t.kind === 'audio' && !p.clips.some((c) => c.trackId === t.id && c.start < start + dur && clipEnd(c) > start))
    if (!tr) { tr = newTrack('audio', p.tracks.filter((t) => t.kind === 'audio').length + 1); p.tracks.push(tr) }
    const c = makeClip('audio', tr.id, start, dur, { mediaId: m.id, name: m.name, inPoint, fadeIn: opts.fadeIn ?? 0, fadeOut: opts.fadeOut ?? 0, volume: opts.volume ?? 1 })
    id = c.id
    p.clips.push(c)
  })
  st.select([id])
  st.notify(`Added "${m.name}" to the timeline at ${fmtTime(start)}`)
}

function Wave({ m, sel, setSel, pos }: { m: MediaItem; sel: [number, number] | null; setSel: (s: [number, number] | null) => void; pos: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(false); void getAudioBuffer(m.id).then(() => setReady(true)) }, [m.id])
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const w = cv.clientWidth * devicePixelRatio, h = 140 * devicePixelRatio
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, w, h)
    if (sel) { ctx.fillStyle = '#8b5cf633'; ctx.fillRect((sel[0] / m.duration) * w, 0, ((sel[1] - sel[0]) / m.duration) * w, h) }
    const peaks = ready ? getPeaks(m.id, 4000) : null
    ctx.fillStyle = '#7dffbf'
    if (peaks) for (let x = 0; x < w; x++) {
      const v = peaks[Math.floor((x / w) * peaks.length)] ?? 0
      const bh = Math.max(1, v * h * 0.9)
      ctx.fillRect(x, h / 2 - bh / 2, 1, bh)
    }
    else { ctx.fillStyle = '#888'; ctx.font = `${14 * devicePixelRatio}px sans-serif`; ctx.fillText('Decoding…', 10, h / 2) }
    ctx.fillStyle = '#8b5cf6'
    ctx.fillRect((pos / Math.max(0.001, m.duration)) * w, 0, 2 * devicePixelRatio, h)
  }, [ready, m, sel, pos])
  const toT = (e: { clientX: number }) => { const r = ref.current!.getBoundingClientRect(); return Math.max(0, Math.min(m.duration, ((e.clientX - r.left) / r.width) * m.duration)) }
  return <canvas ref={ref} className="wave" onPointerDown={(e) => {
    const a = toT(e)
    setSel(null)
    const move = (ev: PointerEvent) => { const b = toT(ev); if (Math.abs(b - a) > 0.05) setSel([Math.min(a, b), Math.max(a, b)]) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }} />
}

export function AudioTab() {
  const media = useStore((s) => s.project.media)
  const project = useStore((s) => s.project)
  const playhead = useStore((s) => s.playhead)
  const update = useStore((s) => s.update)
  const items = media.filter((m) => m.kind === 'audio' || (m.kind === 'video' && m.hasAudio))
  const [curId, setCurId] = useState<string | null>(null)
  const cur = items.find((m) => m.id === curId) ?? items[0]
  const [sel, setSel] = useState<[number, number] | null>(null)
  const [pos, setPos] = useState(0)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const srcRef = useRef<AudioBufferSourceNode | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [rec, setRec] = useState<MediaRecorder | null>(null)
  const [recStart, setRecStart] = useState(0)
  const [now, setNow] = useState(0)
  const [fitFade, setFitFade] = useState(true)

  useEffect(() => { setSel(null); setPos(0) }, [cur?.id])
  useEffect(() => () => { try { srcRef.current?.stop() } catch { /* */ } }, [])
  useEffect(() => { if (!rec) return; const i = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(i) }, [rec])

  const stop = () => { try { srcRef.current?.stop() } catch { /* */ } srcRef.current = null; setPlayingId(null) }
  const play = async (m: MediaItem, from = 0, to?: number) => {
    stop()
    const buf = await getAudioBuffer(m.id)
    if (!buf) return useStore.getState().notify('Could not decode audio')
    const ctx = getAudioContext(); await ctx.resume()
    const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination)
    s.start(0, from, to !== undefined ? to - from : undefined)
    const t0 = ctx.currentTime
    srcRef.current = s; setPlayingId(m.id)
    s.onended = () => { if (srcRef.current === s) { srcRef.current = null; setPlayingId(null) } }
    const tick = () => { if (srcRef.current !== s) return; setPos(from + ctx.currentTime - t0); requestAnimationFrame(tick) }
    tick()
  }

  const addBuiltin = async (i: number) => {
    const def = BUILTIN_SOUNDS[i]
    const existing = media.find((m) => m.builtIn && m.name === def.name)
    if (existing) { setCurId(existing.id); return existing }
    setBusy(def.name)
    const blob = await renderBuiltin(def)
    const m = await importFile(new File([blob], def.name + '.wav', { type: 'audio/wav' }), def.name, true)
    setBusy(null)
    if (m) { useStore.getState().addMedia(m); setCurId(m.id) }
    return m
  }

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const r = new MediaRecorder(stream)
      const chunks: Blob[] = []
      r.ondataavailable = (e) => chunks.push(e.data)
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' })
        const name = `Voiceover ${new Date().toLocaleTimeString()}`
        const m = await importFile(new File([blob], name + '.webm', { type: 'audio/webm' }), name)
        if (m) { useStore.getState().addMedia(m); setCurId(m.id); addAudioClip(m, recAt.current, 0, m.duration) }
        setRec(null)
      }
      recAt.current = useStore.getState().playhead
      r.start()
      setRec(r); setRecStart(Date.now())
    } catch {
      useStore.getState().notify('Microphone access was blocked')
    }
  }
  const recAt = useRef(0)

  const audioTracks = project.tracks.filter((t) => t.kind === 'audio')
  return (
    <div className="audio-tab">
      <div className="panel audio-list">
        <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void importFiles(Array.from(e.dataTransfer.files)) }}>
          <button className="primary" onClick={async () => importFiles(await pickFiles('audio/*,video/*'))}>＋ Import music / audio</button>
          <div className="hint" style={{ marginTop: 6 }}>MP3, WAV, M4A, OGG, FLAC. Drop files here.</div>
        </div>
        <div className="panel-title">Your audio ({items.length})</div>
        {items.map((m) => (
          <div key={m.id} className={'audio-item ' + (cur?.id === m.id ? 'on' : '')} onClick={() => setCurId(m.id)}>
            <button className="icon" onClick={(e) => { e.stopPropagation(); if (playingId === m.id) stop(); else void play(m) }}>{playingId === m.id ? '⏹' : '▶'}</button>
            <span className="aname" title={m.name}>{m.kind === 'video' ? '🎞 ' : m.builtIn ? '✨ ' : ''}{m.name}</span>
            <span className="muted small">{fmtTime(m.duration).slice(0, -3)}</span>
            <button title="Add to timeline at playhead" onClick={(e) => { e.stopPropagation(); addAudioClip(m, playhead, 0, m.duration) }}>＋</button>
          </div>
        ))}
        {(['Effects', 'Music loops'] as const).map((cat) => (
          <div key={cat}>
            <div className="panel-title">Built-in {cat.toLowerCase()} (royalty-free)</div>
            {BUILTIN_SOUNDS.map((s, i) => s.category !== cat ? null : (
              <div key={s.name} className="audio-item">
                <button className="icon" disabled={!!busy} onClick={async () => { const m = await addBuiltin(i); if (m) void play(m) }}>▶</button>
                <span className="aname">{busy === s.name ? 'Generating…' : s.name}</span>
                <span className="muted small">{s.duration}s</span>
                <button disabled={!!busy} onClick={async () => { const m = await addBuiltin(i); if (m) addAudioClip(m, useStore.getState().playhead, 0, m.duration) }}>＋</button>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="audio-main">
        <div className="card">
          <h3>🎙 Voiceover</h3>
          <div className="row">
            {!rec ? <button className="primary" onClick={startRec}>● Record at playhead ({fmtTime(playhead)})</button>
              : <><span className="rec-dot" /> Recording {fmtTime((now - recStart) / 1000)} <button onClick={() => rec.stop()}>■ Stop & add to timeline</button></>}
          </div>
          <div className="hint">Records from your microphone and drops the take onto a free audio track at the playhead.</div>
        </div>
        {cur ? <div className="card">
          <h3>{cur.name}</h3>
          <Wave m={cur} sel={sel} setSel={setSel} pos={pos} />
          <div className="row">
            <button onClick={() => (playingId ? stop() : void play(cur, sel?.[0] ?? 0, sel?.[1]))}>{playingId ? '⏹ Stop' : sel ? '▶ Play selection' : '▶ Play'}</button>
            <span className="timecode">{fmtTime(pos)}</span>
            {sel && <span className="muted">Selection {fmtTime(sel[0])} → {fmtTime(sel[1])} ({(sel[1] - sel[0]).toFixed(2)}s)</span>}
          </div>
          <div className="hint">Drag across the waveform to pick just part of the track.</div>
          <div className="row">
            <button className="primary" onClick={() => addAudioClip(cur, playhead, sel?.[0] ?? 0, sel ? sel[1] - sel[0] : cur.duration)}>＋ Add {sel ? 'selection' : 'track'} at playhead</button>
            <button onClick={() => addAudioClip(cur, 0, sel?.[0] ?? 0, sel ? sel[1] - sel[0] : cur.duration)}>Add at start</button>
            <button onClick={() => {
              const len = projectDuration(project)
              if (len <= 0) return useStore.getState().notify('Add some video first. The music is fitted to the video length.')
              const from = sel?.[0] ?? 0
              const avail = cur.duration - from
              if (avail >= len) addAudioClip(cur, 0, from, len, { fadeOut: fitFade ? Math.min(2, len / 4) : 0, fadeIn: fitFade ? 0.5 : 0 })
              else for (let t = 0; t < len; t += avail) addAudioClip(cur, t, from, Math.min(avail, len - t), { fadeOut: fitFade && t + avail >= len ? Math.min(2, len / 4) : 0 })
            }}>🎯 Fit to video length</button>
            <Check label="Auto fade" value={fitFade} onChange={setFitFade} />
            <button onClick={() => {
              const len = projectDuration(project)
              update((p) => {
                // duck: lower other audio clips under selected/voice? → set background music at 30%
                p.clips.filter((c) => c.mediaId === cur.id && c.kind === 'audio').forEach((c) => { c.volume = 0.3 })
              })
              useStore.getState().notify(len ? 'Set this track to 30% volume as background music' : 'Done')
            }}>🔉 Make background (30%)</button>
          </div>
        </div> : <div className="card"><h3>No audio yet</h3><div className="hint">Import a song, record a voiceover, or click ▶ on a built-in sound.</div></div>}
        <ClipEffects />
        <DuckingCard />
        {cur && <BeatsCard m={cur} />}
        <div className="card">
          <h3>🎚 Mixer</h3>
          <div className="mixer">
            {audioTracks.map((t) => {
              const i = project.tracks.indexOf(t)
              return (
                <div key={t.id} className="strip">
                  <b>{t.name}</b>
                  <input type="range" min={0} max={2} step={0.01} value={t.volume} onPointerDown={useStore.getState().checkpoint}
                    onChange={(e) => update((p) => { p.tracks[i].volume = +e.target.value }, false)} />
                  <span>{Math.round(t.volume * 100)}%</span>
                  <button className={t.muted ? 'active' : ''} onClick={() => update((p) => { p.tracks[i].muted = !p.tracks[i].muted })}>{t.muted ? 'Muted' : 'Mute'}</button>
                  <span className="muted small">{project.clips.filter((c) => c.trackId === t.id).length} clips</span>
                </div>
              )
            })}
            {project.tracks.filter((t) => t.kind === 'video').map((t) => {
              const i = project.tracks.indexOf(t)
              return (
                <div key={t.id} className="strip">
                  <b>🎞 {t.name}</b>
                  <input type="range" min={0} max={2} step={0.01} value={t.volume} onChange={(e) => update((p) => { p.tracks[i].volume = +e.target.value }, false)} />
                  <span>{Math.round(t.volume * 100)}%</span>
                  <button className={t.muted ? 'active' : ''} onClick={() => update((p) => { p.tracks[i].muted = !p.tracks[i].muted })}>{t.muted ? 'Muted' : 'Mute'}</button>
                </div>
              )
            })}
          </div>
          <div className="hint">Per-clip volume, fades and speed are in the Video tab's inspector when you select an audio clip.</div>
        </div>
      </div>
    </div>
  )
}

/** Per-clip voice effects / clean-up for clips already on the timeline. */
export function FxControls({ c }: { c: Clip }) {
  const { update, checkpoint } = useStore.getState()
  const fx = c.audioFx ?? DEFAULT_FX()
  const set = (fn: (f: NonNullable<Clip['audioFx']>) => void, undo = false) => update((p) => { const x = p.clips.find((y) => y.id === c.id); if (!x) return; x.audioFx = x.audioFx ?? DEFAULT_FX(); fn(x.audioFx) }, undo)
  return <>
    <Select label="Voice effect" value={fx.voice} options={VOICES.map((v) => ({ value: v, label: VOICE_LABELS[v] }))} onChange={(v) => set((f) => { f.voice = v }, true)} />
    <Slider label="Noise reduce" min={0} max={1} value={fx.denoise} onCommit={checkpoint} onChange={(v) => set((f) => { f.denoise = v })} />
    <Slider label="Bass dB" min={-15} max={15} step={0.5} value={fx.bass} onCommit={checkpoint} onChange={(v) => set((f) => { f.bass = v })} />
    <Slider label="Treble dB" min={-15} max={15} step={0.5} value={fx.treble} onCommit={checkpoint} onChange={(v) => set((f) => { f.treble = v })} />
    <div className="row">
      <button onClick={async () => {
        const buf = await getAudioBuffer(c.mediaId!)
        if (!buf) return
        const d = buf.getChannelData(0), sr = buf.sampleRate
        let peak = 0
        for (let i = Math.floor(c.inPoint * sr); i < Math.min(d.length, (c.inPoint + c.duration * c.speed) * sr); i += 2) peak = Math.max(peak, Math.abs(d[i]))
        if (peak > 0) update((p) => { const x = p.clips.find((y) => y.id === c.id); if (x) x.volume = Math.min(4, Math.round((0.89 / peak) * 100) / 100) })
        useStore.getState().notify(`Volume set to ${Math.round((0.89 / Math.max(peak, 1e-3)) * 100)}% (peak −1 dB)`)
      }}>📈 Normalize loudness</button>
      {(c.volumeKeys?.length ?? 0) > 0 && <button onClick={() => update((p) => { const x = p.clips.find((y) => y.id === c.id); if (x) x.volumeKeys = [] })}>Remove ducking</button>}
    </div>
  </>
}

function ClipEffects() {
  const project = useStore((s) => s.project)
  const [id, setId] = useState<string>('')
  const clips = project.clips.filter((c) => c.kind === 'audio' || (c.kind === 'video' && project.media.find((m) => m.id === c.mediaId)?.hasAudio))
  const c = clips.find((x) => x.id === id) ?? clips[0]
  const [previewing, setPreviewing] = useState(false)
  if (!clips.length) return <div className="card"><h3>🎛 Voice effects & clean-up</h3><div className="hint">Add audio to the timeline first, then pick effects here.</div></div>
  return (
    <div className="card">
      <h3>🎛 Voice effects & clean-up</h3>
      <Select label="Clip" value={c.id} options={clips.map((x) => ({ value: x.id, label: `${x.name} @ ${fmtTime(x.start)}` }))} onChange={setId} />
      <FxControls c={c} />
      <div className="row">
        <button className="primary" onClick={async () => {
          if (previewing) { stopPlayback(); setPreviewing(false); return }
          const solo = { ...project, clips: [c], tracks: project.tracks.map((t) => ({ ...t, muted: false })) }
          await startPlayback(solo, c.start)
          setPreviewing(true)
          setTimeout(() => { stopPlayback(); setPreviewing(false) }, Math.min(15, c.duration) * 1000)
        }}>{previewing ? '⏹ Stop' : '▶ Preview this clip'}</button>
        <span className="hint">Effects apply in playback and exports.</span>
      </div>
    </div>
  )
}

function DuckingCard() {
  const project = useStore((s) => s.project)
  const audioTracks = project.tracks.filter((t) => t.kind === 'audio')
  const [track, setTrack] = useState('')
  const [amount, setAmount] = useState(0.7)
  const [busy, setBusy] = useState(false)
  const tId = audioTracks.find((t) => t.id === track)?.id ?? audioTracks[0]?.id
  return (
    <div className="card">
      <h3>🔉 Auto-ducking</h3>
      <div className="hint">Automatically lowers your music whenever someone is talking (voiceover or video sound), then brings it back up.</div>
      {audioTracks.length ? <>
        <Select label="Music track" value={tId ?? ''} options={audioTracks.map((t) => ({ value: t.id, label: `${t.name} (${project.clips.filter((c) => c.trackId === t.id).length} clips)` }))} onChange={setTrack} />
        <Slider label="Duck by" min={0.1} max={0.95} value={amount} onChange={setAmount} />
        <div className="row">
          <button className="primary" disabled={busy || !tId} onClick={async () => {
            setBusy(true)
            const { result, voiceCount } = await computeDucking(project, tId!, amount)
            setBusy(false)
            if (!voiceCount) return useStore.getState().notify('No voice found on other tracks. Record a voiceover or add a video with sound.')
            useStore.getState().update((p) => { for (const c of p.clips) if (result.has(c.id)) c.volumeKeys = result.get(c.id) })
            useStore.getState().notify('Ducking applied to the music track')
          }}>{busy ? 'Analysing…' : 'Apply ducking'}</button>
          <button onClick={() => useStore.getState().update((p) => { for (const c of p.clips) if (c.trackId === tId) c.volumeKeys = [] })}>Remove</button>
        </div>
      </> : <div className="hint">Add music to an audio track first.</div>}
    </div>
  )
}

function BeatsCard({ m }: { m: MediaItem }) {
  const [info, setInfo] = useState<string | null>(null)
  return (
    <div className="card">
      <h3>🥁 Beat detection: {m.name}</h3>
      <div className="row">
        <button onClick={async () => {
          const buf = await getAudioBuffer(m.id)
          if (!buf) return
          const beats = detectBeats(buf)
          const gaps = beats.slice(1).map((b, i) => b - beats[i]).filter((g) => g > 0.25 && g < 1.5).sort((a, b) => a - b)
          let bpm = gaps.length ? 60 / gaps[Math.floor(gaps.length / 2)] : 0
          while (bpm > 150) bpm /= 2
          while (bpm && bpm < 70) bpm *= 2
          bpm = Math.round(bpm)
          const clip = useStore.getState().project.clips.find((c) => c.mediaId === m.id)
          const offset = clip ? clip.start - clip.inPoint : useStore.getState().playhead
          useStore.getState().update((p) => { p.markers = Array.from(new Set([...(p.markers ?? []), ...beats.map((b) => Math.round((b + offset) * 1000) / 1000)])).filter((t) => t >= 0).sort((a, b) => a - b) })
          setInfo(`${beats.length} beats${bpm ? ` · about ${bpm} BPM` : ''}. Markers added to the timeline${clip ? ' (aligned to this clip)' : ' at the playhead'}.`)
        }}>Detect beats → timeline markers</button>
      </div>
      {info && <div className="small">{info}</div>}
      <div className="hint">In the Video tab, select a clip and press "✂ Cut to beats" to cut it on every beat.</div>
    </div>
  )
}
