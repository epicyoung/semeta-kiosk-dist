import { compositeFrame } from '@/lib/frame-composite'
import { burnWatermark } from '@/lib/watermark-canvas'

export async function saveLocal(eventName: string, seq: string, kind: 'original' | 'ai', imageUrl: string) {
  await fetch('/api/save-local', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_name: eventName, seq, kind, image_base64: imageUrl }),
  })
}

export async function finalizeLocal(
  eventName: string,
  localOriginalUrl: string, localAiUrl: string,
  onFail?: (err: unknown) => void,
): Promise<string | null> {
  try {
    const res = await fetch('/api/next-seq', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_name: eventName }),
    })
    const { paddedSeq, eventFolder } = await res.json()
    await Promise.all([
      saveLocal(eventName, paddedSeq, 'original', localOriginalUrl),
      saveLocal(eventName, paddedSeq, 'ai', localAiUrl),
    ])
    return `${eventFolder}-${paddedSeq}`
  } catch (err) {
    console.error('finalize local failed:', err)
    try { onFail?.(err) } catch { /* analytics ga boleh matiin kiosk */ }
    return null
  }
}



export async function localCopies(originalUrl: string, aiUrl: string, licensed: boolean) {
  if (licensed) return { original: originalUrl, ai: aiUrl }
  const [original, ai] = await Promise.all([burnWatermark(originalUrl), burnWatermark(aiUrl)])
  return { original, ai }
}
