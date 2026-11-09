export type ImportStatus = 'queued' | 'framing' | 'saved_local' | 'uploading' | 'upload_pending' | 'ready' | 'failed_local' | 'cancelled'
export type ImportJob = {
  id: string; batchId: string; eventId: string; eventName: string; sessionId: string
  sourceName: string; sourceFile: string; hash: string; createdAt: string; updatedAt: string
  status: ImportStatus; paused?: boolean; error?: string; warning?: string; attempts: number
  nextAttempt?: number; variantId?: string; masterFile?: string; thumbnailFile?: string; shareUrl?: string
  remote?: { key: string; url: string; databaseRecorded?: boolean }
}
export type ImportBatch = { id: string; eventId: string; eventName: string; createdAt: string; frames: { id: string; file: string }[]; warning?: string }
