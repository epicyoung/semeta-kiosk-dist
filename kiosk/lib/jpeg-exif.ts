// Buang SEMUA segmen APP1 (EXIF/XMP) dari JPEG — server-side, sebelum file dikirim ke browser.
// Kenapa: file DSLR bawa EXIF Orientation (grip portrait). Behavior browser soal EXIF ga bisa
// dipegang: imageOrientation:'none' udah dicabut Chrome → createImageBitmap jatuh ke fallback
// yang DIAM-DIAM apply EXIF → hasil keputer dobel vs live view (live raw + rotasi manual,
// hasil "udah tegak" + rotasi manual lagi). Tanpa APP1 semua jalur decode = pixel mentah →
// tombol rotate kiosk jadi satu-satunya kebenaran, live & hasil dijamin identik.
// Return Buffer BARU — input ga dimutasi.
export function stripExif(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf // bukan JPEG → passthrough
  const parts: Buffer[] = [buf.subarray(0, 2)] // SOI
  let off = 2
  while (off + 4 <= buf.length && buf[off] === 0xff) {
    const marker = buf[off + 1]
    if (marker === 0xda) break // SOS — sisanya entropy-coded data, copy mentah di bawah
    const len = buf.readUInt16BE(off + 2)
    if (len < 2) break // malformed → stop, sisanya copy mentah (jangan muter selamanya)
    if (marker !== 0xe1) parts.push(buf.subarray(off, off + 2 + len)) // keep semua non-APP1
    off += 2 + len
  }
  parts.push(buf.subarray(off))
  return Buffer.concat(parts)
}
