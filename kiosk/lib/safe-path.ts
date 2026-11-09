import path from 'node:path'

/** Pastikan path hasil join tetap di dalam directory yang diizinkan. */
export function assertWithinDir(filePath: string, dir: string): void {
  const root = path.resolve(dir)
  const target = path.resolve(filePath)
  const rel = path.relative(root, target)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes('\0')) {
    throw new Error('Path di luar folder yang diizinkan')
  }
}

/** Token nama file: huruf/angka/underscore/dash saja, maksimal `max` karakter. */
export function isSafeToken(value: string, max = 64): boolean {
  return new RegExp(`^[A-Za-z0-9_-]{1,${max}}$`).test(value)
}
