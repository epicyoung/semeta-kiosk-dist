import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { atomicWrite, readJson } from './disk-store'
import { GalleryStore, serialDisk } from './gallery-store'
import { eventFolder, padSeq, reserveSequence } from './event'
import { shareUrlFor } from './gallery'
import { smartFrame, validateImportPhoto, type FrameBytes } from './smart-frame'
import { localDb } from './local-db'
import { CloudUploadError, uploadImportedPhoto } from './server-upload'
import type { ImportBatch, ImportJob } from './fast-import-types'

type Upload = (bytes: Buffer, sessionId: string, eventName: string) => Promise<{ key: string; url: string; databaseRecorded?: boolean }>

/** One local process owns serial image work. Manifests survive browser and server restarts. */
export class ImportQueue {
  readonly gallery: GalleryStore
  private localBusy = false
  private uploadBusy = false
  private timer?: ReturnType<typeof setInterval>
  constructor(readonly root: string, private upload: Upload = uploadImportedPhoto) { this.gallery = new GalleryStore(path.join(root, 'event')) }
  private get directory() { return path.join(this.root, '.fast-import') }
  private jobPath(id: string) {
    if (!/^[a-f0-9]{40}$/.test(id)) throw new Error('Job tidak valid')
    return path.join(this.directory, 'jobs', `${id}.json`)
  }
  private batchPath(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Batch tidak valid')
    return path.join(this.directory, 'batches', id, 'batch.json')
  }
  private save(job: ImportJob): ImportJob {
    job.updatedAt = new Date().toISOString()
    atomicWrite(this.jobPath(job.id), JSON.stringify(job, null, 2))
    return job
  }
  private read(id: string): ImportJob {
    const job = readJson<ImportJob>(this.jobPath(id))
    if (!job || job.id !== id) throw new Error('Job tidak ditemukan')
    return job
  }
  jobs(): ImportJob[] {
    const dir = path.join(this.directory, 'jobs')
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter(f => /^[a-f0-9]{40}\.json$/.test(f)).flatMap(file => {
      const job = readJson<ImportJob>(path.join(dir, file))
      return job ? [job] : []
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  async createBatch(eventName: string, frames: FrameBytes[], warning?: string): Promise<ImportBatch> {
    if (!eventName.trim() || eventName === 'Demo Event') throw new Error('Atur nama event di Settings sebelum import')
    const batch: ImportBatch = { id: randomUUID(), eventId: eventFolder(eventName), eventName, createdAt: new Date().toISOString(), frames: [], warning }
    const dir = path.dirname(this.batchPath(batch.id))
    for (const [index, frame] of frames.entries()) {
      const file = `frame-${index}.png`
      atomicWrite(path.join(dir, file), frame.bytes)
      batch.frames.push({ id: frame.id, file })
    }
    atomicWrite(this.batchPath(batch.id), JSON.stringify(batch, null, 2))
    return batch
  }
  async ingest(batchId: string, sourceName: string, bytes: Buffer): Promise<ImportJob> {
    await validateImportPhoto(bytes)
    const batch = readJson<ImportBatch>(this.batchPath(batchId))
    if (!batch) throw new Error('Batch tidak ditemukan')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const id = createHash('sha256').update(`${batch.eventId}:${hash}`).digest('hex').slice(0, 40)
    return serialDisk(this.jobPath(id), async () => {
      const existing = readJson<ImportJob>(this.jobPath(id))
      if (existing) return existing
      const sourceFile = `${id}.source`
      atomicWrite(path.join(this.directory, 'sources', sourceFile), bytes)
      const seq = reserveSequence(this.gallery.eventDir(batch.eventId), id)
      return this.save({ id, batchId, eventId: batch.eventId, eventName: batch.eventName,
        sessionId: `${batch.eventId}-${padSeq(seq)}`, sourceName: path.basename(sourceName.replace(/\\/g, '/')).slice(0, 200),
        sourceFile, hash, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        status: 'queued', attempts: 0, warning: batch.warning })
    })
  }
  async processLocal(id: string): Promise<void> {
    const job = this.read(id)
    if (job.paused || !['queued', 'framing', 'failed_local'].includes(job.status)) return
    this.save({ ...job, status: 'framing', error: undefined })
    try {
      const batch = readJson<ImportBatch>(this.batchPath(job.batchId))
      if (!batch) throw new Error('Snapshot batch tidak ditemukan')
      const frames = batch.frames.map(frame => ({ id: frame.id, bytes: fs.readFileSync(path.join(path.dirname(this.batchPath(batch.id)), frame.file)) }))
      const result = await smartFrame(fs.readFileSync(path.join(this.directory, 'sources', job.sourceFile)), frames)
      const entry = await this.gallery.saveVariant({ sessionId: job.sessionId, eventName: job.eventName,
        image: result.image, recipe: 'single_4r', fit: result.fit, frameId: result.frameId, warning: result.warning,
        source: 'fast_import', sourceName: job.sourceName, importJobId: job.id,
        printSize: result.width > result.height ? '4R_LANDSCAPE' : '4R_PORTRAIT' })
      const variant = entry.variants!.at(-1)!
      const current = this.read(id) // Preserve pause/control updates during processing.
      this.save({ ...current, status: 'saved_local', variantId: variant.id, masterFile: variant.master_file,
        thumbnailFile: variant.thumbnail_file, warning: result.warning ?? job.warning, error: undefined })
    } catch (error) {
      this.save({ ...this.read(id), status: 'failed_local', error: error instanceof Error ? error.message : 'Gagal menyimpan foto' })
    }
  }
  async processUpload(id: string): Promise<void> {
    const job = this.read(id)
    if (job.paused || !['saved_local', 'upload_pending', 'uploading'].includes(job.status) || !job.masterFile) return
    this.save({ ...job, status: 'uploading', attempts: job.attempts + 1, error: undefined })
    try {
      const result = job.remote ?? await this.upload(fs.readFileSync(this.gallery.resolveFile(job.eventId, job.masterFile)), job.sessionId, job.eventName)
      this.save({ ...this.read(id), remote: result })
      const shareUrl = shareUrlFor(result.key)
      await this.gallery.saveShare({ sessionId: job.sessionId, eventName: job.eventName, shareUrl, key: result.key, m: 0, a: 0 })
      this.save({ ...this.read(id), status: 'ready', shareUrl, error: undefined, nextAttempt: undefined,
        warning: result.databaseRecorded === false ? `${job.warning ? `${job.warning} · ` : ''}QR siap; konfirmasi pencatatan database memerlukan patch Worker Fast Mode.` : job.warning })
    } catch (error) {
      const blocked = error instanceof CloudUploadError && error.status !== undefined && error.status >= 400 && error.status < 500
      const attempts = job.attempts + 1
      const delay = [5_000, 15_000, 60_000][Math.min(attempts - 1, 2)]
      this.save({ ...this.read(id), status: 'upload_pending', error: error instanceof Error ? error.message : 'Upload tertunda',
        nextAttempt: blocked ? undefined : Date.now() + delay })
    }
  }
  control(id: string, action: 'pause' | 'resume' | 'retry' | 'cancel'): ImportJob {
    const job = this.read(id)
    if (action === 'cancel') {
      if (job.status !== 'queued' && job.status !== 'failed_local') throw new Error('Hanya foto yang belum diproses dapat dibatalkan')
      return this.save({ ...job, status: 'cancelled' })
    }
    if (action === 'pause') return this.save({ ...job, paused: true })
    if (job.status === 'cancelled' || job.status === 'ready') return job
    return this.save({ ...job, paused: false, status: job.status === 'failed_local' ? 'queued' : job.status, nextAttempt: job.status === 'upload_pending' ? Date.now() : job.nextAttempt })
  }
  tick(): void {
    const jobs = this.jobs().reverse()
    if (!this.localBusy) {
      const next = jobs.find(j => !j.paused && ['queued', 'framing'].includes(j.status))
      if (next) {
        this.localBusy = true
        void this.processLocal(next.id).catch(error => console.error('[fast-import] local worker', error)).finally(() => { this.localBusy = false })
      }
    }
    if (!this.uploadBusy) {
      const next = jobs.find(j => !j.paused && (['saved_local', 'uploading'].includes(j.status) || (j.status === 'upload_pending' && j.nextAttempt !== undefined && j.nextAttempt <= Date.now())))
      if (next) {
        this.uploadBusy = true
        void this.processUpload(next.id).catch(error => console.error('[fast-import] upload worker', error)).finally(() => { this.uploadBusy = false })
      }
    }
  }
  start(): void {
    if (this.timer) return
    this.tick()
    this.timer = setInterval(() => { try { this.tick() } catch (error) { console.error('[fast-import] queue read', error) } }, 1000)
    this.timer.unref()
  }
  stop(): void { clearInterval(this.timer); this.timer = undefined }
}

const globalQueue = globalThis as typeof globalThis & { __fastImportQueue?: ImportQueue }
export function getImportQueue(): ImportQueue {
  const root = localDb.getTemplateLocal()
  if (!globalQueue.__fastImportQueue || globalQueue.__fastImportQueue.root !== root) {
    globalQueue.__fastImportQueue?.stop()
    globalQueue.__fastImportQueue = new ImportQueue(root)
  }
  return globalQueue.__fastImportQueue
}
export function startImportWorker(): void { getImportQueue().start() }
