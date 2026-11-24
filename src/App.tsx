import { useEffect } from 'react'
import { useStore, initPersistence, newProject, type Tab } from './core/store'
import { usePhoto } from './photo/doc'
import { PhotoEditor } from './photo/PhotoEditor'
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

  useEffect(() => { void initPersistence() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey) return
      const i = ['1', '2', '3', '4', '5'].indexOf(e.key)
      if (i >= 0) { e.preventDefault(); useStore.getState().setTab(TABS[i].id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!loaded) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>Loading Chicken Studios…</div>

  return (
    <div className={'app ' + (tab === 'photo' && screenMode === 2 ? 'screen-full' : '')}>
      <div className="topbar">
        <div className="brand"><img src="./favicon.svg" alt="" />Chicken Studios</div>
        <div className="tabs">
          {TABS.map((t, i) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} title={`Alt+${i + 1}`} onClick={() => useStore.getState().setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <span className="spacer" />
        <input className="project-name" value={name} onChange={(e) => useStore.getState().update((p) => { p.name = e.target.value }, false)} />
        <span className="save-status">{saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'saving' ? 'Saving…' : '● Unsaved'}</span>
        <button onClick={() => { if (confirm('Start a new video project? Your current project is saved; export a project file first if you want to keep a copy.')) useStore.getState().replaceProject(newProject()) }}>New project</button>
      </div>
      <div className="main">
        {tab === 'photo' && <PhotoEditor />}
        {tab === 'video' && <VideoEditor />}
        {tab === 'audio' && <AudioTab />}
        {tab === 'animator' && <Animator />}
        {tab === 'export' && <ExportTab />}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
