import sharp from 'sharp'

export const R2_PHOTO_MAX_EDGE = 1280

/** Normalize EXIF only; keep full camera dimensions and highest JPEG quality. */
export async function prepareSonyCapture(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes).autoOrient().keepMetadata()
    .jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer()
}

/** Auto-orient a DSLR capture (apply EXIF Orientation to the pixels) and drop all metadata so
 *  the browser never double-rotates. Result is always upright with correct portrait/landscape
 *  dimensions — matching the Sony path, so orientation detection works right from capture. */
export async function prepareCapture(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes).autoOrient().jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer()
}

/** A new buffer for cloud delivery; the camera/master/print buffer stays unchanged. */
export async function prepareR2Photo(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes).autoOrient()
    .resize({ width: R2_PHOTO_MAX_EDGE, height: R2_PHOTO_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78 }).toBuffer()
}
