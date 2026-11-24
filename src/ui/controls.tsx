import type { ReactNode } from 'react'

export function Slider({ label, value, min, max, step = 0.01, onChange, onCommit, format }: {
  label: string; value: number; min: number; max: number; step?: number
  onChange: (v: number) => void; onCommit?: () => void; format?: (v: number) => string
}) {
  return (
    <label className="slider">
      <span className="slider-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onPointerDown={onCommit} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <input className="num" type="number" min={min} max={max} step={step} value={Number(value.toFixed(3))}
        onFocus={onCommit} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v) }} />
      {format && <span className="slider-fmt">{format(value)}</span>}
    </label>
  )
}

export function Select<T extends string>({ label, value, options, onChange }: {
  label?: string; value: T; options: readonly T[] | { value: T; label: string }[]; onChange: (v: T) => void
}) {
  const opts = (options as (T | { value: T; label: string })[]).map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  return (
    <label className="field">
      {label && <span>{label}</span>}
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

export function Color({ label, value, onChange }: { label?: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field color-field">
      {label && <span>{label}</span>}
      <input type="color" value={value.length === 7 ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  )
}

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="section" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="section-body">{children}</div>
    </details>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-head"><b>{title}</b><button className="icon" onClick={onClose}>✕</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export const fmtTime = (t: number) => {
  const m = Math.floor(t / 60), s = Math.floor(t % 60), f = Math.floor((t % 1) * 100)
  return `${m}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`
}
