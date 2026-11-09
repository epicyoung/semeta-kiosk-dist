import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { atomicWrite, readJson } from './disk-store'
import { isSafeGalleryFile, isGalleryEntry, sessionIdentity, type GalleryEntry, type GalleryVariant } from './gallery'
import { localDb } from './local-db'

const state = globalThis as typeof globalThis & { __galleryLocks?: Map<string, Promise<unknown>> }
const locks = state.__galleryLocks ??= new Map()
export function serialDisk<T>(key: string, work: () => Promise<T>): Promise<T> {
  const result = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(work)
  locks.set(key, result)
  void result.then(() => { if (locks.get(key) === result) locks.delete(key) }, () => { if (locks.get(key) === result) locks.delete(key) })
  return result
}

export type VariantInput = {
  sessionId: string; eventName: string; image: Buffer; sheet?: Buffer
  recipe: GalleryVariant['recipe']; printSize?: GalleryVariant['print_size']; fit?: GalleryVariant['fit']
  label?: string; frameId?: string | null; warning?: string
  source?: GalleryEntry['source']; sourceName?: string; importJobId?: string
}

export class GalleryStore {
  constructor(readonly root: string) {}
  eventDir(eventId: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,180}$/.test(eventId)) throw new Error('Event tidak valid')
    const dir = path.join(this.root, eventId)
    if (fs.existsSync(dir)) {
      const relative = path.relative(fs.realpathSync(this.root), fs.realpathSync(dir))
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path di luar root event')
    }
    return dir
  }
  resolveFile(eventId: string, file: string): string {
    if (!isSafeGalleryFile(file)) throw new Error('Nama file tidak valid')
    const dir = this.eventDir(eventId)
    const result = path.join(dir, file)
    if (fs.existsSync(result)) {
      const relative = path.relative(fs.realpathSync(dir), fs.realpathSync(result))
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path di luar event')
    }
    return result
  }
  private metadataPath(sessionId: string): string {
    const { eventId, seq } = sessionIdentity(sessionId)
    return path.join(this.eventDir(eventId), '.gallery', `${seq}.json`)
  }
  private entry(sessionId: string, eventName: string): GalleryEntry {
    const { eventId, seq } = sessionIdentity(sessionId)
    return { seq, created_at: new Date().toISOString(), thumb_path: '', print_path: '',
      ...readJson<GalleryEntry>(this.metadataPath(sessionId)), schema_version: 2, event_id: eventId,
      event_name: eventName, session_id: sessionId, updated_at: new Date().toISOString() }
  }
  saveShare(input: { sessionId: string; eventName: string; shareUrl: string; key?: string; m?: number; a?: number }): Promise<GalleryEntry> {
    return serialDisk(this.metadataPath(input.sessionId), async () => {
      if (!['https:', 'http:'].includes(new URL(input.shareUrl).protocol)) throw new Error('URL QR tidak valid')
      const entry = this.entry(input.sessionId, input.eventName)
      entry.share_url = input.shareUrl
      if (input.key) entry.r2_key_b = input.key
      if (input.m !== undefined) entry.m = input.m
      if (input.a !== undefined) entry.a = input.a
      atomicWrite(this.metadataPath(input.sessionId), JSON.stringify(entry, null, 2))
      return entry
    })
  }
  saveVariant(input: VariantInput): Promise<GalleryEntry> {
    return serialDisk(this.metadataPath(input.sessionId), async () => {
      const { eventId } = sessionIdentity(input.sessionId)
      const meta = await sharp(input.image, { limitInputPixels: 80_000_000 }).metadata()
      if (!['jpeg', 'png'].includes(meta.format ?? '') || !meta.width || !meta.height) throw new Error('Bukan foto JPEG/PNG yang valid')
      const id = createHash('sha256').update(input.image).update(input.sheet ?? '').update(JSON.stringify([input.recipe, input.printSize, input.fit])).digest('hex').slice(0, 20)
      const stem = `${input.sessionId}-${id}`
      const masterFile = `${stem}-print.${meta.format === 'png' ? 'png' : 'jpg'}`
      const thumbnailFile = `${stem}-thumb.jpg`
      atomicWrite(this.resolveFile(eventId, masterFile), input.image)
      const thumbnail = await sharp(input.image).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer()
      atomicWrite(this.resolveFile(eventId, thumbnailFile), thumbnail)
      let sheetFile: string | undefined
      if (input.sheet) {
        const sheet = await sharp(input.sheet).jpeg({ quality: 100 }).toBuffer()
        sheetFile = `${stem}-sheet.jpg`
        atomicWrite(this.resolveFile(eventId, sheetFile), sheet)
      }
      const entry = this.entry(input.sessionId, input.eventName)
      const previous = entry.variants?.find(v => v.id === id)
      const variant: GalleryVariant = { id, created_at: previous?.created_at ?? new Date().toISOString(),
        label: input.label ?? input.printSize ?? 'Foto', master_file: masterFile,
        thumbnail_file: thumbnailFile, sheet_2up_file: sheetFile, width: meta.width, height: meta.height,
        print_size: input.printSize ?? (meta.width > meta.height ? '4R_LANDSCAPE' : '4R_PORTRAIT'),
        recipe: input.recipe, fit: input.fit, frame_id: input.frameId, warning: input.warning }
      entry.variants = [...(entry.variants ?? []).filter(v => v.id !== id), variant]
      entry.print_path = masterFile; entry.thumb_path = thumbnailFile
      entry.source = input.source ?? entry.source ?? 'camera'
      entry.source_name = input.sourceName ?? entry.source_name
      entry.import_job_id = input.importJobId ?? entry.import_job_id
      atomicWrite(this.metadataPath(input.sessionId), JSON.stringify(entry, null, 2))
      return entry
    })
  }
  list(eventId: string, options: { cursor?: string; limit?: number; seq?: string } = {}): { entries: GalleryEntry[]; next_cursor: string | null; skipped: number } {
    const metadataDir = path.join(this.eventDir(eventId), '.gallery')
    if (!fs.existsSync(metadataDir)) return { entries: [], next_cursor: null, skipped: 0 }
    let skipped = 0
    const entries: GalleryEntry[] = []
    for (const name of fs.readdirSync(metadataDir).filter(f => /^\d{1,8}\.json$/.test(f))) {
      const entry = readJson<unknown>(path.join(metadataDir, name))
      if (!isGalleryEntry(entry)) { skipped++; continue }
      if (!entry.print_path) continue
      const master = entry.print_path.split(/[\\/]/).pop() ?? ''
      const thumb = entry.thumb_path?.split(/[\\/]/).pop() ?? master
      if (!isSafeGalleryFile(master) || !isSafeGalleryFile(thumb)) { skipped++; continue }
      entries.push({ ...entry, event_id: eventId, session_id: entry.session_id ?? `${eventId}-${entry.seq}`, print_path: master, thumb_path: thumb })
    }
    entries.sort((a, b) => b.seq.padStart(8, '0').localeCompare(a.seq.padStart(8, '0')))
    const filtered = entries.filter(e => (!options.seq || e.seq.includes(options.seq)) && (!options.cursor || Number(e.seq) < Number(options.cursor)))
    const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 48) || 48))
    const page = filtered.slice(0, limit)
    return { entries: page, next_cursor: filtered.length > limit ? page.at(-1)!.seq : null, skipped }
  }
  events(): { id: string; name: string }[] {
    if (!fs.existsSync(this.root)) return []
    return fs.readdirSync(this.root, { withFileTypes: true }).filter(d => d.isDirectory() && /^[a-z0-9][a-z0-9-]{0,180}$/.test(d.name))
      .map(d => ({ id: d.name, name: d.name })).sort((a, b) => b.id.localeCompare(a.id))
  }
}

export function getGalleryStore(): GalleryStore { return new GalleryStore(path.join(localDb.getTemplateLocal(), 'event')) }
