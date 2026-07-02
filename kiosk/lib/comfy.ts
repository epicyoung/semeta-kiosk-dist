type ProgressCb = (progress: number) => void
type DoneCb = (result: { aiUrl: string; originalUrl: string }) => void
type ErrorCb = () => void

export function openComfySocket(onProgress: ProgressCb, onDone: DoneCb, onError: ErrorCb): WebSocket {
  const url = process.env.NEXT_PUBLIC_COMFY_URL ?? 'ws://localhost:8188/ws'
  const ws = new WebSocket(url)

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data as string)
    if (msg.type === 'progress') {
      onProgress(Math.round((msg.data.value / msg.data.max) * 100))
    } else if (msg.type === 'executing' && msg.data.node === null) {
      onDone({ aiUrl: msg.data.output?.ai_url ?? '', originalUrl: msg.data.output?.original_url ?? '' })
      ws.close()
    }
  }

  ws.onerror = () => { onError(); ws.close() }

  return ws
}
