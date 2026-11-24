import { useEffect, useState } from 'react'
import { Modal, fmtTime } from './controls'
import { docKeys, loadDoc, deleteDoc, saveDoc, deleteBlob } from '../core/db'
import { useStore, projectDuration } from '../core/store'
import type { Project } from '../core/types'
import { TEMPLATES } from '../core/templates'
import { nanoid } from 'nanoid'

interface Row { id: string; name: string; updatedAt: number; clips: number; dur: number; w: number; h: number }

export function ProjectsDialog({ onClose, startOnNew = false }: { onClose: () => void; startOnNew?: boolean }) {
  const current = useStore((s) => s.project)
  const [rows, setRows] = useState<Row[]>([])
  const [view, setView] = useState<'list' | 'new'>(startOnNew ? 'new' : 'list')
  const [busy, setBusy] = useState<string | null>(null)
  const refresh = async () => {
    // make sure the open project is saved first
    await saveDoc('project:' + current.id, current)
    const ks = (await docKeys()).map(String).filter((k) => k.startsWith('project:'))
    const out: Row[] = []
    for (const k of ks) {
      const p = await loadDoc<Project>(k)
      if (p) out.push({ id: p.id, name: p.name, updatedAt: p.updatedAt, clips: p.clips.length, dur: projectDuration(p), w: p.width, h: p.height })
    }
    setRows(out.sort((a, b) => b.updatedAt - a.updatedAt))
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh() }, [])
  const open = async (id: string) => {
    const p = await loadDoc<Project>('project:' + id)
    if (!p) return
    useStore.getState().replaceProject(p)
    await saveDoc('current-project', id)
    onClose()
  }
  const remove = async (r: Row) => {
    if (r.id === current.id) return useStore.getState().notify("You can't delete the project that is open")
    if (!confirm(`Delete "${r.name}"? This can't be undone.`)) return
    const p = await loadDoc<Project>('project:' + r.id)
    await deleteDoc('project:' + r.id)
    // remove media no other project uses
    if (p) {
      const used = new Set<string>()
      for (const k of (await docKeys()).map(String).filter((k) => k.startsWith('project:'))) (await loadDoc<Project>(k))?.media.forEach((m) => used.add(m.id))
      for (const m of p.media) if (!used.has(m.id)) await deleteBlob(m.id)
    }
    await refresh()
  }
  const duplicate = async (r: Row) => {
    const p = await loadDoc<Project>('project:' + r.id)
    if (!p) return
    const copy: Project = { ...JSON.parse(JSON.stringify(p)), id: nanoid(10), name: p.name + ' copy', updatedAt: Date.now() }
    await saveDoc('project:' + copy.id, copy)
    await refresh()
  }
  const create = async (tid: string) => {
    const t = TEMPLATES.find((x) => x.id === tid)!
    setBusy(t.name)
    try {
      const p = await t.build()
      if (!p) return
      useStore.getState().replaceProject(p)
      await saveDoc('project:' + p.id, p)
      await saveDoc('current-project', p.id)
      useStore.getState().setTab('video')
      onClose()
    } finally { setBusy(null) }
  }
  return (
    <Modal title={view === 'list' ? 'Your projects' : 'New project'} onClose={onClose}>
      <div className="row">
        <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>📂 My projects</button>
        <button className={view === 'new' ? 'active' : ''} onClick={() => setView('new')}>＋ New from template</button>
      </div>
      {view === 'list' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 'min(560px, 80vw)' }}>
          {rows.map((r) => (
            <div key={r.id} className="audio-item" style={{ border: '1px solid var(--line)', borderRadius: 8, background: r.id === current.id ? '#8b5cf622' : undefined }}>
              <span className="aname"><b>{r.name}</b><br /><span className="muted small">{r.w}×{r.h} · {r.clips} clips · {fmtTime(r.dur).slice(0, -3)} · edited {new Date(r.updatedAt).toLocaleString()}</span></span>
              {r.id === current.id ? <span className="chip on">Open</span> : <button className="primary" onClick={() => void open(r.id)}>Open</button>}
              <button title="Duplicate" onClick={() => void duplicate(r)}>⧉</button>
              <button className="danger" title="Delete" onClick={() => void remove(r)}>🗑</button>
            </div>
          ))}
          {!rows.length && <div className="hint">Loading…</div>}
          <div className="hint">Projects are saved on this Chromebook. Use Export → Project file to back one up or move it.</div>
        </div>
      ) : (
        <div className="grid2" style={{ minWidth: 'min(560px, 80vw)' }}>
          {TEMPLATES.map((t) => (
            <button key={t.id} disabled={!!busy} style={{ textAlign: 'left', whiteSpace: 'normal', height: 'auto', padding: 12 }} onClick={() => void create(t.id)}>
              <div style={{ fontSize: 22 }}>{t.icon}</div><b>{busy === t.name ? 'Creating…' : t.name}</b><div className="muted small">{t.desc}</div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
