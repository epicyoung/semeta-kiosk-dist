const MAX_PX = 1200; // longest edge for R2 uploads — fits IG/WA story portrait, phones top out ~1440px

/**
 * Scale dims so the longest edge ≤ maxPx. Returns null if already small enough (skip resize).
 * Pure — the money path: Canon shoots 6000px, this MUST shrink it before R2 upload or every
 * photo costs ~5MB of bandwidth + storage instead of ~200KB. Exported for the unit check.
 */
export function fitWithin(
  width: number,
  height: number,
  maxPx: number,
): { w: number; h: number } | null {
  if (width <= maxPx && height <= maxPx) return null;
  const scale = maxPx / Math.max(width, height);
  return { w: Math.round(width * scale), h: Math.round(height * scale) };
}

/**
 * Konversi blob: URL (ephemeral, browser-only) ke data: URL (persistent, serializable).
 * Penting buat video _C: blob URL bisa invalid kalau state React udah pindah / tab navigate.
 * Data URL aman di-pass ke uploadAsset kapan aja — ga terikat lifecycle blob store browser.
 */
export async function blobUrlToDataUrl(blobUrl: string): Promise<string> {
  const res = await fetch(blobUrl);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Resize image dataUrl/URL to maxPx longest edge, returning compact JPEG data URL (~200KB). */
export async function resizeDataUrl(dataUrlOrUrl: string, maxPx: number = 1200): Promise<string> {
  const blob = await resizeBlob(dataUrlOrUrl, maxPx);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Upload a photo/video to R2 via the Next.js API route. Returns { url, key }.
 * S = seed img2vid: image bersih buat FAL (URL R2 publik). Di-resize kayak A/B, no watermark
 * (server skip S). Dipakai supaya FAL bisa akses seed walau hasil AI-nya blob/localhost. */
export async function uploadAsset(
  dataUrlOrUrl: string,
  type: "A" | "B" | "C" | "S" | `M${number}`,
  sessionId: string,
  meta?: { eventName?: string; durationSec?: number; mCount?: number },
): Promise<{ url: string; key: string }> {
  // framed images (from compositeFrame) are already 1200px data URLs.
  // Bypass resizeBlob to prevent concurrent memory crashes.
  const isDataUrl = dataUrlOrUrl.startsWith("data:");
  const blob =
    type === "C" || isDataUrl
      ? await toBlob(dataUrlOrUrl)
      : await resizeBlob(dataUrlOrUrl, MAX_PX);

  const ext = type === "C" ? "mp4" : "jpg";
  const form = new FormData();
  form.append("type", type);
  form.append("session_id", sessionId);
  form.append("file", blob, `photo.${ext}`);
  if (meta?.eventName) form.append("event_name", meta.eventName);
  if (meta?.durationSec != null)
    form.append("processing_duration_sec", String(meta.durationSec));
  if (meta?.mCount !== undefined) form.append("m_count", String(meta.mCount));

  // Watermark is decided server-side from the rental session — client has no say.
  const res = await fetch("/api/upload-asset", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    // Route /api/upload-asset udah nerusin alasan ASLI dari Worker (workerStatus + workerBody).
    // Dulu dibuang dan cuma dilempar angka status — "Upload failed: 502" ga ngasih tau apa-apa,
    // alasannya cuma nongol di terminal server yang ga kelihatan pas lagi di depan booth.
    const detail = await res
      .json()
      .then((d: { error?: string; workerStatus?: number; workerBody?: string }) =>
        d.workerStatus ? `worker ${d.workerStatus}: ${d.workerBody ?? ""}` : (d.error ?? ""),
      )
      .catch(() => "");
    throw new Error(`Upload ${type} gagal (${res.status})${detail ? ` — ${detail}` : ""}`);
  }
  const { url, key } = await res.json();
  return { url, key };
}

/** Resize image so longest edge ≤ maxPx, returns JPEG blob. Skips resize if already small enough. */
async function resizeBlob(dataUrlOrUrl: string, maxPx: number): Promise<Blob> {
  const src = await toBlob(dataUrlOrUrl);
  const bitmap = await createImageBitmap(src);
  const fit = fitWithin(bitmap.width, bitmap.height, maxPx);

  if (!fit) {
    bitmap.close();
    return src;
  }

  const canvas = new OffscreenCanvas(fit.w, fit.h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, fit.w, fit.h);
  bitmap.close();

  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.88 });
}

async function toBlob(dataUrlOrUrl: string): Promise<Blob> {
  if (dataUrlOrUrl.startsWith("data:")) {
    const [header, b64] = dataUrlOrUrl.split(",");
    const mime = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
    const bytes = atob(b64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  const res = await fetch(dataUrlOrUrl);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.blob();
}

/**
 * Upload a LOCAL FILE (on the kiosk disk, e.g. C:/semeta/event/.../video.mp4) to R2 via
 * the Next.js backend → Worker. Reads from disk SERVER-SIDE — no blob URLs, no base64 in
 * the browser, no memory issues. Critical for video _C.mp4 (FFmpeg output on disk).
 */
export async function uploadLocalFile(
  localPath: string,
  type: "A" | "B" | "C" | "S" | `M${number}`,
  sessionId: string,
  meta?: { eventName?: string },
): Promise<{ url: string; key: string }> {
  const res = await fetch("/api/upload-local-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      local_path: localPath,
      type,
      session_id: sessionId,
      event_name: meta?.eventName,
    }),
  });
  if (!res.ok) throw new Error(`Upload local file failed: ${res.status}`);
  const { url, key } = await res.json();
  return { url, key };
}
