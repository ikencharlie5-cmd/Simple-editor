import { useEffect, useState } from 'react'
import { ProjectsDialog } from './ui/Projects'
import { HelpDialog, Tour } from './ui/Help'
import { useStore, initPersistence, type Tab } from './core/store'
import { usePhoto } from './photo/doc'
import { PhotoEditor, setOpenProjectsPhotos } from './photo/PhotoEditor'
import { VideoEditor } from './video/VideoEditor'
import { AudioTab } from './audio/AudioTab'
import { Animator } from './animator/Animator'
import { ExportTab } from './export/ExportTab'

const TABS: { id: Tab; label: string }[] = [
  { id: 'photo', label: '🖼 Photo' },
  { id: 'video', label: '🎬 Video' },
  { id: 'audio', label: '🎵 Audio' },
  { id: 'animator', label: '🐔 Animator' },
  { id: 'export', label: '⬇ Export' },
]

export default function App() {
  const tab = useStore((s) => s.tab)
  const loaded = useStore((s) => s.loaded)
  const toast = useStore((s) => s.toast)
  const saveStatus = useStore((s) => s.saveStatus)
  const name = useStore((s) => s.project.name)
  const screenMode = usePhoto((s) => s.screenMode)
  const [dlg, setDlg] = useState<null | 'projects' | 'new' | 'photos' | 'help' | 'tour'>(null)
  useEffect(() => { setOpenProjectsPhotos(() => setDlg('photos')) }, [])
  const [panels, setPanels] = useState<{ left: boolean; right: boolean }>({ left: false, right: false })
  useEffect(() => { try { if (!localStorage.getItem('chiken-tour-done')) setDlg('tour') } catch { /* storage blocked */ } }, [])
  useEffect(() => { setPanels({ left: false, right: false }) }, [tab])

  useEffect(() => { void initPersistence() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.key === '?' && !el.closest('input, textarea, select')) { setDlg('help'); return }
      if (!e.altKey || e.ctrlKey) return
      const i = ['1', '2', '3', '4', '5'].indexOf(e.key)
      if (i >= 0) { e.preventDefault(); useStore.getState().setTab(TABS[i].id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!loaded) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>Loading Chiken…</div>

  return (
    <div className={'app ' + (tab === 'photo' && screenMode === 2 ? 'screen-full' : '') + (panels.left ? ' show-left' : '') + (panels.right ? ' show-right' : '')}>
      <div className="topbar">
        <div className="brand"><img src="./favicon.svg" alt="" />Chiken</div>
        <div className="tabs">
          {TABS.map((t, i) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} title={`Alt+${i + 1}`} onClick={() => useStore.getState().setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <span className="spacer" />
        <input className="project-name" value={name} onChange={(e) => useStore.getState().update((p) => { p.name = e.target.value }, false)} />
        <span className="save-status">{saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'saving' ? 'Saving…' : '● Unsaved'}</span>
        <button className="narrow-only" title="Show left panel" onClick={() => setPanels((p) => ({ left: !p.left, right: false }))}>◧</button>
        <button className="narrow-only" title="Show right panel" onClick={() => setPanels((p) => ({ right: !p.right, left: false }))}>◨</button>
        <button onClick={() => setDlg('projects')}>📂 Projects</button>
        <button onClick={() => setDlg('new')}>＋ New</button>
        <button title="Help & shortcuts (?)" onClick={() => setDlg('help')}>?</button>
      </div>
      <div className="main">
        {tab === 'photo' && <PhotoEditor />}
        {tab === 'video' && <VideoEditor />}
        {tab === 'audio' && <AudioTab />}
        {tab === 'animator' && <Animator />}
        {tab === 'export' && <ExportTab />}
      </div>
      {toast && <div className="toast">{toast}</div>}
      {(dlg === 'projects' || dlg === 'new' || dlg === 'photos') && <ProjectsDialog startOnNew={dlg === 'new'} startOnPhotos={dlg === 'photos' || (dlg === 'projects' && tab === 'photo')} onClose={() => setDlg(null)} />}
      {dlg === 'help' && <HelpDialog onClose={() => setDlg(null)} />}
      {dlg === 'tour' && <Tour onClose={() => { try { localStorage.setItem('chiken-tour-done', '1') } catch { /* */ } setDlg(null) }} />}
    </div>
  )
}
