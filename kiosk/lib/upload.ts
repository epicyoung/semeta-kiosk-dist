import { proxied } from "./facedetect";

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

/**
 * Fit dimensions for Video Generation Seed (e.g. LTX / Wan / Kling DiT models).
 * Ensures both dimensions are exact multiples of 32, preserving the native aspect ratio.
 * For 2:3 portrait, exact resolution is 768 x 1152.
 */
export function fitForVideoSeed(width: number, height: number): { w: number; h: number } {
  const ratio = width / height;
  // 2:3 portrait (ratio ~0.667)
  if (Math.abs(ratio - (2 / 3)) < 0.05) {
    return { w: 768, h: 1152 };
  }
  // 3:2 landscape (ratio ~1.5)
  if (Math.abs(ratio - (3 / 2)) < 0.05) {
    return { w: 1152, h: 768 };
  }
  // 9:16 vertical (ratio ~0.5625)
  if (Math.abs(ratio - (9 / 16)) < 0.05) {
    return { w: 704, h: 1280 };
  }
  // 16:9 landscape (ratio ~1.778)
  if (Math.abs(ratio - (16 / 9)) < 0.05) {
    return { w: 1280, h: 704 };
  }
  // 1:1 square (ratio ~1.0)
  if (Math.abs(ratio - 1.0) < 0.05) {
    return { w: 768, h: 768 };
  }
  // Fallback: Scale longest edge to max 1152, snap to nearest multiple of 32
  const maxEdge = 1152;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const snapW = Math.max(32, Math.round((width * scale) / 32) * 32);
  const snapH = Math.max(32, Math.round((height * scale) / 32) * 32);
  return { w: snapW, h: snapH };
}

async function resizeVideoSeedBlob(dataUrlOrUrl: string): Promise<Blob> {
  const src = await toBlob(dataUrlOrUrl);
  const bitmap = await createImageBitmap(src);
  const ratio = bitmap.width / bitmap.height;

  // 2:3 portrait (ratio ~0.667): Smart-pad to 9:16 (1080x1920) so FAL won't crop sides
  if (Math.abs(ratio - (2 / 3)) < 0.05) {
    const targetW = 1080;
    const targetH = 1920;
    const innerH = 1620;
    const padY = 150;

    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext("2d")!;

    // Fill background with edge extension/dark tone
    ctx.fillStyle = "#111116";
    ctx.fillRect(0, 0, targetW, targetH);

    // Draw top & bottom edge extension for seamless AI background continuity
    ctx.drawImage(bitmap, 0, 0, bitmap.width, 30, 0, 0, targetW, padY);
    ctx.drawImage(bitmap, 0, bitmap.height - 30, bitmap.width, 30, 0, targetH - padY, targetW, padY);

    // Draw main 2:3 image centered in 1080x1620
    ctx.drawImage(bitmap, 0, padY, targetW, innerH);
    bitmap.close();
    return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  }

  const { w, h } = fitForVideoSeed(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
}

/** Upload a photo/video to R2 via the Next.js API route. Returns { url, key }.
 * S = seed img2vid: image bersih buat FAL (URL R2 publik). Di-resize ke resolusi DiT kelipatan 32
 * (2:3 → 768x1152), no watermark (server skip S). Dipakai supaya FAL bisa akses seed walau hasil AI-nya blob/localhost. */
export async function uploadAsset(
  dataUrlOrUrl: string,
  type: "A" | "B" | "C" | "S" | `M${number}` | `A${number}`,
  sessionId: string,
  meta?: { eventName?: string; durationSec?: number; mCount?: number },
): Promise<{ url: string; key: string }> {
  // framed images (from compositeFrame) are already 1200px data URLs.
  // Bypass resizeBlob to prevent concurrent memory crashes.
  // Type S (video seed) is always resized to 2:3 768x1152 (mult of 32) for DiT AI video.
  const isDataUrl = dataUrlOrUrl.startsWith("data:");
  const blob =
    type === "S"
      ? await resizeVideoSeedBlob(dataUrlOrUrl)
      : type === "C" || isDataUrl
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
  // Lewat /api/img-proxy buat URL cross-origin. R2 publik (epic.spindonesia.com) GA ngirim
  // Access-Control-Allow-Origin, jadi fetch langsung dari browser diblokir CORS. Kena pas
  // seed _S video: hasil AI yang udah di R2 ditarik lagi buat dikirim ke FAL — uploadAsset
  // ngelempar, handleVideoConfirmOk berhenti, finalizeVideo ga jalan, _C.mp4 ga pernah naik.
  // Gejalanya nyamar: video kelihatan jadi di layar (blob lokal) tapi ga ada di QR.
  // proxied() = helper yang sama yang dipakai facedetect + video-overlay buat masalah ini.
  const res = await fetch(proxied(dataUrlOrUrl));
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
