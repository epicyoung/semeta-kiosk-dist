// Path-traversal guard buat /api/local-asset. File param dibaca dari disk lokal —
// dot-dot atau separator path apa pun = potensi baca file arbitrer di mesin operator.
// Konservatif: cuma nama file datar (tanpa ../, /, \) yang lolos.
export function isSafeAssetFilename(file: string | null | undefined): file is string {
  if (!file) return false
  if (file.includes('..')) return false
  if (file.includes('/') || file.includes('\\')) return false
  return true
}
