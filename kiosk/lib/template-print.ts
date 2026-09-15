import type { Template } from './types'
import type { StripSource } from './strip-pool'

export type TemplatePrintLayout = {
  orientation: 'LANDSCAPE' | 'PORTRAIT'
  slots: { x: number; y: number; w: number; h: number }[]
}

export function parseTemplatePrintLayout(value: unknown): TemplatePrintLayout | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.orientation !== 'LANDSCAPE' && v.orientation !== 'PORTRAIT') return null
  if (!Array.isArray(v.slots) || v.slots.length !== 2) return null
  const width = v.orientation === 'LANDSCAPE' ? 1800 : 1200
  const height = v.orientation === 'LANDSCAPE' ? 1200 : 1800
  const slots: TemplatePrintLayout['slots'] = []
  for (const slot of v.slots) {
    if (!slot || typeof slot !== 'object') return null
    const { x, y, w, h } = slot
    if (![x, y, w, h].every(n => typeof n === 'number' && Number.isFinite(n))) return null
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > width || y + h > height) return null
    slots.push({ x, y, w, h })
  }
  return { orientation: v.orientation, slots }
}

/** Keep the chosen AI first so automatic filling pairs it with the original. */
export function templatePrintSelection(pool: StripSource[], templates: Template[], aiUrl: string) {
  const selected = pool.find(p => p.kind === 'ai' && p.thumbUrl === aiUrl)
  const template = templates.find(t => t.id === selected?.templateId)
  if (!selected || !template?.print_overlay_url || !template.print_layout) return null
  return {
    template,
    pool: [...pool.filter(p => p.kind === 'original'), selected,
      ...pool.filter(p => p.kind === 'ai' && p.id !== selected.id)],
  }
}
