import { localDb } from './local-db'
import { prepareR2Photo } from './photo-resolution'

export class CloudUploadError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

/** Same Worker contract for browser uploads and persistent background import jobs. */
export async function uploadMultipartToWorker(form: FormData): Promise<{ url: string; key: string; databaseRecorded?: boolean }> {
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL
  if (!workerUrl) throw new CloudUploadError('Worker URL belum dikonfigurasi', 500)
  const secret = localDb.getSecret()
  if (!secret) throw new CloudUploadError('Cloud belum dikonfigurasi: isi kiosk secret di Settings', 401)
  if (form.get('type') !== 'C') {
    const file = form.get('file')
    if (!file || typeof file === 'string') throw new CloudUploadError('Photo file required', 400)
    const bytes = await prepareR2Photo(Buffer.from(await file.arrayBuffer()))
    form.set('file', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), file.name || 'photo.jpg')
  }
  const res = await fetch(`${workerUrl}/api/upload`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: form, signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new CloudUploadError(`Upload Worker ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status)
  const data = await res.json()
  if (typeof data.url !== 'string' || typeof data.key !== 'string' || !data.key || !/^https?:\/\//.test(data.url)) throw new CloudUploadError('Respons upload tidak valid')
  return { url: data.url, key: data.key, databaseRecorded: data.database_recorded === true }
}

export async function uploadImportedPhoto(bytes: Buffer, sessionId: string, eventName: string) {
  const form = new FormData()
  form.set('type', 'B'); form.set('session_id', sessionId); form.set('event_name', eventName); form.set('m_count', '0')
  form.set('source', 'fast_import')
  form.set('file', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), `${sessionId}.jpg`)
  return uploadMultipartToWorker(form)
}
