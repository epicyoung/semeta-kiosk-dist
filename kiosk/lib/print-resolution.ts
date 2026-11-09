/** At least 1800 pixels on the long edge, while preserving template aspect and detail. */
export function masterCanvasSize(width: number, height: number) {
  const scale = Math.max(1, 1800 / Math.max(width, height))
  return { w: Math.round(width * scale), h: Math.round(height * scale) }
}
