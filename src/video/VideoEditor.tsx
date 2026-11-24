import { useRef, useState } from 'react'
import { useStore, makeClip, projectDuration, newTrack, clipEnd } from '../core/store'
import type { Clip, ClipAnim, Project, Transform, TransitionType } from '../core/types'
import { DEFAULT_FILTERS, DEFAULT_TEXT_STYLE } from '../core/types'
import { MediaBin } from './MediaBin'
import { Timeline } from './Timeline'
import { usePreview } from './player'
import { FILTER_PRESETS, clipTransformAt, renderFrame } from './render'
import { Check, Color, Section, Select, Slider, fmtTime } from '../ui/controls'
import { IN_PRESETS, LOOP_PRESETS, setKey, EASES } from '../core/anim'
import type { Ease } from '../core/types'

const TEXT_TEMPLATES: { name: string; text: string; style: Partial<typeof DEFAULT_TEXT_STYLE>; anim?: ClipAnim }[] = [
  { name: 'Title', text: 'Big Title', style: { size: 120, bold: true } , anim: 'pop' },
  { name: 'Subtitle', text: 'Subtitle text', style: { size: 54, bold: false, strokeWidth: 3 } },
  { name: 'Caption box', text: 'Caption', style: { size: 56, background: '#000000aa', strokeWidth: 0, shadow: false } },
  { name: 'Neon', text: 'NEON', style: { size: 110, color: '#39ff14', stroke: '#0b3d00', strokeWidth: 3, font: 'Impact, sans-serif' }, anim: 'zoom' },
  { name: 'Typewriter', text: 'Typing effect…', style: { size: 64, font: 'ui-monospace, monospace', bold: false, strokeWidth: 0 }, anim: 'typewriter' },
  { name: 'Meme', text: 'TOP TEXT', style: { size: 100, font: 'Impact, sans-serif', strokeWidth: 6 } },
  { name: 'Lower third', text: 'Name Surname\nTitle', style: { size: 48, align: 'left', background: '#8b5cf6dd', color: '#ffffff', strokeWidth: 0, shadow: false }, anim: 'slide-right' },
  { name: 'Handwritten', text: 'hello!', style: { size: 96, font: '"Comic Sans MS", "Segoe Print", cursive', color: '#ffe066' }, anim: 'bounce' },
]
const STICKERS = ['😂', '🔥', '❤️', '👍', '😎', '🎉', '⭐', '💯', '😱', '🐔', '🍗', '🥚', '👀', '✨', '💥', '🎵', '➡️', '✅', '❌', '💀', '🤯', '🙌', '🌈', '☀️']
const TRANSITIONS: TransitionType[] = ['none', 'fade', 'dissolve', 'slide-left', 'slide-right', 'slide-up', 'zoom-in', 'zoom-out', 'wipe', 'spin', 'blur']
const ASPECTS: { label: string; w: number; h: number }[] = [
  { label: '16:9 Landscape (YouTube)', w: 1920, h: 1080 }, { label: '9:16 Portrait (TikTok/Reels/Shorts)', w: 1080, h: 1920 },
  { label: '1:1 Square', w: 1080, h: 1080 }, { label: '4:5 Instagram', w: 1080, h: 1350 }, { label: '4:3 Classic', w: 1440, h: 1080 },
  { label: '21:9 Cinematic', w: 2560, h: 1080 }, { label: '720p', w: 1280, h: 720 }, { label: '4K UHD', w: 3840, h: 2160 },
]

function addTextClip(style: Partial<typeof DEFAULT_TEXT_STYLE>, text: string, anim: ClipAnim = 'none') {
  const st = useStore.getState()
  let clipId = ''
  st.update((p) => {
    const start = st.playhead
    let tr = p.tracks.find((t) => t.kind === 'text' && !p.clips.some((c) => c.trackId === t.id && c.start < start + 3 && clipEnd(c) > start))
    if (!tr) { tr = newTrack('text', p.tracks.filter((t) => t.kind === 'text').length + 1); p.tracks.unshift(tr) }
    const c = makeClip('text', tr.id, start, 3, { name: text, text, textStyle: { ...DEFAULT_TEXT_STYLE, ...style }, animIn: anim })
    clipId = c.id
    p.clips.push(c)
  })
  st.select([clipId])
}

