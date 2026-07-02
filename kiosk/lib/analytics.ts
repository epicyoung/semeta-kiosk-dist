// fire-and-forget visitor funnel analytics — never throws, never blocks user flow

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? ''

export function logVisitorEvent(
  event_type: string,
  metadata: Record<string, unknown>,
  secret: string,
): void {
  if (!secret || !WORKER_URL) return
  fetch(`${WORKER_URL}/api/visitor-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ event_type, metadata }),
  }).catch(() => {})
}
