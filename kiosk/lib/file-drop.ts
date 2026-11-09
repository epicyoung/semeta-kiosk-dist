export function isExternalFileDrag(transfer: { types: readonly string[] } | null): boolean {
  return !!transfer && Array.from(transfer.types).includes('Files')
}
export function isDedicatedUpload(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('[data-file-upload],input[type="file"]')
}
