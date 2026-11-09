type ArchiveTask = { id: string; label: string; status: 'saving' | 'failed'; error?: string }
type Work = { task: ArchiveTask; work: () => Promise<void>; promise: Promise<void> }

/** Tasks own their exact captured payload, independently of the preview component lifetime. */
export class ArchiveQueue {
  private tasks = new Map<string, Work>()
  private tail: Promise<void> = Promise.resolve()
  private listeners = new Set<() => void>()
  private current: ArchiveTask[] = []
  snapshot = () => this.current
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish() { this.current = Array.from(this.tasks.values(), value => ({ ...value.task })); this.listeners.forEach(listener => listener()) }
  submit(id: string, label: string, work: () => Promise<unknown>): Promise<void> {
    const existing = this.tasks.get(id)
    if (existing?.task.status === 'saving') return existing.promise
    const promise = this.tail.then(async () => { await work() })
    const task: Work = { task: { id, label, status: 'saving' }, work: async () => { await work() }, promise }
    this.tasks.set(id, task); this.publish()
    this.tail = promise.then(() => { this.tasks.delete(id); this.publish() }, error => {
      task.task.status = 'failed'; task.task.error = error instanceof Error ? error.message : 'Gagal menyimpan galeri'; this.publish()
    })
    return promise
  }
  retry(id: string): Promise<void> {
    const task = this.tasks.get(id)
    return task ? this.submit(id, task.task.label, task.work) : Promise.resolve()
  }
}

export const galleryArchiveQueue = new ArchiveQueue()
export const emptyArchiveTasks: ReturnType<ArchiveQueue['snapshot']> = []

/** Short in-memory identity; durable dedup still uses SHA-256 of final bytes on the server. */
export function archiveTaskKey(parts: (string | null | undefined)[]): string {
  let a = 2166136261, b = 5381
  for (const part of parts) for (const character of `${part ?? ''}\0`) {
    a = Math.imul(a ^ character.charCodeAt(0), 16777619)
    b = Math.imul(b, 33) ^ character.charCodeAt(0)
  }
  return `${a >>> 0}-${b >>> 0}`
}
