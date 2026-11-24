import { useEffect, useRef, useState } from 'react'
import type { AnimLayer, AnimProp, AnimationDoc, Ease } from '../core/types'
import { ANIM_PROPS } from '../core/types'
import { EASES, sampleKeys } from '../core/anim'
import { useStore } from '../core/store'

/** Value-over-time curve editor for one property of one layer. */
export function Graph({ doc, layer, time, pps, onEdit, onSeek }: {
  doc: AnimationDoc; layer: AnimLayer; time: number; pps: number
  onEdit: (fn: (l: AnimLayer) => void, undo?: boolean) => void; onSeek: (t: number) => void
}) {
  const withKeys = ANIM_PROPS.filter((p) => layer.keys[p]?.length)
  const [prop, setProp] = useState<AnimProp>(withKeys[0] ?? 'x')
  const [sel, setSel] = useState<number | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [H, setH] = useState(180)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setH(Math.max(120, el.clientHeight - 8)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const keys = layer.keys[prop] ?? []
  const W = doc.duration * pps
  const base = layer.base[prop] ?? 0
  const samples: number[] = []
  for (let i = 0; i <= 200; i++) samples.push(sampleKeys(keys, (i / 200) * doc.duration - layer.start, base))
  let lo = Math.min(...samples, ...keys.map((k) => k.value)), hi = Math.max(...samples, ...keys.map((k) => k.value))
  if (hi - lo < 1e-6) { lo -= 1; hi += 1 }
  const pad = (hi - lo) * 0.15
  lo -= pad; hi += pad
  const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo)) * (H - 16)
  const v = (py: number) => lo + (1 - (py - 8) / (H - 16)) * (hi - lo)
  const x = (t: number) => t * pps
  const dragKey = (e: React.PointerEvent, i: number) => {
    e.stopPropagation()
    setSel(i)
    const r = (e.currentTarget.closest('svg') as SVGSVGElement).getBoundingClientRect()
    const k0 = keys[i]
    useStore.getState().checkpoint()
    onSeek(layer.start + k0.t)
    const move = (ev: PointerEvent) => {
      const t = Math.max(0, Math.min(layer.end - layer.start, Math.round(((ev.clientX - r.left) / pps - layer.start) * doc.fps) / doc.fps))
      const val = ev.shiftKey ? k0.value : Math.round(v(ev.clientY - r.top) * 100) / 100
      onEdit((l) => { const arr = l.keys[prop]!; arr[i] = { ...arr[i], t: ev.altKey ? k0.t : t, value: val }; arr.sort((a, b) => a.t - b.t) }, false)
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const addKey = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const t = Math.max(0, Math.round(((e.clientX - r.left) / pps - layer.start) * doc.fps) / doc.fps)
    const val = Math.round(v(e.clientY - r.top) * 100) / 100
    onEdit((l) => { l.keys[prop] = [...(l.keys[prop] ?? []).filter((k) => Math.abs(k.t - t) > 1e-3), { t, value: val, ease: 'easeInOut' as Ease }].sort((a, b) => a.t - b.t) })
  }
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <div style={{ width: 180, flexShrink: 0, borderRight: '1px solid var(--line)', overflow: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <b className="small">{layer.name}</b>
        {ANIM_PROPS.filter((p) => p !== 'path' || layer.path).map((p) => (
          <button key={p} className={p === prop ? 'active' : ''} style={{ textAlign: 'left' }} onClick={() => { setProp(p); setSel(null) }}>{p}{layer.keys[p]?.length ? ` · ${layer.keys[p]!.length}◆` : ''}</button>
        ))}
        {sel !== null && keys[sel] && <>
          <span className="small muted">Key {sel + 1}: ease in</span>
          <select value={keys[sel].ease} onChange={(e) => onEdit((l) => { l.keys[prop]![sel].ease = e.target.value as Ease })}>{EASES.map((ea) => <option key={ea}>{ea}</option>)}</select>
          <button className="danger" onClick={() => { onEdit((l) => { l.keys[prop]!.splice(sel, 1) }); setSel(null) }}>Delete key</button>
        </>}
      </div>
      <div ref={wrap} style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <svg width={W} height={H} style={{ display: 'block', background: '#14141a', cursor: 'crosshair' }} onDoubleClick={addKey}
          onPointerDown={(e) => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); onSeek(Math.max(0, (e.clientX - r.left) / pps)) } }}>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} x2={W} y1={8 + f * (H - 16)} y2={8 + f * (H - 16)} stroke="#2a2a35" />)}
          <text x={4} y={16} fill="#777" fontSize={10}>{hi.toFixed(1)}</text>
          <text x={4} y={H - 4} fill="#777" fontSize={10}>{lo.toFixed(1)}</text>
          <rect x={x(layer.start)} y={0} width={x(layer.end - layer.start)} height={H} fill="#8b5cf611" />
          <polyline fill="none" stroke="#a78bfa" strokeWidth={2} points={samples.map((s, i) => `${x((i / 200) * doc.duration)},${y(s)}`).join(' ')} />
          {keys.map((k, i) => (
            <circle key={i} cx={x(layer.start + k.t)} cy={y(k.value)} r={sel === i ? 7 : 5.5} fill={sel === i ? '#fff' : '#8b5cf6'} stroke="#fff" strokeWidth={1.5}
              style={{ cursor: 'grab' }} onPointerDown={(e) => dragKey(e, i)}><title>{`${prop} = ${k.value} @ ${(layer.start + k.t).toFixed(2)}s (${k.ease})`}</title></circle>
          ))}
          <line x1={x(time)} x2={x(time)} y1={0} y2={H} stroke="#8b5cf6" strokeWidth={2} pointerEvents="none" />
        </svg>
        {!keys.length && <div className="hint" style={{ position: 'absolute', top: 30, left: 20 }}>No keyframes for "{prop}" yet. Double-click the graph to add one.</div>}
      </div>
    </div>
  )
}