function LeftPanel() {
  const [tab, setTab] = useState<'media' | 'text' | 'stickers' | 'effects' | 'transitions' | 'anims' | 'project'>('media')
  const selected = useStore((s) => s.selectedClipIds)
  const project = useStore((s) => s.project)
  const update = useStore((s) => s.update)
  const sel = project.clips.find((c) => c.id === selected[0])
  const applyToSel = (fn: (c: Clip) => void) => {
    if (!selected.length) return useStore.getState().notify('Select a clip on the timeline first')
    update((p) => p.clips.filter((c) => selected.includes(c.id)).forEach(fn))
  }
  return (
    <div className="panel video-left">
      <div className="left-tabs">
        {(['media', 'text', 'stickers', 'effects', 'transitions', 'anims', 'project'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {{ media: '📁 Media', text: 'T Text', stickers: '😀 Stickers', effects: '✨ Filters', transitions: '⇄ Transitions', anims: '🎬 Animations', project: '⚙ Project' }[t]}
          </button>
        ))}
      </div>
      <div style={{ overflow: 'auto', flex: 1 }}>
        {tab === 'media' && <>
          <MediaBin />
          <div className="section-body">
            <button onClick={() => useStore.getState().update((p) => {
              const st = useStore.getState()
              const tr = p.tracks.find((t) => t.kind === 'video')!
              p.clips.push(makeClip('color', tr.id, st.playhead, 3, { name: 'Color', color: '#8b5cf6' }))
            })}>＋ Solid color clip</button>
          </div>
        </>}
        {tab === 'text' && <div className="section-body" style={{ paddingTop: 10 }}>
          <button className="primary" onClick={() => addTextClip({}, 'Your text')}>＋ Add text</button>
          <div className="grid2">
            {TEXT_TEMPLATES.map((t) => (
              <button key={t.name} style={{ height: 54, fontFamily: t.style.font, color: t.style.color, background: t.style.background || undefined }}
                onClick={() => addTextClip(t.style, t.text, t.anim)}>{t.name}</button>
            ))}
          </div>
          <div className="hint">Add auto-captions by typing lines into a text clip; split it at the playhead with S to time each line.</div>
        </div>}
        {tab === 'stickers' && <div className="section-body" style={{ paddingTop: 10 }}>
          <div className="grid3" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
            {STICKERS.map((s) => (
              <button key={s} style={{ fontSize: 24, padding: 4 }} onClick={() => addTextClip({ size: 180, strokeWidth: 0, shadow: false }, s, 'pop')}>{s}</button>
            ))}
          </div>
          <div className="hint">Stickers are text clips, so you can animate, rotate and scale them in the inspector.</div>
        </div>}
        {tab === 'effects' && <div className="section-body" style={{ paddingTop: 10 }}>
          <div className="hint">{sel ? `Apply to: ${sel.name}` : 'Select a clip, then pick a filter.'}</div>
          <div className="grid2">
            {Object.keys(FILTER_PRESETS).map((f) => (
              <button key={f} className={sel?.filterPreset === f ? 'active' : ''} onClick={() => applyToSel((c) => { c.filterPreset = f })}>{f}</button>
            ))}
          </div>
          <button onClick={() => applyToSel((c) => { c.filters = { ...DEFAULT_FILTERS }; c.filterPreset = 'none' })}>Reset adjustments</button>
        </div>}
        {tab === 'transitions' && <div className="section-body" style={{ paddingTop: 10 }}>
          <div className="hint">Transitions play at the start of the selected clip and blend from the clip right before it on the same track.</div>
          <div className="grid2">
            {TRANSITIONS.map((t) => (
              <button key={t} className={sel?.transitionIn.type === t ? 'active' : ''} onClick={() => applyToSel((c) => { c.transitionIn = { type: t, duration: c.transitionIn.duration || 0.5 } })}>{t}</button>
            ))}
          </div>
          {sel && <Slider label="Duration" min={0.1} max={3} value={sel.transitionIn.duration} onChange={(v) => update((p) => { p.clips.find((c) => c.id === sel.id)!.transitionIn.duration = v }, false)} onCommit={useStore.getState().checkpoint} />}
          <button onClick={() => applyToSel((c) => { c.transitionIn = { type: 'dissolve', duration: 0.6 } })}>Apply dissolve to all selected</button>
        </div>}
        {tab === 'anims' && <div className="section-body" style={{ paddingTop: 10 }}>
          <div className="hint">{sel ? `Animate: ${sel.name}` : 'Select a clip first.'}</div>
          <b className="small">In</b>
          <div className="grid3">{IN_PRESETS.map((a) => <button key={a} className={sel?.animIn === a ? 'active' : ''} onClick={() => applyToSel((c) => { c.animIn = a as ClipAnim })}>{a}</button>)}</div>
          <b className="small">Out</b>
          <div className="grid3">{IN_PRESETS.map((a) => <button key={a} className={sel?.animOut === a ? 'active' : ''} onClick={() => applyToSel((c) => { c.animOut = a as ClipAnim })}>{a}</button>)}</div>
          <b className="small">Loop</b>
          <div className="grid3">{LOOP_PRESETS.map((a) => <button key={a} className={sel?.animLoop === a ? 'active' : ''} onClick={() => applyToSel((c) => { c.animLoop = a as ClipAnim })}>{a}</button>)}</div>
          <div className="hint">For custom motion graphics, build them in the <b>Animator</b> tab and click "Send to video".</div>
        </div>}
        {tab === 'project' && <ProjectSettings project={project} />}
      </div>
    </div>
  )
}

