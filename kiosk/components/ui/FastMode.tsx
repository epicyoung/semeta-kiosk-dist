'use client'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ImportJob } from '@/lib/fast-import-types'
import { galleryImageUrl } from '@/lib/gallery'
import { isDedicatedUpload, isExternalFileDrag } from '@/lib/file-drop'
import { useModalFocus } from '@/lib/use-modal-focus'
import { galleryArchiveQueue, emptyArchiveTasks } from '@/lib/gallery-archive-queue'
import { GalleryPanel } from './GalleryPanel'
import './photo-tools.css'

const statuses: Record<ImportJob['status'], string> = {
  queued: 'Menunggu frame', framing: 'Memproses frame…', saved_local: 'Siap cetak · menunggu upload',
  uploading: 'Mengunggah…', upload_pending: 'Siap cetak · QR tertunda', ready: 'Siap cetak + QR',
  failed_local: 'Gagal memproses', cancelled: 'Dibatalkan',
}
async function jsonRequest(url: string, options?: RequestInit) {
  const response = await fetch(url, options)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Request gagal')
  return data
}

export function FastMode({ children, eventName }: { children: ReactNode; eventName: string }) {
  const [dragging, setDragging] = useState(false)
  const [open, setOpen] = useState(false)
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const [receiving, setReceiving] = useState('')
  const [pollError, setPollError] = useState('')
  const [galleryJob, setGalleryJob] = useState<ImportJob | null>(null)
  const archiveTasks = useSyncExternalStore(galleryArchiveQueue.subscribe, galleryArchiveQueue.snapshot, () => emptyArchiveTasks)
  const archiveFailures = archiveTasks.filter(task => task.status === 'failed')
  const input = useRef<HTMLInputElement>(null)
  const depth = useRef(0)
  const intake = useRef<{ files: File[]; batch: Promise<string> }[]>([])
  const ingesting = useRef(false)
  const alive = useRef(true)
  const refreshJobs = useCallback(async () => {
    try { const data = await jsonRequest('/api/fast-import'); if (alive.current) { setJobs(data.jobs); setPollError('') } }
    catch (error) { if (alive.current) setPollError(error instanceof Error ? error.message : 'Gagal membaca antrean') }
  }, [])

  useEffect(() => {
    alive.current = true
    void refreshJobs()
    const timer = setInterval(() => { void refreshJobs() }, 3000)
    return () => { alive.current = false; clearInterval(timer) }
  }, [refreshJobs])

  const addProblem = useCallback((message: string) => setProblems(old => [...old.slice(-99), message]), [])
  const receiveFiles = useCallback((files: File[]) => {
    if (!files.length) { setOpen(true); addProblem('Tidak ada file foto. Folder tidak didukung; pilih file JPEG/PNG di dalamnya.'); return }
    setOpen(true)
    // Snapshot starts immediately for each drop; file transfer itself remains sequential.
    const batch = jsonRequest('/api/fast-import/batch', { method: 'POST' }).then(data => data.batch.id as string)
    void batch.catch(() => {}) // The intake loop reports this error, including queued batches.
    intake.current.push({ files, batch })
    if (ingesting.current) return
    ingesting.current = true
    void (async () => {
      while (intake.current.length) {
        const next = intake.current.shift()!
        let batchId: string
        try { setReceiving('Menyiapkan event dan frame…'); batchId = await next.batch }
        catch (error) { addProblem(`Batch ${next.files.length} foto: ${String(error)}`); continue }
        for (const [index, file] of next.files.entries()) {
          if (file.size > 50 * 1024 * 1024) { addProblem(`${file.name}: melebihi 50 MiB`); continue }
          setReceiving(`Menerima ${index + 1}/${next.files.length}: ${file.name}`)
          const form = new FormData(); form.set('batch_id', batchId); form.set('file', file)
          try { await jsonRequest('/api/fast-import', { method: 'POST', body: form }); await refreshJobs() }
          catch (error) { addProblem(`${file.name}: ${error instanceof Error ? error.message : 'gagal diterima, drop ulang file ini'}`) }
        }
      }
    })().finally(() => { ingesting.current = false; if (alive.current) setReceiving('') })
  }, [addProblem, refreshJobs])

  useEffect(() => {
    const enter = (event: DragEvent) => {
      if (!isExternalFileDrag(event.dataTransfer) || isDedicatedUpload(event.target) || event.defaultPrevented) return
      event.preventDefault(); depth.current++; setDragging(true)
    }
    const over = (event: DragEvent) => {
      if (!isExternalFileDrag(event.dataTransfer)) return
      if (isDedicatedUpload(event.target) || event.defaultPrevented) { setDragging(false); return }
      event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; setDragging(true)
    }
    const leave = () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false) }
    const drop = (event: DragEvent) => {
      depth.current = 0; setDragging(false)
      if (!isExternalFileDrag(event.dataTransfer) || isDedicatedUpload(event.target) || event.defaultPrevented) return
      event.preventDefault(); receiveFiles(Array.from(event.dataTransfer?.files ?? []))
    }
    const end = () => { depth.current = 0; setDragging(false) }
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave); window.addEventListener('drop', drop); window.addEventListener('dragend', end)
    return () => {
      window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); window.removeEventListener('dragend', end)
    }
  }, [receiveFiles])

  async function control(id: string, action: string) {
    try {
      await jsonRequest('/api/fast-import', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) })
      await refreshJobs()
    } catch (error) { addProblem(String(error)) }
  }
  const pending = jobs.filter(job => !['ready', 'cancelled'].includes(job.status)).length
  return <>{children}
    <input ref={input} type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" multiple hidden onChange={event => { receiveFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
    {dragging && <div className="fast-drop" aria-hidden="true"><div><strong>Lepas foto untuk Fast Mode</strong><p>Frame otomatis sesuai orientasi · satu QR per foto</p></div></div>}
    {!galleryJob && <button className="fast-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open}>Fast Mode{pending ? ` · ${pending} tertunda` : ''}{receiving ? ' · menerima…' : ''}{archiveFailures.length ? ` · ${archiveFailures.length} gagal simpan` : ''}</button>}
    {open && !galleryJob && <QueuePanel onClose={() => setOpen(false)}>
      <p>{eventName} · {jobs.filter(job => job.status === 'ready').length} siap QR · {pending} tertunda</p>
      <div className="fast-panel-actions"><button onClick={() => input.current?.click()}>Tambah Foto</button><button onClick={() => void refreshJobs()}>Refresh</button>
        <button onClick={() => { for (const job of jobs.filter(j => !['ready', 'cancelled'].includes(j.status))) void control(job.id, job.paused ? 'resume' : 'pause') }}>Jeda / lanjut antrean</button></div>
      {receiving && <p role="status">{receiving}<br />File baru aman dilanjutkan setelah muncul dalam antrean di bawah.</p>}
      {pollError && <p role="alert">{pollError}</p>}
      {archiveTasks.map(task => <div key={task.id} className="photo-notice"><p>{task.label}: {task.status === 'saving' ? 'Menyimpan galeri…' : task.error}</p>
        {task.status === 'failed' && <button onClick={() => void galleryArchiveQueue.retry(task.id).catch(() => {})}>Simpan ulang hasil ini</button>}</div>)}
      {!!problems.length && <div role="alert" className="photo-error">{problems.map((problem, index) => <p key={index}>{problem}</p>)}<button onClick={() => setProblems([])}>Tutup pesan</button></div>}
      {!jobs.length && !receiving && <p>Drag foto dari Finder/Explorer ke halaman mana pun, atau pilih Tambah Foto. Jika frame seorientasi belum ada, foto memakai original tanpa frame.</p>}
      {jobs.map(job => <div className="fast-job" key={job.id}>
        {job.thumbnailFile && <img src={galleryImageUrl(job.eventId, job.thumbnailFile)} alt="" loading="lazy" />}
        <div className="fast-job-body"><strong>{job.sourceName}</strong><p>{job.paused ? 'Dijeda · ' : ''}{statuses[job.status]}</p>
          {job.warning && <small>{job.warning}</small>}{job.error && <small>{job.error}</small>}
          {job.masterFile && <button onClick={() => { setOpen(false); setGalleryJob(job) }}>Buka foto / QR / cetak</button>}
          {['upload_pending', 'failed_local'].includes(job.status) && <button onClick={() => void control(job.id, 'retry')}>Coba lagi</button>}
          {!['ready', 'cancelled'].includes(job.status) && <button onClick={() => void control(job.id, job.paused ? 'resume' : 'pause')}>{job.paused ? 'Lanjutkan' : 'Jeda'}</button>}
          {['queued', 'failed_local'].includes(job.status) && <button onClick={() => void control(job.id, 'cancel')}>Batalkan</button>}
        </div>
      </div>)}
    </QueuePanel>}
    {galleryJob && <GalleryPanel eventName={galleryJob.eventName} guest initialEventId={galleryJob.eventId} initialSessionId={galleryJob.sessionId} onClose={() => { setGalleryJob(null); setOpen(true) }} />}
  </>
}

function QueuePanel({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useModalFocus(ref, onClose)
  return <div className="fast-panel" ref={ref} role="dialog" aria-modal="true" aria-label="Antrean Fast Mode" tabIndex={-1}>
    <header><h2>Fast Mode</h2><button onClick={onClose}>Minimalkan</button></header>{children}
  </div>
}
