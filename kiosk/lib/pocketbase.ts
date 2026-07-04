import type { Frame, Template } from './types'

const TIMEOUT_MS = 3000
// ponytail: fetch template pakai timeout longgar — thumbnail banyak/gede bikin 3s putus di tengah (cuma sebagian kedetek)
const FETCH_TIMEOUT_MS = 30000

export async function pingPocketBase(pbUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${pbUrl}/api/health`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

export async function fetchPocketBaseTemplates(pbUrl: string): Promise<Template[]> {
  try {
    const all: Template[] = []
    // Paginate — perPage 500 (max PB), loop sampai halaman terakhir. Cap statis bikin template
    // ilang diam-diam begitu tenant nembus batas (347 template kebaca 200 → 3 kategori ilang).
    for (let page = 1; ; page++) {
      const res = await fetch(
        `${pbUrl}/api/collections/templates/records?filter=is_active%3Dtrue&perPage=500&page=${page}`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' },
      )
      if (!res.ok) break
      const data = (await res.json()) as { items?: unknown[]; page?: number; totalPages?: number }
      for (const item of data.items ?? []) all.push(mapPbTemplate(pbUrl, item as Record<string, unknown>))
      if (!data.totalPages || (data.page ?? page) >= data.totalPages) break
    }
    return all
  } catch {
    return []
  }
}

export async function fetchPocketBaseFrames(pbUrl: string): Promise<Frame[]> {
  try {
    const res = await fetch(
      `${pbUrl}/api/collections/frames/records?filter=is_active%3Dtrue&sort=sort_order&perPage=10`,
      { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' },
    )
    if (!res.ok) return []
    const data = (await res.json()) as { items?: unknown[] }
    return (data.items ?? []).map(item => {
      const r = item as Record<string, unknown>
      const img = r.image as string | null | undefined
      return {
        id: String(r.id ?? ''),
        url: img ? `${pbUrl}/api/files/frames/${String(r.id)}/${img}` : '',
        name: String(r.name ?? ''),
      }
    }).filter(f => f.url)
  } catch {
    return []
  }
}

export function mapPbTemplate(pbUrl: string, item: Record<string, unknown>): Template {
  const thumb = item.thumbnail as string | null | undefined
  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    category: String(item.category ?? ''),
    gender_filter: (item.gender_filter as Template['gender_filter']) ?? 'ALL',
    engine_type: (item.engine_type as Template['engine_type']) ?? 'faceswap',
    token_cost: Number(item.token_cost ?? 1),
    thumbnail_url: thumb ? `${pbUrl}/api/files/templates/${String(item.id)}/${thumb}` : null,
    positive_prompt: (item.positive_prompt as string | null) ?? null,
    negative_prompt: (item.negative_prompt as string | null) ?? null,
    api_endpoint: null,
    video_endpoint: null,
    video_positive_prompt: null,
    video_negative_prompt: null,
  }
}
