import { useState } from 'react'
import { Modal } from './controls'

const SHORTCUTS: { tab: string; rows: [string, string][] }[] = [
  { tab: 'Everywhere', rows: [['Alt+1 … Alt+5', 'Switch tabs (Photo, Video, Audio, Animator, Export)'], ['?', 'Open this help'], ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo']] },
  { tab: 'Video', rows: [['Space', 'Play / pause'], ['S or Ctrl+B', 'Split at playhead'], ['Del / Shift+Del', 'Delete / ripple delete'], ['Ctrl+D', 'Duplicate clip'], ['M', 'Add marker'], ['F', 'Freeze frame'], ['← / →', 'Step one frame (Shift = 1 second)'], ['Home / End', 'Go to start / end']] },
  { tab: 'Photo', rows: [['V M L W C K I J B S Y E G O P T A U H R Z', 'Tools (Shift+key cycles the group)'], ['Space (hold)', 'Hand / pan'], ['[ and ]', 'Brush size'], ['0–9', 'Opacity'], ['D / X', 'Default / swap colours'], ['Q', 'Quick mask'], ['F', 'Screen mode'], ['Ctrl+T', 'Free transform'], ['Ctrl+J', 'Layer via copy'], ['Ctrl+E', 'Merge down'], ['Ctrl+A / Ctrl+D / Ctrl+Shift+I', 'Select all / deselect / inverse'], ['Ctrl+0 / Ctrl+1', 'Fit / 100%'], ['Enter / Esc', 'Apply / cancel crop, transform or path'], ['Alt+click (brush tools)', 'Pick colour'], ['Alt+click (clone / heal)', 'Set source']] },
  { tab: 'Animator', rows: [['Space', 'Play / pause'], ['← / →', 'Step one frame'], ['V / B / E', 'Select / brush / eraser'], [', and .', 'Previous / next drawing'], ['Del', 'Delete selected key or layer']] },
]

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Help & keyboard shortcuts" onClose={onClose}>
      <div style={{ maxWidth: 720 }}>
        {SHORTCUTS.map((s) => (
          <div key={s.tab} style={{ marginBottom: 12 }}>
            <b>{s.tab}</b>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
              <tbody>{s.rows.map(([k, d]) => (
                <tr key={k} style={{ borderTop: '1px solid var(--line)' }}><td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}><code>{k}</code></td><td style={{ padding: '4px 8px' }} className="muted">{d}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ))}
        <div className="hint">Tips: right-click or long-press a Photo toolbar button to see every tool in its group. Your work autosaves on this device; use Export → Project file for backups.</div>
      </div>
    </Modal>
  )
}

const STEPS: { icon: string; title: string; body: string }[] = [
  { icon: '🐔', title: 'Welcome to Chiken', body: 'A photo editor, video editor, audio studio and animator in one app. Everything runs on your Chromebook and saves automatically.' },
  { icon: '🖼', title: 'Photo', body: 'Photoshop-style editing with layers, masks, adjustment layers, layer styles, 70+ tools and AI-style retouching. Press a tool letter like B for brush; Shift+letter switches between related tools.' },
  { icon: '🎬', title: 'Video', body: 'Drop clips onto the timeline, split with S, add text, stickers, filters, transitions, speed curves, captions and background removal. Drag the corners in the preview to resize.' },
  { icon: '🎵', title: 'Audio', body: 'Import songs, use built-in sounds, record voiceovers, add voice effects, clean up noise, and auto-duck music under speech.' },
  { icon: '✨', title: 'Animator', body: 'Keyframe motion graphics, frame-by-frame drawing, motion paths and tracking over video. Click "Send to video editor" to drop it straight into your video.' },
  { icon: '⬇', title: 'Export', body: 'Save MP4, WebM, MOV, GIF, PNG, MP3 and more. Press ? any time to see keyboard shortcuts. Have fun!' },
]

export function Tour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0)
  const s = STEPS[i]
  return (
    <Modal title={`Quick tour · ${i + 1} of ${STEPS.length}`} onClose={onClose}>
      <div style={{ textAlign: 'center', maxWidth: 440, padding: '6px 10px' }}>
        <div style={{ fontSize: 56 }}>{s.icon}</div>
        <h2 style={{ margin: '6px 0' }}>{s.title}</h2>
        <p className="muted" style={{ lineHeight: 1.5 }}>{s.body}</p>
        <div className="row" style={{ justifyContent: 'center', gap: 6, marginBottom: 10 }}>{STEPS.map((_, k) => <span key={k} style={{ width: 8, height: 8, borderRadius: 4, background: k === i ? 'var(--accent)' : 'var(--line)' }} />)}</div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button onClick={onClose}>Skip</button>
          <div className="row">
            {i > 0 && <button onClick={() => setI(i - 1)}>Back</button>}
            <button className="primary" onClick={() => (i < STEPS.length - 1 ? setI(i + 1) : onClose())}>{i < STEPS.length - 1 ? 'Next' : "Let's go!"}</button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
