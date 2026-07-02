import type { Template } from './types'
import { localDb } from './local-db'
import { SPINDONESIA_CATEGORY } from './spindonesia-category'

// Re-export biar server-side caller (kiosk-config) tetep bisa impor dari sini.
export { SPINDONESIA_CATEGORY }

const TIMEOUT_MS = 8000

// Pure — testable. Sukses (termasuk [] = lo hapus semua minggu ini) → pakai fetched.
// Gagal/offline (null) → cache lama. Null-safe.
export function pickTemplates(fetched: Template[] | null, cached: Template[] | null): Template[] {
  if (fetched !== null) return fetched
  return cached ?? []
}

type WorkerTemplate = Record<string, unknown>

// Worker return thumbnail_url = full R2 URL (beda dari PB lokal yg perlu prefix) → pakai apa adanya.
function mapWorkerTemplate(item: WorkerTemplate): Template {
  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    category: String(item.category ?? SPINDONESIA_CATEGORY),
    gender_filter: (item.gender_filter as Template['gender_filter']) ?? 'ALL',
    engine_type: (item.engine_type as Template['engine_type']) ?? 'faceswap',
    token_cost: Number(item.token_cost ?? 1),
    thumbnail_url: (item.thumbnail_url as string | null) ?? null,
    positive_prompt: (item.positive_prompt as string | null) ?? null,
    negative_prompt: (item.negative_prompt as string | null) ?? null,
    api_endpoint: (item.api_endpoint as string | null) ?? null,
    video_endpoint: (item.video_endpoint as string | null) ?? null,
    video_positive_prompt: (item.video_positive_prompt as string | null) ?? null,
    video_negative_prompt: (item.video_negative_prompt as string | null) ?? null,
  }
}

// Fetch template spindonesia dari Worker. Sukses → cache localDb + return.
// Gagal/offline → cache terakhir (via pickTemplates). Belum pernah → [].
export async function fetchSpindonesiaTemplates(): Promise<Template[]> {
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL
  const secret = localDb.getSecret()
  const cached = localDb.getSpindonesiaTemplates()
  if (!workerUrl || !secret) return pickTemplates(null, cached) // dev/no-secret → cache atau []

  try {
    const res = await fetch(`${workerUrl}/api/spindonesia-templates`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return pickTemplates(null, cached)
    const data = (await res.json()) as { templates?: WorkerTemplate[] }
    const fetched = (data.templates ?? []).map(mapWorkerTemplate)
    localDb.saveSpindonesiaTemplates(fetched)
    return pickTemplates(fetched, cached)
  } catch {
    return pickTemplates(null, cached)
  }
}
