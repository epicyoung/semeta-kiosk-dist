// Engine 'api' (Nano Banana Pro): rakit payload tambahan buat POST /api/generate.
//
// Prompt & referensi datang dari sidecar (via PocketBase) supaya operator bisa tweak di
// lapangan tanpa deploy. Worker TETEP yang berkuasa: dia yang megang FAL key, ambil endpoint
// dari whitelist by api_model, dan motong token dari datanya sendiri. Lihat provider.ts.
import { injectPrompt } from './prompt-input'
import { blobUrlToDataUrl } from './upload'
import type { Template } from './types'

export type ApiEditRequest = {
  api_model: string
  prompt: string
  reference_images: string[]
  aspect_ratio?: string
}

export class ReferenceLoadError extends Error {}

/** Template + teks tamu → field tambahan buat /api/generate.
 *  Referensi di-fetch dari PocketBase lokal lalu dijadiin data URI: FAL nerima data URI,
 *  jadi gambar BG ga perlu mampir R2 dulu (satu titik gagal & satu ronde latency lebih sedikit).
 *
 *  Referensi yang GAGAL di-load bikin seluruh generate batal, BUKAN dilewat diam-diam:
 *  template "kamu di halte Tosari" tanpa foto haltenya cuma menghasilkan orang berdiri di
 *  latar acak — token kepotong buat hasil yang bukan pesanan tamu. Mending gagal keras
 *  biar salah-konfigurasinya kelihatan. Template TANPA referensi (mis. prompt double-decker)
 *  tetap sah — yang dijaga cuma referensi yang udah didaftarin tapi ga bisa dibaca. */
export async function buildApiEditRequest(tmpl: Template, userInput?: string): Promise<ApiEditRequest> {
  const refs: string[] = []
  for (const url of tmpl.reference_urls ?? []) {
    try {
      refs.push(await blobUrlToDataUrl(url))
    } catch (e) {
      throw new ReferenceLoadError(`referensi template gagal di-load: ${url} (${String(e).slice(0, 120)})`)
    }
  }
  return {
    api_model: tmpl.api_model ?? '',
    prompt: injectPrompt(tmpl.positive_prompt ?? '', userInput ?? ''),
    reference_images: refs,
    aspect_ratio: tmpl.aspect_ratio ?? undefined,
  }
}
