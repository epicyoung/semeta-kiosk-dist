// fire-and-forget visitor funnel analytics — never throws, never blocks user flow.
// Secret kiosk TIDAK ikut ke browser: route same-origin /api/log-visitor yang nempelin
// Bearer di server, jadi halaman ga pernah pegang kredensial.
export function logVisitorEvent(
  event_type: string,
  metadata: Record<string, unknown>,
): void {
  fetch('/api/log-visitor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_type, metadata }),
    keepalive: true,
  }).catch(() => {})
}
