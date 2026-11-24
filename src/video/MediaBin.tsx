import { useEffect, useState } from 'react'
import { useStore } from '../core/store'
import { getUrl, importFile, pickFiles } from '../core/media'
import type { MediaItem, MediaKind } from '../core/types'
import { fmtTime } from '../ui/controls'

function Thumb({ m }: { m: MediaItem }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => { if (m.kind === 'image' || m.kind === 'video') void getUrl(m.id).then(setUrl) }, [m.id, m.kind])
  if (m.kind === 'image' && url) return <img src={url} alt="" />
  if (m.kind === 'video' && url) return <video src={url + '#t=0.5'} muted preload="metadata" />
  return <span>{m.kind === 'audio' ? '🎵' : m.kind === 'animation' ? '🐔' : '📄'}</span>
}

export async function importFiles(files: File[]) {
  const st = useStore.getState()
  let n = 0
  for (const f of files) {
    st.notify(`Importing ${f.name}…`)
    const m = await importFile(f)
    if (m) { useStore.getState().addMedia(m); n++ }
    else st.notify(`Unsupported file: ${f.name}`)
  }
  if (n) st.notify(`Imported ${n} file${n > 1 ? 's' : ''}`)
}

export function MediaBin({ kinds, accept }: { kinds?: MediaKind[]; accept?: string }) {
  const media = useStore((s) => s.project.media)
  const [over, setOver] = useState(false)
  const items = media.filter((m) => !kinds || kinds.includes(m.kind))
  return (
    <div onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void importFiles(Array.from(e.dataTransfer.files)) }}>
      <div className={'dropzone ' + (over ? 'over' : '')}>
        <button className="primary" onClick={async () => importFiles(await pickFiles(accept ?? 'video/*,image/*,audio/*'))}>＋ Import media</button>
        <div className="hint" style={{ marginTop: 6 }}>or drop files here. Drag items onto the timeline.</div>
      </div>
      <div className="bin">
        {items.map((m) => (
          <div key={m.id} className="bin-item" draggable title={m.name}
            onDragStart={(e) => { e.dataTransfer.setData('application/x-media', m.id); e.dataTransfer.effectAllowed = 'copy' }}
            onDoubleClick={() => useStore.getState().addClipFromMedia(m)}>
            <div className="bin-thumb"><Thumb m={m} /></div>
            <div className="bin-name">{m.name}</div>
            {m.kind !== 'image' && <span className="bin-dur">{fmtTime(m.duration).slice(0, -3)}</span>}
            <button className="bin-add primary" title="Add at playhead" onClick={() => useStore.getState().addClipFromMedia(m)}>＋</button>
          </div>
        ))}
      </div>
      {!items.length && <div className="hint" style={{ padding: 10 }}>No media yet.</div>}
    </div>
  )
}
