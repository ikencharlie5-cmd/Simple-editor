import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { AnimationDoc, Clip, ClipKind, MediaItem, Project, Track, TrackKind } from './types'
import { DEFAULT_FILTERS, DEFAULT_TEXT_STYLE, DEFAULT_TRANSFORM } from './types'
import { loadDoc, saveDoc } from './db'

export type Tab = 'photo' | 'video' | 'audio' | 'animator' | 'export'

export function newTrack(kind: TrackKind, n: number): Track {
  const label = kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : 'Text'
  return { id: nanoid(8), kind, name: `${label} ${n}`, muted: false, hidden: false, locked: false, volume: 1 }
}

export function newProject(): Project {
  return {
    id: nanoid(10),
    name: 'Untitled project',
    width: 1920,
    height: 1080,
    fps: 30,
    background: '#000000',
    tracks: [newTrack('text', 1), newTrack('video', 2), newTrack('video', 1), newTrack('audio', 1)],
    clips: [],
    media: [],
    animations: [],
    updatedAt: Date.now(),
  }
}

export function makeClip(kind: ClipKind, trackId: string, start: number, duration: number, extra: Partial<Clip> = {}): Clip {
  return {
    id: nanoid(8),
    trackId,
    kind,
    name: kind,
    start,
    duration,
    inPoint: 0,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    transform: { ...DEFAULT_TRANSFORM },
    filters: { ...DEFAULT_FILTERS },
    filterPreset: 'none',
    transitionIn: { type: 'none', duration: 0.5 },
    animIn: 'none',
    animOut: 'none',
    animLoop: 'none',
    fit: 'contain',
    ...(kind === 'text' ? { text: 'Your text', textStyle: { ...DEFAULT_TEXT_STYLE } } : {}),
    ...extra,
  }
}

export const clipEnd = (c: Clip) => c.start + c.duration
export const projectDuration = (p: Project) => p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)

interface State {
  project: Project
  tab: Tab
  playhead: number
  playing: boolean
  selectedClipIds: string[]
  past: string[]
  future: string[]
  loaded: boolean
  saveStatus: 'saved' | 'saving' | 'unsaved'
  toast: string | null
  setTab: (t: Tab) => void
  setPlayhead: (t: number) => void
  setPlaying: (p: boolean) => void
  select: (ids: string[]) => void
  /** Apply a mutation with undo support. */
  update: (fn: (p: Project) => void, undoable?: boolean) => void
  checkpoint: () => void
  undo: () => void
  redo: () => void
  addMedia: (m: MediaItem) => void
  addClipFromMedia: (m: MediaItem, at?: number, trackId?: string) => string | null
  upsertAnimation: (a: AnimationDoc) => void
  replaceProject: (p: Project) => void
  notify: (msg: string) => void
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

export const useStore = create<State>((set, get) => ({
  project: newProject(),
  tab: 'video',
  playhead: 0,
  playing: false,
  selectedClipIds: [],
  past: [],
  future: [],
  loaded: false,
  saveStatus: 'saved',
  toast: null,
  setTab: (tab) => set({ tab, playing: false }),
  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  setPlaying: (playing) => set({ playing }),
  select: (ids) => set({ selectedClipIds: ids }),
  checkpoint: () => {
    const { project, past } = get()
    set({ past: [...past.slice(-80), JSON.stringify(project)], future: [] })
  },
  update: (fn, undoable = true) => {
    const { project, past } = get()
    const next = clone(project)
    fn(next)
    next.updatedAt = Date.now()
    set({
      project: next,
      saveStatus: 'unsaved',
      ...(undoable ? { past: [...past.slice(-80), JSON.stringify(project)], future: [] } : {}),
    })
  },
  undo: () => {
    const { past, project, future } = get()
    if (!past.length) return
    const prev = JSON.parse(past[past.length - 1])
    set({ project: prev, past: past.slice(0, -1), future: [JSON.stringify(project), ...future], saveStatus: 'unsaved' })
  },
  redo: () => {
    const { past, project, future } = get()
    if (!future.length) return
    const next = JSON.parse(future[0])
    set({ project: next, future: future.slice(1), past: [...past, JSON.stringify(project)], saveStatus: 'unsaved' })
  },
  addMedia: (m) => get().update((p) => { p.media.push(m) }, false),
  addClipFromMedia: (m, at, trackId) => {
    const { project, playhead } = get()
    const start = at ?? playhead
    const wantKind: TrackKind = m.kind === 'audio' ? 'audio' : 'video'
    const dur = m.kind === 'image' ? 5 : m.duration || 5
    let track = trackId ? project.tracks.find((t) => t.id === trackId && t.kind === wantKind) : undefined
    // find a track of the right kind free in [start, start+dur]
    if (!track) {
      track = project.tracks.find(
        (t) => t.kind === wantKind && !project.clips.some((c) => c.trackId === t.id && c.start < start + dur && clipEnd(c) > start),
      )
    }
    let newTrackObj: Track | null = null
    if (!track) {
      newTrackObj = newTrack(wantKind, project.tracks.filter((t) => t.kind === wantKind).length + 1)
      track = newTrackObj
    }
    const kind: ClipKind = m.kind === 'animation' ? 'animation' : m.kind
    const clip = makeClip(kind, track.id, start, dur, { mediaId: m.id, name: m.name })
    get().update((p) => {
      if (newTrackObj) {
        if (wantKind === 'audio') p.tracks.push(newTrackObj)
        else p.tracks.splice(p.tracks.findIndex((t) => t.kind === 'video'), 0, newTrackObj)
      }
      p.clips.push(clip)
    })
    set({ selectedClipIds: [clip.id] })
    return clip.id
  },
  upsertAnimation: (a) =>
    get().update((p) => {
      const i = p.animations.findIndex((x) => x.id === a.id)
      if (i >= 0) p.animations[i] = clone(a)
      else p.animations.push(clone(a))
      const m = p.media.find((x) => x.animationId === a.id)
      if (m) { m.duration = a.duration; m.width = a.width; m.height = a.height; m.name = a.name }
    }, false),
  replaceProject: (p) => set({ project: p, past: [], future: [], selectedClipIds: [], playhead: 0, saveStatus: 'unsaved' }),
  notify: (msg) => {
    set({ toast: msg })
    setTimeout(() => { if (get().toast === msg) set({ toast: null }) }, 3500)
  },
}))

/* ---------- Autosave ---------- */
let saveTimer: ReturnType<typeof setTimeout> | undefined
export async function initPersistence() {
  const lastId = await loadDoc<string>('current-project')
  if (lastId) {
    const p = await loadDoc<Project>('project:' + lastId)
    if (p) useStore.setState({ project: p })
  }
  useStore.setState({ loaded: true, saveStatus: 'saved' })
  useStore.subscribe((s, prev) => {
    if (s.project === prev.project) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      useStore.setState({ saveStatus: 'saving' })
      const p = useStore.getState().project
      await saveDoc('project:' + p.id, p)
      await saveDoc('current-project', p.id)
      useStore.setState({ saveStatus: 'saved' })
    }, 1200)
  })
}
