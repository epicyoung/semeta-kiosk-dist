import fs from 'fs'
import path from 'path'

/** eventFolder: "Fun Run!" + date → "fun-run-20260625" */
export function eventFolder(name: string, date = new Date()): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event'
  const d = date.toISOString().slice(0, 10).replace(/-/g, '')
  return `${slug}-${d}`
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

function sessionBase(eventName: string, date: Date): string {
  const slug = eventName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event'
  const d = date.toISOString().slice(0, 10).replace(/-/g, '')
  return `${slug}-${d}`
}

function getDataDir(): string {
  const CONFIG_PATH = path.join(process.cwd(), 'semeta.config.json')
  const DEFAULT_DIR = 'C:/semeta'
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    if (cfg.template_local) return path.resolve(cfg.template_local)
  } catch {}
  return path.resolve(process.env.TEMPLATE_LOCAL ?? DEFAULT_DIR)
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
  const eventDir = eventDirPath(eventFolder)
  const seqFile = path.join(eventDir, 'seq.json')

  try {
    const content = fs.readFileSync(seqFile, 'utf8')
    const data = JSON.parse(content)
    const next = data.seq + 1
    fs.writeFileSync(seqFile, JSON.stringify({ seq: next }, null, 2))
    return next
  } catch {
    fs.mkdirSync(eventDir, { recursive: true })
    fs.writeFileSync(seqFile, JSON.stringify({ seq: 1 }, null, 2))
    return 1
  }
}