function ProjectSettings({ project }: { project: Project }) {
  const update = useStore((s) => s.update)
  return (
    <div className="section-body" style={{ paddingTop: 10 }}>
      <b>Canvas / aspect ratio</b>
      <div className="grid2">
        {ASPECTS.map((a) => (
          <button key={a.label} className={project.width === a.w && project.height === a.h ? 'active' : ''} onClick={() => update((p) => { p.width = a.w; p.height = a.h })}>{a.label}</button>
        ))}
      </div>
      <div className="row">
        <label className="field"><span>Width</span><input type="number" value={project.width} onChange={(e) => update((p) => { p.width = Math.max(16, +e.target.value || 16) })} /></label>
        <label className="field"><span>Height</span><input type="number" value={project.height} onChange={(e) => update((p) => { p.height = Math.max(16, +e.target.value || 16) })} /></label>
      </div>
      <Select label="Frame rate" value={String(project.fps)} options={['24', '25', '30', '50', '60']} onChange={(v) => update((p) => { p.fps = +v })} />
      <Color label="Background" value={project.background} onChange={(v) => update((p) => { p.background = v })} />
      <div className="hint">Duration: {fmtTime(projectDuration(project))} · {project.clips.length} clips</div>
    </div>
  )
}

function Inspector() {
  const project = useStore((s) => s.project)
  const selected = useStore((s) => s.selectedClipIds)
  const playhead = useStore((s) => s.playhead)
  const { update, checkpoint } = useStore.getState()
  const c = project.clips.find((x) => x.id === selected[0])
  if (!c) return (
    <div className="panel inspector">
      <div className="panel-title">Inspector</div>
      <div className="hint" style={{ padding: 10 }}>Select a clip to edit it. With nothing selected, these are your project settings:</div>
      <ProjectSettings project={project} />
      <div className="section-body hint">
        <b>Shortcuts</b><br />Space play/pause · S split · Del delete · Shift+Del ripple delete · Ctrl+D duplicate · Ctrl+Z / Ctrl+Shift+Z undo/redo · ←/→ step frame (Shift = 1s)
      </div>
    </div>
  )
  const set = (fn: (c: Clip) => void, undo = false) => update((p) => { const x = p.clips.find((y) => y.id === c.id); if (x) fn(x) }, undo)
  const local = playhead - c.start
  const inRange = local >= 0 && local <= c.duration
  const tf = clipTransformAt(c, Math.max(0, Math.min(c.duration, local)))
  const setTf = (k: keyof Transform, v: number) => set((x) => {
    if (x.keyframes?.[k]?.length && inRange) x.keyframes[k] = setKey(x.keyframes[k], local, v, x.keyframes[k]!.at(-1)?.ease)
    else x.transform[k] = v
  })
  const hasKeys = (k: keyof Transform) => !!c.keyframes?.[k]?.length
  const toggleKey = (k: keyof Transform) => set((x) => {
    x.keyframes = x.keyframes ?? {}
    const arr = x.keyframes[k] ?? []
    const existing = arr.find((kf) => Math.abs(kf.t - local) < 0.02)
    x.keyframes[k] = existing ? arr.filter((kf) => kf !== existing) : setKey(arr, Math.max(0, Math.min(x.duration, local)), tf[k])
  }, true)
  const visual = c.kind !== 'audio'
  const hasAudio = c.kind === 'audio' || (c.kind === 'video' && project.media.find((m) => m.id === c.mediaId)?.hasAudio)
  const timed = c.kind === 'video' || c.kind === 'audio'
  const keyBtn = (k: keyof Transform) => {
    const onKey = c.keyframes?.[k]?.some((kf) => Math.abs(kf.t - local) < 0.02)
    return <button className="icon" title="Add/remove keyframe at playhead" style={{ color: onKey ? '#8b5cf6' : hasKeys(k) ? '#a78bfa88' : '#666' }} onClick={() => toggleKey(k)}>◆</button>
  }
  return (
    <div className="panel inspector">
      <div className="panel-title">{c.kind.toUpperCase()} · <input style={{ flex: 1 }} value={c.name} onChange={(e) => set((x) => { x.name = e.target.value })} /></div>
      {c.kind === 'text' && <Section title="Text">
        <textarea rows={3} value={c.text} onFocus={checkpoint} onChange={(e) => set((x) => { x.text = e.target.value })} />
        <Select label="Font" value={c.textStyle!.font} options={[
          { value: 'Inter, system-ui, sans-serif', label: 'Sans' }, { value: 'Georgia, serif', label: 'Serif' }, { value: 'Impact, sans-serif', label: 'Impact' },
          { value: 'ui-monospace, monospace', label: 'Mono' }, { value: '"Comic Sans MS", "Segoe Print", cursive', label: 'Handwritten' }, { value: '"Brush Script MT", cursive', label: 'Script' },
          { value: '"Arial Black", sans-serif', label: 'Arial Black' }, { value: '"Courier New", monospace', label: 'Courier' }]}
          onChange={(v) => set((x) => { x.textStyle!.font = v }, true)} />
        <Slider label="Size" min={8} max={400} step={1} value={c.textStyle!.size} onCommit={checkpoint} onChange={(v) => set((x) => { x.textStyle!.size = v })} />
        <div className="row">
          <Color label="Color" value={c.textStyle!.color} onChange={(v) => set((x) => { x.textStyle!.color = v })} />
          <Color label="Outline" value={c.textStyle!.stroke} onChange={(v) => set((x) => { x.textStyle!.stroke = v })} />
        </div>
        <Slider label="Outline" min={0} max={20} step={0.5} value={c.textStyle!.strokeWidth} onCommit={checkpoint} onChange={(v) => set((x) => { x.textStyle!.strokeWidth = v })} />
        <div className="row">
          <Check label="Bold" value={c.textStyle!.bold} onChange={(v) => set((x) => { x.textStyle!.bold = v }, true)} />
          <Check label="Italic" value={c.textStyle!.italic} onChange={(v) => set((x) => { x.textStyle!.italic = v }, true)} />
          <Check label="Shadow" value={c.textStyle!.shadow} onChange={(v) => set((x) => { x.textStyle!.shadow = v }, true)} />
        </div>
        <div className="row">
          <Check label="Background" value={!!c.textStyle!.background} onChange={(v) => set((x) => { x.textStyle!.background = v ? '#000000aa' : '' }, true)} />
          {!!c.textStyle!.background && <Color value={c.textStyle!.background.slice(0, 7)} onChange={(v) => set((x) => { x.textStyle!.background = v + 'cc' })} />}
          <Select value={c.textStyle!.align} options={['left', 'center', 'right'] as const} onChange={(v) => set((x) => { x.textStyle!.align = v }, true)} />
        </div>
      </Section>}
      {c.kind === 'color' && <Section title="Color"><Color label="Fill" value={c.color ?? '#000'} onChange={(v) => set((x) => { x.color = v })} /></Section>}
      {visual && <Section title="Transform  (◆ = keyframe)">
        <div className="row kfrow"><div style={{ flex: 1, minWidth: 0 }}><Slider label="X" min={-project.width} max={project.width} step={1} value={tf.x} onCommit={checkpoint} onChange={(v) => setTf('x', v)} /></div>{keyBtn('x')}</div>
        <div className="row kfrow"><div style={{ flex: 1, minWidth: 0 }}><Slider label="Y" min={-project.height} max={project.height} step={1} value={tf.y} onCommit={checkpoint} onChange={(v) => setTf('y', v)} /></div>{keyBtn('y')}</div>
        <div className="row kfrow"><div style={{ flex: 1, minWidth: 0 }}><Slider label="Scale" min={0.05} max={5} value={tf.scale} onCommit={checkpoint} onChange={(v) => setTf('scale', v)} /></div>{keyBtn('scale')}</div>
        <div className="row kfrow"><div style={{ flex: 1, minWidth: 0 }}><Slider label="Rotation" min={-360} max={360} step={1} value={tf.rotation} onCommit={checkpoint} onChange={(v) => setTf('rotation', v)} /></div>{keyBtn('rotation')}</div>
        <div className="row kfrow"><div style={{ flex: 1, minWidth: 0 }}><Slider label="Opacity" min={0} max={1} value={tf.opacity} onCommit={checkpoint} onChange={(v) => setTf('opacity', v)} /></div>{keyBtn('opacity')}</div>
        {c.keyframes && Object.values(c.keyframes).some((a) => a?.length) && <div className="row">
          <Select label="Key easing" value={(Object.values(c.keyframes).find((a) => a?.length)?.at(-1)?.ease ?? 'easeInOut') as Ease} options={EASES}
            onChange={(v) => set((x) => { for (const a of Object.values(x.keyframes ?? {})) a?.forEach((k) => { k.ease = v }) }, true)} />
          <button onClick={() => set((x) => { x.keyframes = {} }, true)}>Clear keys</button>
        </div>}
        {c.kind !== 'text' && <Select label="Fit" value={c.fit} options={['contain', 'cover', 'stretch'] as const} onChange={(v) => set((x) => { x.fit = v }, true)} />}
        <div className="row">
          <button onClick={() => set((x) => { x.flipH = !x.flipH }, true)}>⇋ Flip H</button>
          <button onClick={() => set((x) => { x.flipV = !x.flipV }, true)}>⇵ Flip V</button>
          <button onClick={() => set((x) => { x.transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }; x.keyframes = {} }, true)}>Reset</button>
        </div>
      </Section>}
      {(timed || c.kind === 'animation') && <Section title="Speed">
        <Slider label="Speed" min={0.1} max={8} value={c.speed} onCommit={checkpoint} onChange={(v) => set((x) => {
          const srcLen = x.duration * x.speed
          x.speed = v
          x.duration = Math.max(0.1, srcLen / v)
        })} />
        <div className="row">{[0.25, 0.5, 1, 1.5, 2, 4].map((s) => <button key={s} className={c.speed === s ? 'active' : ''} onClick={() => set((x) => { const srcLen = x.duration * x.speed; x.speed = s; x.duration = srcLen / s }, true)}>{s}x</button>)}</div>
      </Section>}
      {hasAudio && <Section title="Audio">
        <Slider label="Volume" min={0} max={2} value={c.volume} onCommit={checkpoint} onChange={(v) => set((x) => { x.volume = v })} />
        <Slider label="Fade in" min={0} max={Math.min(10, c.duration)} value={c.fadeIn} onCommit={checkpoint} onChange={(v) => set((x) => { x.fadeIn = v })} />
        <Slider label="Fade out" min={0} max={Math.min(10, c.duration)} value={c.fadeOut} onCommit={checkpoint} onChange={(v) => set((x) => { x.fadeOut = v })} />
      </Section>}
      {visual && c.kind !== 'text' && <Section title="Adjust" defaultOpen={false}>
        <Select label="Filter" value={c.filterPreset} options={Object.keys(FILTER_PRESETS)} onChange={(v) => set((x) => { x.filterPreset = v }, true)} />
        {([['brightness', 0, 2], ['contrast', 0, 2], ['saturation', 0, 3], ['hue', -180, 180], ['temperature', -1, 1], ['blur', 0, 30], ['vignette', 0, 1], ['grayscale', 0, 1], ['sepia', 0, 1], ['invert', 0, 1]] as const).map(([k, mn, mx]) => (
          <Slider key={k} label={k} min={mn} max={mx} step={k === 'hue' ? 1 : 0.01} value={c.filters[k]} onCommit={checkpoint} onChange={(v) => set((x) => { x.filters[k] = v })} />
        ))}
      </Section>}
      {visual && <Section title="Animation" defaultOpen={false}>
        <Select label="In" value={c.animIn} options={IN_PRESETS as ClipAnim[]} onChange={(v) => set((x) => { x.animIn = v }, true)} />
        <Select label="Out" value={c.animOut} options={IN_PRESETS as ClipAnim[]} onChange={(v) => set((x) => { x.animOut = v }, true)} />
        <Select label="Loop" value={c.animLoop} options={LOOP_PRESETS as ClipAnim[]} onChange={(v) => set((x) => { x.animLoop = v }, true)} />
        <Select label="Transition" value={c.transitionIn.type} options={TRANSITIONS} onChange={(v) => set((x) => { x.transitionIn.type = v }, true)} />
      </Section>}
      {(c.kind === 'video' || c.kind === 'image') && <Section title="Chroma key (green screen)" defaultOpen={false}>
        <Check label="Enabled" value={!!c.chromaKey?.enabled} onChange={(v) => set((x) => { x.chromaKey = { color: '#00ff00', tolerance: 0.35, ...x.chromaKey, enabled: v } }, true)} />
        {c.chromaKey?.enabled && <>
          <Color label="Key color" value={c.chromaKey.color} onChange={(v) => set((x) => { x.chromaKey!.color = v })} />
          <Slider label="Tolerance" min={0.05} max={1} value={c.chromaKey.tolerance} onChange={(v) => set((x) => { x.chromaKey!.tolerance = v })} />
        </>}
      </Section>}
      <Section title="Timing" defaultOpen={false}>
        <Slider label="Start" min={0} max={Math.max(60, c.start + 10)} value={c.start} onCommit={checkpoint} onChange={(v) => set((x) => { x.start = Math.max(0, v) })} />
        <Slider label="Duration" min={0.1} max={Math.max(60, c.duration * 2)} value={c.duration} onCommit={checkpoint} onChange={(v) => set((x) => { x.duration = Math.max(0.1, v) })} />
        {timed && <div className="hint">Source in-point: {c.inPoint.toFixed(2)}s</div>}
      </Section>
    </div>
  )
}

