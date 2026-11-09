import sharp from 'sharp'
import { masterCanvasSize } from './print-resolution'

export type FrameBytes = { id: string; bytes: Buffer }
export const IMPORT_MAX_BYTES = 50 * 1024 * 1024
export const IMPORT_MAX_PIXELS = 80_000_000

export async function validateImportPhoto(bytes: Buffer): Promise<void> {
  if (!bytes.length || bytes.length > IMPORT_MAX_BYTES) throw new Error('Batas foto 50 MiB')
  const meta = await sharp(bytes, { limitInputPixels: IMPORT_MAX_PIXELS }).metadata()
  if (!['jpeg', 'png'].includes(meta.format ?? '') || !meta.width || !meta.height) throw new Error('Gunakan foto JPEG atau PNG (maksimal 80 MP)')
}

/** EXIF is baked before orientation selection; an absent matching frame never crops a photo. */
export async function smartFrame(bytes: Buffer, frames: FrameBytes[]) {
  await validateImportPhoto(bytes)
  const original = await sharp(bytes, { limitInputPixels: IMPORT_MAX_PIXELS }).autoOrient().jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer({ resolveWithObject: true })
  const { width, height } = original.info
  const orientation = width === height ? 'square' : width > height ? 'landscape' : 'portrait'
  let warning: string | undefined
  for (const frame of orientation === 'square' ? [] : frames) {
    try {
      const overlay = await sharp(frame.bytes, { limitInputPixels: IMPORT_MAX_PIXELS }).autoOrient().png().toBuffer({ resolveWithObject: true })
      const frameOrientation = overlay.info.width > overlay.info.height ? 'landscape' : 'portrait'
      if (frameOrientation !== orientation) continue
      const size = masterCanvasSize(overlay.info.width, overlay.info.height)
      if (size.w * size.h > IMPORT_MAX_PIXELS) throw new Error('Frame terlalu besar')
      const background = await sharp(original.data).resize(size.w, size.h, { fit: 'cover', position: 'centre' }).toBuffer()
      const top = await sharp(overlay.data).resize(size.w, size.h).toBuffer()
      const image = await sharp(background).composite([{ input: top }]).jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer()
      return { image, width: size.w, height: size.h, orientation, frameId: frame.id, fit: 'cover' as const, warning }
    } catch {
      warning = 'Frame gagal dibaca, memakai original jika tidak ada frame lain yang sesuai'
    }
  }
  return { image: original.data, width, height, orientation, frameId: null, fit: 'contain' as const, warning }
}
