import type { Frame, Template } from './types'

const TIMEOUT_MS = 3000

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
    const res = await fetch(
      `${pbUrl}/api/collections/templates/records?filter=is_active%3Dtrue&perPage=200`, // ponytail: 200 cap; paginate if tenant grows beyond this
      { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' },
    )
    if (!res.ok) return []
    const data = (await res.json()) as { items?: unknown[] }
    return (data.items ?? []).map(item => mapPbTemplate(pbUrl, item as Record<string, unknown>))
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