function Preview() {
  const ref = useRef<HTMLCanvasElement>(null)
  const project = useStore((s) => s.project)
  const playing = useStore((s) => s.playing)
  const playhead = useStore((s) => s.playhead)
  usePreview(ref)
  const scale = Math.min(1, 1280 / Math.max(project.width, project.height))

  // drag to move selected clip in preview; wheel to scale
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const st = useStore.getState()
    const c = st.project.clips.find((x) => x.id === st.selectedClipIds[0])
    if (!c || c.kind === 'audio') return
    const r = e.currentTarget.getBoundingClientRect()
    const k = 1 / Math.min(r.width / project.width, r.height / project.height)
    const sx = e.clientX, sy = e.clientY
    const ox = c.transform.x, oy = c.transform.y
    st.checkpoint()
    const move = (ev: PointerEvent) => st.update((p) => {
      const x = p.clips.find((y) => y.id === c.id)!
      x.transform.x = Math.round(ox + (ev.clientX - sx) * k)
      x.transform.y = Math.round(oy + (ev.clientY - sy) * k)
    }, false)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onWheel = (e: React.WheelEvent) => {
    const st = useStore.getState()
    const id = st.selectedClipIds[0]
    if (!id) return
    st.update((p) => { const x = p.clips.find((y) => y.id === id); if (x) x.transform.scale = Math.max(0.05, x.transform.scale * (e.deltaY < 0 ? 1.05 : 0.95)) }, false)
  }
  const snapshot = () => {
    const cv = document.createElement('canvas'); cv.width = project.width; cv.height = project.height
    renderFrame(cv.getContext('2d')!, project, playhead)
    cv.toBlob((b) => { if (b) { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `frame-${playhead.toFixed(2)}s.png`; a.click() } })
  }
  return (
    <div className="preview-wrap">
      <div className="preview-stage">
        <canvas ref={ref} width={Math.round(project.width * scale)} height={Math.round(project.height * scale)}
          style={{ aspectRatio: `${project.width}/${project.height}`, cursor: 'move' }}
          onPointerDown={onDown} onWheel={onWheel}
          // render at reduced resolution for preview
          data-scale={scale} />
      </div>
      <div className="preview-bar">
        <button onClick={() => useStore.getState().setPlayhead(0)}>⏮</button>
        <button className="primary" style={{ width: 70 }} onClick={() => useStore.getState().setPlaying(!playing)}>{playing ? '⏸ Pause' : '▶ Play'}</button>
        <button onClick={() => useStore.getState().setPlayhead(projectDuration(project))}>⏭</button>
        <span className="timecode">{fmtTime(playhead)} / {fmtTime(projectDuration(project))}</span>
        <span style={{ flex: 1 }} />
        <button title="Save current frame as PNG" onClick={snapshot}>📷 Frame</button>
        <span className="muted small">{project.width}×{project.height} · {project.fps}fps</span>
      </div>
    </div>
  )
}

export function VideoEditor() {
  return (
    <div className="video-editor">
      <LeftPanel />
      <Preview />
      <Inspector />
      <Timeline />
    </div>
  )
}
