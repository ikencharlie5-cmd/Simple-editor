import { createStore, get, set, del, keys } from 'idb-keyval'

const blobs = createStore('chicken-studios-blobs', 'blobs')
const docs = createStore('chicken-studios-docs', 'docs')

export const saveBlob = (id: string, blob: Blob) => set(id, blob, blobs)
export const loadBlob = (id: string) => get<Blob>(id, blobs)
export const deleteBlob = (id: string) => del(id, blobs)
export const blobKeys = () => keys(blobs)

export const saveDoc = <T>(id: string, value: T) => set(id, value, docs)
export const loadDoc = <T>(id: string) => get<T>(id, docs)
