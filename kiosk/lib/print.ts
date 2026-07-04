// Print foto 4R (4×6in) via SATU iframe persisten + window.print().
// Chrome --kiosk-printing → silent ke default printer; tanpa flag → print box Chrome muncul.
// Dua pelajaran event live (2026-07-04), JANGAN diulang:
// 1. JANGAN remove iframe setelah print() — remove saat dialog kebuka bikin Chrome
//    nutup print box-nya sendiri (gejala: "printbox muncul terus ilang").
// 2. JANGAN gantung di iframe.onload — event bisa keburu lewat sebelum handler kepasang,
//    dulu jatuh ke timeout yang resolve TANPA manggil print() (gejala: ga keluar apa-apa).
//    Sekarang: tunggu img.decode() (cap 10s), lalu print() SELALU dipanggil.

const FRAME_ID = 'semeta-print-frame'
const DECODE_TIMEOUT_MS = 10_000 // decode nyangkut 10s → print aja, halaman telat lebih baik daripada ga keluar

function getPrintFrame(): HTMLIFrameElement {
  const existing = document.getElementById(FRAME_ID)
  if (existing instanceof HTMLIFrameElement) return existing
  const iframe = document.createElement('iframe')
  iframe.id = FRAME_ID
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:0'
  document.body.appendChild(iframe)
  return iframe
}

async function toDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url
  const blob = await fetch(url).then(r => r.blob())
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target!.result as string)
    reader.onerror = () => reject(new Error('read gagal'))
    reader.readAsDataURL(blob)
  })
}

/** Foto selalu 4R. Print box Chrome boleh muncul — yang haram: print ga keluar. */
export async function printPhoto(url: string, copies: number): Promise<void> {
  const dataUrl = await toDataUrl(url)
  const iframe = getPrintFrame()
  const doc = iframe.contentDocument!
  doc.open()
  doc.write(`<!DOCTYPE html><html><head><style>
    @page { size: 4in 6in; margin: 0; }
    * { margin:0; padding:0; box-sizing:border-box; }
    img { width:4in; height:6in; object-fit:cover; display:block; }
    img + img { page-break-before: always; }
  </style></head><body>${Array.from({ length: copies }, () => `<img src="${dataUrl}" />`).join('')}</body></html>`)
  doc.close()

  // Tunggu foto ke-decode biar halaman ga kosong — tapi jangan pernah nge-block print selamanya.
  const imgs = Array.from(doc.images ?? [])
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.all(imgs.map(img =>
      typeof img.decode === 'function' ? img.decode().catch(() => undefined) : Promise.resolve(),
    )),
    new Promise(r => { timer = setTimeout(r, DECODE_TIMEOUT_MS) }),
  ])
  clearTimeout(timer)
  iframe.contentWindow!.print()
}
