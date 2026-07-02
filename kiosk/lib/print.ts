// Silent print via hidden iframe. Chrome must run with --kiosk-printing (see start.bat/dev.bat).
// Foto selalu 4R (4x6in). Tiap copy = halaman sendiri via page-break-before.
export async function printPhoto(url: string, copies: number): Promise<void> {
  let dataUrl = url
  if (!url.startsWith('data:')) {
    const blob = await fetch(url).then(r => r.blob())
    dataUrl = await new Promise<string>((res, rej) => {
      const reader = new FileReader()
      reader.onload = e => res(e.target!.result as string)
      reader.onerror = () => rej(new Error('read gagal'))
      reader.readAsDataURL(blob)
    })
  }

  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:0'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument!
  doc.open()
  doc.write(`<!DOCTYPE html><html><head><style>
    @page { size: 4in 6in; margin: 0; }
    * { margin:0; padding:0; box-sizing:border-box; }
    img { width:4in; height:6in; object-fit:cover; display:block; }
    img + img { page-break-before: always; }
  </style></head><body>${Array.from({ length: copies }, () => `<img src="${dataUrl}" />`).join('')}</body></html>`)
  doc.close()

  await new Promise<void>((resolve) => {
    // ponytail: fallback 5s biar UI ga gantung kalo iframe.onload ga nyala
    const timeout = setTimeout(resolve, 5000)
    iframe.onload = () => {
      clearTimeout(timeout)
      // ponytail: NO iframe.focus() — maling fokus dari kiosk & bisa nyentak keluar fullscreen.
      // --kiosk-printing bikin print silent tanpa perlu iframe di-focus.
      iframe.contentWindow!.print()
      setTimeout(resolve, 2000)
    }
  })
  document.body.removeChild(iframe)
}
