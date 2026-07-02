export async function startCamera(el: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  el.srcObject = stream
  await el.play()
  return stream
}

export function stopCamera(el: HTMLVideoElement): void {
  const stream = el.srcObject as MediaStream | null
  stream?.getTracks().forEach(t => t.stop())
  el.srcObject = null
}

export async function triggerCapture(): Promise<string> {
  const res = await fetch('http://localhost:5513/execute?action=capture')
  if (!res.ok) throw new Error(`capture failed: ${res.status}`)
  const { imagePath } = await res.json()
  return imagePath as string
}
