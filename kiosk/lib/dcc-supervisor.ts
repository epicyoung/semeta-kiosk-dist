// Windows executable path validation. Recovery lives in dcc-controller.ts.
export const DCC_DEFAULT_PATH = 'C:/Program Files (x86)/digiCamControl/CameraControl.exe'

export function isValidDccPath(p: unknown): p is string {
  if (typeof p !== 'string') return false
  const t = p.trim()
  if (t.length === 0 || t.length > 400) return false
  if (t !== p) return false
  // Karakter operator shell + baris baru + NUL.
  if (/[&|;<>^"'`$\r\n\0]/.test(t)) return false
  if (t.includes('..')) return false
  if (!/\.exe$/i.test(t)) return false
  // Harus path absolut Windows: "C:/..." atau "C:\...".
  if (!/^[A-Za-z]:[\\/]/.test(t)) return false
  return true
}
