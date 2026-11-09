/**
 * Local kiosk mutations must not be triggered by an unrelated web page.
 * Bukan autentikasi: proses lokal tetap boleh. Yang ditolak = request browser
 * lintas-origin (CSRF/drive-by). `Sec-Fetch-Site` ada di Chrome modern dan
 * ga bisa dipalsukan dari halaman web.
 */
export function assertLocalMutation(request: Request): void {
  const site = request.headers.get('sec-fetch-site')
  if (site === 'cross-site') throw new Error('Origin tidak diizinkan')
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) throw new Error('Origin tidak diizinkan')
}

/** GET/read variant: tolak request lintas-origin (blind drive-by probing). */
export function assertLocalRead(request: Request): void {
  assertLocalMutation(request)
}

export async function boundedBytes(response: Response | Request, maximum: number): Promise<Uint8Array> {  const declared = Number(response.headers.get('content-length'))
  if (declared > maximum) throw new Error('File terlalu besar')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('File kosong')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > maximum) throw new Error('File terlalu besar')
      chunks.push(chunk.value)
    }
  } finally { await reader.cancel() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}
