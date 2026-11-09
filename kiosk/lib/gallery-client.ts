import { galleryImageUrl, type GalleryEntry, type GalleryVariant } from './gallery'
import { printSavedPhoto } from './print'
import type { PrintSize } from './types'

async function postGallery(body: Record<string, unknown>): Promise<GalleryEntry> {
  const response = await fetch('/api/gallery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Gagal menyimpan ke galeri')
  return result.entry
}

export function archiveFinal(input: { sessionId: string; eventName: string; image: string; recipe: GalleryVariant['recipe']; printSize?: PrintSize; sheet?: string; label?: string }) {
  return postGallery({ session_id: input.sessionId, event_name: input.eventName, image_base64: input.image,
    recipe: input.recipe, print_size: input.printSize, sheet_base64: input.sheet, label: input.label })
}

export function archiveShare(sessionId: string, eventName: string, shareUrl: string) {
  return postGallery({ session_id: sessionId, event_name: eventName, share_url: shareUrl })
}

export function printGalleryVariant(eventId: string, variant: GalleryVariant, copies: number) {
  return printSavedPhoto({ url: galleryImageUrl(eventId, variant.master_file), copies,
    printSize: variant.print_size, recipe: variant.recipe, fit: variant.fit,
    sheetUrl: variant.sheet_2up_file ? galleryImageUrl(eventId, variant.sheet_2up_file) : undefined })
}
