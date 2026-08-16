// Engine 'api' (Nano Banana Pro): rakit payload tambahan buat POST /api/generate.
//
// Prompt & referensi datang dari sidecar (via PocketBase) supaya operator bisa tweak di
// lapangan tanpa deploy — dua-duanya gak ngubah ongkos. Worker TETEP yang berkuasa: dia yang
// megang FAL key, nentuin model & jumlah gambar dari datanya sendiri, dan motong token dari
// row yang sama. Lihat provider.ts.
import { injectPrompt } from './prompt-input'
import { resizeDataUrl } from './upload'
import type { Template } from './types'

// api_model & num_images SENGAJA gak dikirim. Dua-duanya nentuin ongkos FAL sementara yang
// ditagih ke tenant flat templates.token_cost — kalau kiosk yang mutusin, operator bisa
// naikin ongkos kita tanpa naikin tagihan ke dia. Worker baca keduanya dari payload_json
// Supabase, row yang sama yang nagih. Lihat worker/src/provider.ts.
export type ApiEditRequest = {
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
      refs.push(await resizeDataUrl(url, 1200))
    } catch (e) {
      throw new ReferenceLoadError(`referensi template gagal di-load: ${url} (${String(e).slice(0, 120)})`)
    }
  }
  return {
    prompt: injectPrompt(tmpl.positive_prompt ?? '', userInput ?? ''),
    reference_images: refs,
    aspect_ratio: tmpl.aspect_ratio ?? undefined,
  }
}
