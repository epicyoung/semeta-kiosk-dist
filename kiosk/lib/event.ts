import fs from 'fs'
import path from 'path'
import { localDb } from './local-db'
import { atomicWrite } from './disk-store'

/** "Fun Run!" → "fun-run"; empty/symbol-only input → "event" */
export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event'
}

function formatLocalDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/** eventFolder: "Fun Run!" + date → "fun-run-20260625" */
export function eventFolder(name: string, date = new Date()): string {
  const d = formatLocalDate(date)
  return `${slugify(name)}-${d}`
}

/** Zero-padded 3-digit sequence string */
export function padSeq(n: number): string {
  return String(n).padStart(3, '0')
}

// Local print files: always full-res. ponytail: no variant param — web-sized only lives
// in R2 (with its own _A/_B keys, a separate naming contract with the microsite).
/** fun-run-20260625-001-full-ori-semeta.jpg */
export function originalFilename(eventName: string, seq: string, date = new Date()): string {
  return `${sessionBase(eventName, date)}-${seq}-full-ori-semeta.jpg`
}

/** fun-run-20260625-001-full-ai-semeta.jpg */
export function aiFilename(eventName: string, seq: string, date = new Date()): string {
  return `${sessionBase(eventName, date)}-${seq}-full-ai-semeta.jpg`
}

/** fun-run-20260625-001-video-semeta.mp4 — final 2:3 video, frame+QR burned, local */
export function videoFilename(eventName: string, seq: string, date = new Date()): string {
  return `${sessionBase(eventName, date)}-${seq}-video-semeta.mp4`
}

function sessionBase(eventName: string, date: Date): string {
  const d = formatLocalDate(date)
  return `${slugify(eventName)}-${d}`
}

/** fun-run-20260707-001.webm — muted reaction clip, local only */
export function reactionFilename(eventName: string, stamp: string): string {
  const slug = slugify(eventName) || 'event'
  return `${slug}-${stamp}.webm`
}

/** Absolute dir for reaction clips. ponytail: flat dir, no per-event subfolder — local only, never uploaded */
export function reactionsDirPath(): string {
  return 'C:/semeta/reactions'
}

function getDataDir(): string {
  return localDb.getTemplateLocal()
}

/** Absolute path to an event's output folder: <dataDir>/event/<eventFolder>/ */
export function eventDirPath(eventFolder: string): string {
  return path.join(getDataDir(), 'event', eventFolder)
}

/**
 * Returns the next photo sequence number for a given event folder,
 * persisting it to disk so numbers never repeat across restarts.
 */
export function nextSeq(eventFolder: string): number {
  return reserveSequence(eventDirPath(eventFolder))
}

/** Synchronous reservation shared by capture and import in the single kiosk process.
 *  reservationId = idempotency key: retry dari job yang sama ga pernah alokasi nomor baru. */
export function reserveSequence(eventDir: string, reservationId?: string): number {
  const seqFile = path.join(eventDir, 'seq.json')

  let content: string
  try {
    content = fs.readFileSync(seqFile, 'utf8')
  } catch (err) {
    // Cuma file-belum-ada yang sah mulai dari 1. Error lain (file kekunci, disk
    // error) JANGAN di-reset — insiden 2026-09-12: seq balik ke 001 di tengah
    // event, tiap QR nunjuk foto -001 dan file R2 ketimpa foto tamu sebelumnya.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err
    fs.mkdirSync(eventDir, { recursive: true })
    atomicWrite(seqFile, JSON.stringify({ seq: 1, reservations: reservationId ? { [reservationId]: 1 } : {} }, null, 2))
    return 1
  }

  // File ada tapi isinya ngaco = jangan tebak. Mundur ke 1 bikin data hilang.
  const data = JSON.parse(content)
  if (!Number.isInteger(data?.seq) || data.seq < 1) {
    throw new Error(`seq.json rusak di ${seqFile}: seq=${JSON.stringify(data?.seq)}`)
  }

  if (reservationId && typeof data.reservations?.[reservationId] === 'number') return data.reservations[reservationId]
  const next = data.seq + 1
  if (next > 99_999_999) throw new Error('Nomor sesi habis')
  atomicWrite(seqFile, JSON.stringify({ seq: next, reservations: { ...data.reservations, ...(reservationId ? { [reservationId]: next } : {}) } }, null, 2))
  return next
}
