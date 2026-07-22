"use client";
import { useState, useEffect, useRef, type Dispatch } from "react";
import { QRCodeSVG } from "qrcode.react";
import { TouchButton } from "@/components/ui/TouchButton";
import type { KioskAction, KioskState, KioskConfig } from "@/lib/types";
import {
  findOverlayForOrientation,
  loadImageDims,
  orientationOf,
  type OrientedFrame,
  type Orientation,
} from "@/lib/frames";
import { printPhoto } from "@/lib/print";
import { compositeFrame } from "@/lib/frame-composite";
import { to2UpSheet } from "@/lib/print-layout";
import { uploadAsset, blobUrlToDataUrl, uploadLocalFile } from "@/lib/upload";
import { planMultiUpload } from "@/lib/multi-upload";
import { animateImage, finalizeVideo, isVideoUnlocked } from "@/lib/video";
import { buildVideoOverlay } from "@/lib/video-overlay";
import { useT } from "@/lib/i18n";

type Props = {
  // choose = frame chooser (cycling + Back/Next, no upload/print). final = preview (fixed frame, upload+print).
  mode: "choose" | "final";
  state: Extract<KioskState, { screen: "preview" | "framechooser" }>;
  dispatch: Dispatch<KioskAction>;
  frames: OrientedFrame[];
  config: Pick<
    KioskConfig,
    | "enable_email"
    | "enable_print"
    | "enable_video"
    | "enable_video_engine"
    | "video_provider"
    | "video_resolution"
    | "video_duration"
    | "video_defaults"
    | "video_prompt_choices"
    | "has_secret"
    | "bypassed"
    | "templates"
  >;
  licensed: boolean;
  eventName: string;
  onAction?: (action: "printed" | "emailed" | "shared") => void;
};

function TabSwitcher({
  activeTab,
  videoUrl,
  videoLoading,
  onSwitch,
}: {
  activeTab: "photo" | "video";
  videoUrl: string | null;
  videoLoading: boolean;
  onSwitch: (tab: "photo" | "video") => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(12px)",
        borderRadius: 10,
        padding: 3,
        gap: 3,
      }}
    >
      {(["photo", "video"] as const).map((tab) => (
        <button
          key={tab}
          onClick={() =>
            tab === "video" && !videoUrl ? undefined : onSwitch(tab)
          }
          style={{
            padding: "6px 20px",
            borderRadius: 7,
            border: "none",
            cursor: tab === "video" && !videoUrl ? "default" : "pointer",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-xs)",
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            transition: "all 0.2s",
            background:
              activeTab === tab ? "rgba(255,255,255,0.2)" : "transparent",
            color:
              activeTab === tab
                ? "#fff"
                : tab === "video" && !videoUrl
                  ? "rgba(255,255,255,0.2)"
                  : "rgba(255,255,255,0.5)",
          }}
        >
          {tab === "video" && videoLoading ? (
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,0.4)",
                  borderTopColor: "#fff",
                  display: "inline-block",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              Video
            </span>
          ) : (
            tab.charAt(0).toUpperCase() + tab.slice(1)
          )}
        </button>
      ))}
    </div>
  );
}

export function PreviewScreen({
  mode,
  state,
  dispatch,
  frames,
  config,
  licensed,
  eventName,
  onAction,
}: Props) {
  const isChoose = mode === "choose";
  const isFinal = mode === "final";
  // Photo Print: composite udah final (overlay kebakar) — no frame, no video, no toggle AI/Asli.
  const isPrintSession = state.screen === "preview" && !!state.printSize;
  // Video GA (2026-07-20): kebuka kalau super admin nyalain kiosks.enable_video (nyampe via
  // handshake) ATAU godmode — isVideoUnlocked. Layer kedua tetep keputusan VENDOR (toggle
  // "Enable Video Engine" di Settings): vendor OFF → nol UI video (tab + tombol) di preview.
  // Kunci asli fail-closed di RPC deduct_video_tokens — config lama yang terlanjur
  // enable_video_engine:true tapi belum diizinin admin bakal ditolak 403 tanpa motong token.
  // GATE TAMBAHAN: tanpa sewa aktif (licensed) DAN bukan godmode → video DILARANG total,
  // walau admin nyalain enable_video. Freeware murni (tanpa key/rental) = nol UI video.
  const videoAllowed =
    (licensed || !!config.bypassed) &&
    isVideoUnlocked(config) &&
    (config.enable_video_engine ?? false) &&
    !isPrintSession;
  const t = useT();
  // Seed dari hasil yang DIPILIH tamu di ResultChooser (state.aiUrl), bukan selalu 0 — biar
  // yang tampil/di-upload sbg _B = pilihan tamu, sisanya _M. Fallback 0 kalau ga ketemu (single).
  const [resultIndex, setResultIndex] = useState(() => {
    if (!state.allResults) return 0;
    const i = state.allResults.findIndex((r) => r.aiUrl === state.aiUrl);
    return i >= 0 ? i : 0;
  });
  const [chooserAction, setChooserAction] = useState<"print" | "video" | null>(
    null,
  );
  const activeResult =
    state.allResults && state.allResults.length > 0
      ? state.allResults[resultIndex]
      : {
          aiUrl: state.aiUrl,
          rawAiUrl: state.rawAiUrl,
          originalUrl: state.originalUrl,
          sourceUrl: state.sourceUrl,
        };

  const [showOriginal, setShowOriginal] = useState(false);
  const [showBigQr, setShowBigQr] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<"idle" | "uploading" | "failed">(
    "idle",
  );
  const uploadSeq = useRef(0);
  // base yang udah/lagi di-upload — cegah upload dobel. Frame di final FIXED (dari chooser),
  // tapi `mismatch` resolve async (loadImageDims) → frameForOriginal berubah → effect re-run.
  // Tanpa guard ini tiap foto ke-upload 2x (dobel R2 + dobel log PHOTO_UPLOADED).
  const uploadedBase = useRef<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [frameIdx, setFrameIdx] = useState<number | null>(
    frames.some((f) => f.orientation === "portrait") ? 1 : null,
  );
  const [qty, setQty] = useState<number | null>(null);
  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [showVideoConfirm, setShowVideoConfirm] = useState(false);
  const [showVideoChoices, setShowVideoChoices] = useState(false);
  const [noTokens, setNoTokens] = useState(false); // popup pas worker balik 402 (token abis)
  const [videoCost, setVideoCost] = useState<number | null>(null); // harga token buat tombol (cache handshake)
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  // Auto video engine (img2vid): video udah jadi di ProcessingScreen, kebawa lewat state.
  // Seed dari sini → tab Video langsung nyala. Manual "Make Video" (freemium) tetep jalan sendiri.
  const preVideo = state.videoUrl ?? null;
  const [videoUrl, setVideoUrl] = useState<string | null>(preVideo);
  const [activeTab, setActiveTab] = useState<"photo" | "video">("photo");
  const [finalizing, setFinalizing] = useState(false);
  const finalizedBase = useRef<string | null>(null); // cegah finalize dobel per foto
  const videoGenRef = useRef(false); // cegah double-tap dialog → double token charge
  const qrHiddenRef = useRef<HTMLDivElement>(null); // sumber SVG QR buat di-burn ke video
  const inputRef = useRef<HTMLInputElement>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cycling cuma pool portrait (frame foto AI). Landscape dipake via pairing di tab Original.
  const allFrames = frames.filter((f) => f.orientation === "portrait");
  const cyclingFrame =
    frameIdx === null ? null : (allFrames[frameIdx - 1] ?? null);
  // Choose = frame lagi dipilih (cycling). Final = frame kepilih dari framechooser (fixed by id, no index drift).
  const chosenFrameId =
    state.screen === "preview" ? (state.selectedFrame?.id ?? null) : null;
  const currentFrame = isChoose
    ? cyclingFrame
    : chosenFrameId
      ? (frames.find((f) => f.id === chosenFrameId) ?? null)
      : null;
  // frameIdx: null = no frame, 1-based index into allFrames
  function prevFrame() {
    setFrameIdx((i) =>
      i === null ? allFrames.length : i <= 1 ? allFrames.length : i - 1,
    );
  }
  function nextFrame() {
    setFrameIdx((i) => (i === null ? 1 : i >= allFrames.length ? 1 : i + 1));
  }

  // Orientasi asli foto — mismatch = original beda orientasi dari hasil AI (AI = bentuk template).
  const [origDims, setOrigDims] = useState<{ w: number; h: number } | null>(
    null,
  );
  const [aiDims, setAiDims] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    let live = true;
    if (activeResult.originalUrl)
      loadImageDims(activeResult.originalUrl).then((d) => {
        if (live) setOrigDims(d);
      });
    if (activeResult.aiUrl)
      loadImageDims(activeResult.aiUrl).then((d) => {
        if (live) setAiDims(d);
      });
    return () => {
      live = false;
    };
  }, [activeResult.originalUrl, activeResult.aiUrl]);

  // Harga token video buat tombol — baca cache handshake 'lastVideoCosts' (sumber sama SettingsPanel).
  // client-only (localStorage) → di useEffect, aman dari SSR.
  useEffect(() => {
    try {
      const costs = JSON.parse(localStorage.getItem("lastVideoCosts") || "{}");
      const prov = config.video_provider ?? "PIXVERSE";
      const c =
        costs[config.video_resolution === "1080p" ? `${prov}_1080` : prov] ??
        costs[prov];
      setVideoCost(typeof c === "number" ? c : null);
    } catch {
      setVideoCost(null);
    }
  }, [config.video_provider, config.video_resolution]);

  const origOrientation = origDims
    ? orientationOf(origDims.w, origDims.h)
    : "portrait";
  const aiOrientation = aiDims ? orientationOf(aiDims.w, aiDims.h) : "portrait";
  // Orientasi foto yang LAGI tampil (AI atau Original) → box + frame ikut ini. Ini yang bikin
  // template LANDSCAPE → hasil landscape beneran (dulu native cuma buat Ori-mismatch & print).
  const shownOrientation = showOriginal ? origOrientation : aiOrientation;
  const shownDims = showOriginal ? origDims : aiDims;
  // Frame buat orientasi tertentu: portrait → currentFrame (pool picker selalu portrait),
  // landscape → frame landscape pertama. Ga ada frame seorientasi = null (foto polos, uncrop).
  const frameForOrientation = (o: Orientation): OrientedFrame | null =>
    o === "portrait"
      ? currentFrame
      : findOverlayForOrientation(frames, currentFrame, "landscape");
  // Print: composite di-nol-kan (overlay udah kebakar). AI display ikut orientasi hasil.
  const visibleFrame = isPrintSession
    ? null
    : frameForOrientation(shownOrientation);
  // Box snap ke aspect asli pas foto tampil landscape → zero crop (AI landscape, Ori mismatch, panel print 2R).
  const shownNative =
    activeTab === "photo" && !!shownDims && shownDims.w > shownDims.h;

  const printUrl = showOriginal ? activeResult.originalUrl : activeResult.aiUrl;

  async function doPrint(url: string, frameUrl: string | null, copies: number) {
    // Burn frame ke foto full-res sebelum print — DOM overlay ga ikut ke printer.
    // compositeFrame passthrough kalau frameUrl null. Gagal composite → print foto polos.
    let out = url;
    try {
      out = await compositeFrame(url, frameUrl);
    } catch (err) {
      console.warn("[print] composite frame gagal, print foto polos:", err);
    }
    // 2R: konten digital = satu panel landscape — kertas fisik dibangun 2-up di 4R
    // pas mau print aja (printer selamanya mikir dia nyetak 4R).
    if (state.screen === "preview" && state.printSize === "2R_STRIP") {
      try {
        out = await to2UpSheet(out);
      } catch (err) {
        console.warn("[print] 2-up sheet gagal, print panel polos:", err);
      }
    }
    await printPhoto(out, copies);
  }

  function handlePrintBtn() {
    if (qty === null) {
      setQty(1);
      return;
    }
    setPrinting(true);
    setQty(null);
    onAction?.("printed");
    doPrint(printUrl, visibleFrame?.url ?? null, qty ?? 1);
  }
  function onPrintAnimEnd() {
    setPrinting(false);
  }

  function handleEmailBtn() {
    setEmailMode(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function handleEmailSend() {
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError(true);
      return;
    }
    const aiUrl = activeResult.aiUrl;
    await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: email, photo_url: aiUrl }),
    });
    setEmailMode(false);
    setEmail("");
    setEmailSent(true);
    onAction?.("emailed");
    setTimeout(() => setEmailSent(false), 4000);
  }

  // Video BENERAN (dulu stub 4s → /video.mp4): seed = hasil bersih di-upload R2 type S
  // (pola maybeAnimate — FAL butuh URL publik), lalu img2vid provider pilihan vendor.
  // Token kepotong server-side sesuai harga dashboard; gagal/402 → fail-safe balik ke
  // tombol, foto tetep aman. Dipakai buat retry pas auto-video gagal / bikin on-demand.
  async function handleVideoConfirmOk(choice?: { positive: string, negative: string }) {
    if (videoGenRef.current) return; // double-tap guard — dialog confirm bisa ke-tap 2x sebelum state update
    
    if (!choice && config.video_prompt_choices && config.video_prompt_choices.length > 0) {
      setShowVideoConfirm(false);
      setShowVideoChoices(true);
      return;
    }

    videoGenRef.current = true;
    setShowVideoConfirm(false);
    setShowVideoChoices(false);
    setVideoLoading(true);
    setVideoProgress(0);
    try {
      // Seed = AI BERSIH (rawAiUrl, TANPA overlay/frame) → img2video. Frame dibakar BELAKANGAN.
      const raw = activeResult.rawAiUrl ?? activeResult.aiUrl;
      let seed = raw;
      if (state.base) {
        try {
          const { url } = await uploadAsset(raw, "S", state.base, {
            eventName,
          });
          seed = url;
        } catch {
          /* seed upload gagal → kirim raw; FAL bisa nolak → null → fail-safe */
        }
      }
      // Prompt gerak dikirim ke FAL (dulu ke-skip → PixVerse bisa 422). Default "smile & wave"
      // dari video_defaults; override per-template (video_positive_prompt) nyusul plumbing state.
      const tmpl = config.templates.find((t) => t.id === state.templateId);
      const positive =
        choice?.positive ||
        tmpl?.video_positive_prompt ||
        config.video_defaults?.default_positive_prompt;
      const negative =
        choice?.negative ||
        tmpl?.video_negative_prompt ||
        config.video_defaults?.default_negative_prompt;
      const video = await animateImage(
        seed,
        config.video_provider ?? "PIXVERSE",
        {
          positive,
          negative,
          resolution: config.video_resolution ?? "720p",
          duration: config.video_duration,
          onFail: (status) => {
            if (status === 402) setNoTokens(true);
          },
        },
      );
      if (video) {
        // Baru DI SINI: overlay = frame KEPILIH (+ QR) di-burn ke video (letterbox 2:3, ffmpeg server).
        // Gagal finalize → fallback video mentah (tamu ga kehilangan video).
        // QR JANGAN di-burn ke MP4 — file digital biar bersih. QR cukup di LAYAR (JSX overlay) +
        // kertas print. Tamu tetep dapet video via QR microsite (satu QR = ori/ai/video). Overlay = frame doang.
        const overlay = await buildVideoOverlay(
          currentFrame?.url ?? null,
          null,
        );
        const finalized = state.base
          ? await finalizeVideo(video, overlay, eventName, state.base)
          : null;

        const finalBlobUrl = finalized?.blobUrl ?? video;
        setVideoProgress(100);
        setVideoUrl(finalBlobUrl);
        setActiveTab("video");

        // Cloud copy: Video .mp4 udah di-render ffmpeg dan ada di C:/semeta/ (localPath).
        // Kita BACA LANGSUNG dari disk lokal untuk upload ke R2, bypass blob browser sepenuhnya.
        // Gagal = ga ada video di HP, on-screen tetep main (fail-safe).
        if (licensed && state.base && finalized?.localPath) {
          uploadLocalFile(finalized.localPath, "C", state.base, {
            eventName,
          }).catch((err) =>
            console.warn("[preview] upload video _C lokal gagal:", err),
          );
        }
      }
    } finally {
      setVideoLoading(false);
      // videoGenRef stays true if video generated (prevent re-gen same photo).
      // Reset only on failure so user can retry.
      if (!videoUrl) videoGenRef.current = false;
    }
  }

  // Progress kosmetik selama nunggu FAL (img2vid sync gak ngasih progress asli) — mentok 95%,
  // 100% di-set pas video beneran dateng di handleVideoConfirmOk.
  useEffect(() => {
    if (!videoLoading) return;
    const interval = setInterval(() => {
      setVideoProgress((p) => (p >= 95 ? 95 : p + Math.random() * 4));
    }, 500);
    return () => clearInterval(interval);
  }, [videoLoading]);

  // R2 upload + QR — frame di-burn dulu ke foto (branding ikut ke share), lalu A+B naik.
  // Ganti frame = re-upload key R2 yang SAMA (overwrite) → URL QR stabil, QR ga kedip.
  // RAW (sourceUrl/rawAiUrl) yang dikirim: worker yang mutusin watermark server-side.
  // Unlicensed: no upload — QR = sinyal sesi berbayar (decoy di JSX bawah).
  const frameForOriginal = isPrintSession
    ? null
    : frameForOrientation(origOrientation);
  // Upload A(Original)+B(AI) ke R2, dua-duanya frame kepilih di-burn dulu → QR ke microsite.
  // attempts: auto-retry (effect) 2x; manual (tombol Ulangi QR) 1x. Guard uploadSeq = frame
  // paling baru yang menang, QR ga ketimpa hasil upload lama.
  async function runUpload(attempts: number) {
    if (!licensed || !state.base) return;
    const base = state.base;
    const seq = ++uploadSeq.current;
    // Sumber _A/_B ikut yang LAGI ditampilkan (activeResult) — multi: hasil kepilih user (resultIndex),
    // single: state langsung. Konsisten sama grid preview → yang dipilih = yang jadi _B di microsite.
    const rawOriginal = activeResult.sourceUrl ?? activeResult.originalUrl;
    const rawAi = activeResult.rawAiUrl ?? activeResult.aiUrl;
    const meta = { eventName, durationSec: state.processingSec };
    setQrStatus("uploading");
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const [framedA, framedB] = await Promise.all([
          compositeFrame(rawOriginal, frameForOriginal?.url ?? null, 1200),
          compositeFrame(rawAi, currentFrame?.url ?? null, 1200),
        ]);

        // Multi-template: chosen (resultIndex) → _B, sisanya → _M1,_M2,… urut index (planMultiUpload).
        // INDEX-BASED sengaja — "tamu pilih N hasil → semuanya ke-upload" persis kayak grid preview.
        const plan = planMultiUpload(state.allResults, resultIndex);
        let mCount = 0;
        let framedMulti: string[] = [];
        if (plan && plan.others.length > 0) {
          mCount = plan.others.length;
          // SEQUENTIAL composite to prevent GPU/RAM crash (OffscreenCanvas memory spike)
          for (const r of plan.others) {
            const frame = await compositeFrame(
              r.rawAiUrl ?? r.aiUrl,
              currentFrame?.url ?? null,
              1200,
            );
            framedMulti.push(frame);
          }
        }

        // A+B WAJIB sukses (QR gantung ke resB). QR di-set SEGERA setelah A+B — tamu bisa scan
        // sementara _M masih uploading. _M di-await (Promise.allSettled) biar beneran mendarat di R2
        // sebelum microsite retry window (12s) habis. Gagal 1 _M ga crash flow.
        const [, resB] = await Promise.all([
          uploadAsset(framedA, "A", base, meta),
          uploadAsset(framedB, "B", base, { ...meta, mCount }),
        ]);
        // QR muncul duluan — tamu scan sambil _M masih naik.
        if (uploadSeq.current === seq) {
          setShareUrl(
            `https://semeta-microsite.pages.dev/s?b=${encodeURIComponent(resB.key)}${mCount > 0 ? `&m=${mCount}` : ""}`,
          );
          setQrStatus("idle");
        }
        // _M uploads paralel — AWAIT beneran, bukan forEach fire-and-forget.
        // Promise.allSettled: 1 gagal ga crash sisanya. Fail-safe: microsite <img onerror> retry.
        if (framedMulti.length > 0) {
          const mResults = await Promise.allSettled(
            framedMulti.map((data, i) =>
              uploadAsset(data, `M${i + 1}`, base, meta),
            ),
          );
          mResults.forEach((r, i) => {
            if (r.status === "rejected")
              console.warn(`[preview] upload _M${i + 1} gagal:`, r.reason);
          });
        }
        return;
      } catch (err) {
        console.error(
          `[preview] upload R2 gagal (attempt ${attempt + 1}):`,
          err,
        );
        if (attempt < attempts - 1)
          await new Promise((r) => setTimeout(r, 3000));
      }
    }
    if (uploadSeq.current === seq) setQrStatus("failed");
  }


  useEffect(() => {
    if (!isFinal || !licensed || !state.base) return; // upload cuma di preview final, frame udah fixed
    if (uploadedBase.current === state.base) return; // udah di-upload buat foto ini — jangan dobel
    // Kunci guard SEBELUM debounce → effect run kedua (render cepat) ke-skip di baris atas,
    // ga bisa spawn debounce ke-2 → NOL dobel upload R2. Cleanup buka lagi HANYA kalau debounce
    // ke-cancel sebelum jalan (StrictMode remount / frame ganti) — yang udah lolos (runUpload
    // jalan) tetep terkunci. Fix bug lama "guard di runUpload → race 600ms bisa dobel upload".
    uploadedBase.current = state.base;
    let fired = false;
    const debounce = setTimeout(() => {
      fired = true;
      runUpload(2);
    }, 600);
    return () => {
      clearTimeout(debounce);
      if (!fired) uploadedBase.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFinal, licensed, state.base]);

  // Satu QR = satu halaman microsite (ori/ai/video). Video kini di R2 (_C.mp4) → HP tamu buka
  // dari cloud, bukan LAN. Nutup lubang keamanan: kiosk aman di-bind 127.0.0.1.
  const qrValue = shareUrl;

  // Finalize video: mentah FAL → letterbox 2:3 + burn frame+QR. Jalan cuma di preview final,
  // sesudah QR (shareUrl) siap → QR yg di-burn = QR asli microsite, bukan placeholder.
  // FAIL-SAFE: gagal apa pun (ffmpeg/download/offline) → tetep pakai video mentah (preVideo).
  useEffect(() => {
    if (!isFinal || !preVideo || !state.base) return;
    if (finalizedBase.current === state.base) return; // udah difinalize buat foto ini
    if (licensed && !shareUrl) return; // licensed: tunggu QR asli dulu
    finalizedBase.current = state.base;
    let live = true;
    (async () => {
      setFinalizing(true);
      try {
        // QR JANGAN di-burn ke MP4 (lihat handleVideoConfirmOk) — overlay video = frame kepilih doang.
        const overlay = await buildVideoOverlay(
          currentFrame?.url ?? null,
          null,
        );
        const finalized = await finalizeVideo(
          preVideo,
          overlay,
          eventName,
          state.base!,
        );
        if (live && finalized) {
          setVideoUrl(finalized.blobUrl);
          setActiveTab("video");

          // Sama kayak manual: baca langsung dari C:/semeta/ via Node backend (bukan browser blob).
          if (licensed && state.base && finalized.localPath) {
            uploadLocalFile(finalized.localPath, "C", state.base, {
              eventName,
            }).catch((err) =>
              console.warn(
                "[preview] upload video _C (auto) lokal gagal:",
                err,
              ),
            );
          }
        }
      } finally {
        if (live) setFinalizing(false);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFinal, preVideo, state.base, shareUrl, licensed]);

  return (
    <div
      className="screen-split screen-split--center flex flex-col w-full h-full"
      style={{ overflow: "clip" }}
    >
      {/* QR tersembunyi — sumber SVG bersih buat di-burn ke video (share URL microsite asli). */}
      {isFinal && shareUrl && (
        <div
          ref={qrHiddenRef}
          aria-hidden
          style={{
            position: "absolute",
            width: 0,
            height: 0,
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          <QRCodeSVG
            value={shareUrl}
            size={240}
            bgColor="white"
            fgColor="#090135"
          />
        </div>
      )}
      <div className="screen-title text-center px-5 pt-5 pb-4">
        <h1
          className="h1-glow"
          style={{
            fontSize: "clamp(32px,5vw,48px)",
            fontWeight: 500,
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
            marginBottom: 8,
          }}
        >
          {t(isChoose ? "preview_title" : "delivery_title") as string}
        </h1>
        <p
          style={{
            fontSize: "var(--text-base)",
            fontWeight: 300,
            color: "var(--fg-muted)",
            lineHeight: 1.618,
            whiteSpace: "pre-line",
          }}
        >
          {t(isChoose ? "preview_subtitle" : "delivery_subtitle") as string}
        </p>
      </div>

      <div className="screen-content">
        {/* Tab switcher portrait-only — di atas foto, normal flow. Video cuma kalau vendor nyalain. */}
        {isFinal && videoAllowed && (
          <div
            className="preview-tab-switcher"
            style={{ justifyContent: "center", paddingBottom: 10 }}
          >
            <TabSwitcher
              activeTab={activeTab}
              videoUrl={videoUrl}
              videoLoading={videoLoading}
              onSwitch={setActiveTab}
            />
          </div>
        )}

        {/* Media area — position:relative jadi anchor tab switcher landscape */}
        <div
          className="flex-1 min-h-0 flex items-center justify-center gap-3"
          style={{ padding: 4, position: "relative" }}
        >
          {/* Tab switcher landscape-only — absolute top-center di atas foto, di luar overflow:hidden */}
          {isFinal && videoAllowed && (
            <div
              className="preview-tab-switcher-landscape"
              style={{
                position: "absolute",
                top: 35,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 50,
              }}
            >
              <TabSwitcher
                activeTab={activeTab}
                videoUrl={videoUrl}
                videoLoading={videoLoading}
                onSwitch={setActiveTab}
              />
            </div>
          )}



          {activeTab === "photo" && isChoose && (
            <button
              onClick={prevFrame}
              className="glass-btn"
              style={{
                flexShrink: 0,
                width: 48,
                height: 48,
                fontSize: "var(--text-xl)",
                padding: 0,
              }}
            >
              ‹
            </button>
          )}
          <div
            className={`preview-media${shownNative ? " preview-media--native" : ""}`}
            style={
              shownNative && shownDims
                ? ({
                    "--native-ratio": `${shownDims.w} / ${shownDims.h}`,
                  } as React.CSSProperties)
                : undefined
            }
          >
            {/* Media layer */}
            {activeTab === "photo" ? (
              <div
                className={`absolute inset-0${isPrintSession ? "" : " cursor-pointer"}${printing ? "" : " animate-photo-reveal-inner"}`}
                style={{
                  animation: printing
                    ? "print-eject 1200ms ease-in-out"
                    : undefined,
                }}
                onClick={
                  isPrintSession ? undefined : () => setShowOriginal((v) => !v)
                }
                onAnimationEnd={onPrintAnimEnd}
              >
                {!isChoose &&
                !showOriginal &&
                state.allResults &&
                state.allResults.length > 1 ? (
                  <div className="absolute inset-0 grid grid-cols-2 gap-0.5 bg-[#111]">
                    {state.allResults.map((r, i) => (
                      <div
                        key={i}
                        className="relative w-full h-full overflow-hidden"
                      >
                        <img
                          src={showOriginal ? r.originalUrl : r.aiUrl}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                        {visibleFrame && (
                          <img
                            src={visibleFrame.url}
                            className="absolute inset-0 w-full h-full object-cover pointer-events-none z-20"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    {activeResult.aiUrl ? (
                      <img
                        src={activeResult.aiUrl}
                        alt="AI result"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div
                        className="absolute inset-0"
                        style={{ background: "rgba(255,255,255,0.04)" }}
                      />
                    )}
                    {activeResult.originalUrl && (
                      <img
                        src={activeResult.originalUrl}
                        alt="Original"
                        className="absolute inset-0 w-full h-full object-cover z-10"
                        style={{
                          opacity: showOriginal ? 1 : 0,
                          transition: "opacity 0.3s ease",
                        }}
                      />
                    )}
                    {visibleFrame && (
                      <img
                        src={visibleFrame.url}
                        alt="Frame"
                        className="absolute inset-0 w-full h-full object-cover pointer-events-none z-20"
                      />
                    )}
                  </>
                )}{" "}
              </div>
            ) : (
              <div
                className="absolute inset-0 animate-fade-in"
                style={{ background: "#000" }}
              >
                {videoUrl ? (
                  <video
                    src={videoUrl}
                    autoPlay
                    loop
                    playsInline
                    muted
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p
                      style={{
                        color: "var(--fg-muted)",
                        fontSize: "var(--text-sm)",
                      }}
                    >
                      {t("preview_generating") as string}
                    </p>
                  </div>
                )}
                {currentFrame && (
                  <img
                    src={currentFrame.url}
                    alt="Frame"
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none z-20"
                  />
                )}
              </div>
            )}

            {/* Big QR Overlay on top of the photo (if enabled by button) */}
            {activeTab === "photo" && showBigQr && (
              <div 
                className="absolute inset-0 z-50 flex flex-col items-center justify-center animate-fade-in"
                style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(4px)" }}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowBigQr(false);
                }}
              >
                {!licensed ? (
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 16,
                      background: "white",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ position: "relative", width: 250, height: 250 }}>
                      <QRCodeSVG
                        value="https://spindonesia.id"
                        size={250}
                        bgColor="white"
                        fgColor="#090135"
                      />
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "rgba(255,255,255,1)",
                          borderRadius: 8,
                          padding: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 14,
                            lineHeight: 1.4,
                            fontWeight: 600,
                            color: "#090135",
                            textAlign: "center",
                            fontFamily: "var(--font-ui)",
                          }}
                        >
                          {config.has_secret
                            ? "Butuh sewa aktif — mulai rental di admin"
                            : "Belum ada kunci — isi di Settings"}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : qrValue ? (
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 16,
                      background: "white",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <QRCodeSVG
                      value={qrValue}
                      size={250}
                      bgColor="white"
                      fgColor="#090135"
                    />
                  </div>
                ) : qrStatus === "uploading" || qrStatus === "failed" ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (qrStatus !== "uploading") runUpload(1);
                    }}
                    disabled={qrStatus === "uploading"}
                    style={{
                      width: 250,
                      height: 250,
                      padding: 12,
                      borderRadius: 16,
                      background: "white",
                      border: "none",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                      cursor: qrStatus === "uploading" ? "default" : "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 12,
                    }}
                  >
                    {qrStatus === "uploading" ? (
                      <>
                        <span
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            border: "4px solid rgba(9,1,53,0.15)",
                            borderTopColor: "#090135",
                            animation: "spin 0.8s linear infinite",
                          }}
                        />
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#090135",
                            letterSpacing: "0.04em",
                          }}
                        >
                          Mengunggah…
                        </span>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: 32, lineHeight: 1, color: "#090135" }}>↻</span>
                        <span style={{ fontSize: 12, lineHeight: 1.25, fontWeight: 700, color: "#090135", textAlign: "center" }}>
                          Ulangi<br />QR
                        </span>
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      runUpload(1);
                    }}
                    style={{
                      width: 250,
                      height: 250,
                      padding: 12,
                      borderRadius: 16,
                      background: "white",
                      border: "none",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 10,
                      fontFamily: "var(--font-ui)",
                    }}
                  >
                    <span style={{ fontSize: 32, lineHeight: 1, color: "#090135" }}>↻</span>
                    <span style={{ fontSize: 12, lineHeight: 1.25, fontWeight: 700, color: "#090135", textAlign: "center" }}>
                      {state.base ? "Buat QR" : "Foto belum tersimpan"}
                    </span>
                  </button>
                )}
                
                {/* Close instruction */}
                <p style={{ marginTop: 24, fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.7)", letterSpacing: "0.05em" }}>
                  Ketuk untuk menutup
                </p>
              </div>
            )}

            {/* Light sweep + sparkle glint every 6s — glosses over both AI & Original */}
            {activeTab === "photo" && (
              <div className="preview-shine" aria-hidden="true">
                <span className="shine-haze" />
                <span className="shine-core" />
                <i
                  className="spark"
                  style={{
                    top: "20%",
                    left: "24%",
                    width: 26,
                    height: 26,
                    animationDelay: "0.25s",
                  }}
                />
                <i
                  className="spark"
                  style={{
                    top: "60%",
                    left: "55%",
                    width: 16,
                    height: 16,
                    animationDelay: "0.4s",
                  }}
                />
                <i
                  className="spark"
                  style={{
                    top: "38%",
                    left: "78%",
                    width: 20,
                    height: 20,
                    animationDelay: "0.5s",
                  }}
                />
              </div>
            )}

            {/* AI/Original badge — top left */}
            <div
              style={{
                position: "absolute",
                top: 12,
                left: 12,
                zIndex: 40,
                fontSize: "var(--text-2xs)",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                background: "rgba(255,255,255,0.15)",
                color: "rgba(255,255,255,0.8)",
                padding: "4px 10px",
                borderRadius: "var(--radius-chip)",
                backdropFilter: "blur(8px)",
              }}
            >
              {activeTab === "video"
                ? "Video"
                : isPrintSession
                  ? "Print"
                  : showOriginal
                    ? "Original"
                    : "AI"}
            </div>

            {/* Tap hint — bottom center (print: gak ada toggle AI/Asli) */}
            {activeTab === "photo" && !isPrintSession && (
              <div
                className="absolute bottom-3 inset-x-0 flex justify-center pointer-events-none"
                style={{ zIndex: 40 }}
              >
                <span
                  style={{
                    fontSize: "var(--text-2xs)",
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    background: "rgba(0,0,0,0.55)",
                    color: "var(--fg-muted)",
                    padding: "6px 14px",
                    borderRadius: "var(--radius-chip)",
                  }}
                >
                  {showOriginal
                    ? (t("preview_tap_see_ai") as string)
                    : (t("preview_tap_compare") as string)}
                </span>
              </div>
            )}
          </div>
          {activeTab === "photo" && isChoose && (
            <button
              onClick={nextFrame}
              className="glass-btn"
              style={{
                flexShrink: 0,
                width: 48,
                height: 48,
                fontSize: "var(--text-xl)",
                padding: 0,
              }}
            >
              ›
            </button>
          )}
        </div>
      </div>

      {/* Footer — 5 tombol; di landscape wrap 2/baris di kolom kiri */}
      <div className="screen-actions shrink-0 p-5">
        {/* Video progress — portrait: antara foto & tombol, landscape: atas tombol di kolom kiri */}
        {videoLoading && (
          <div style={{ paddingBottom: 12 }}>
            <div
              style={{
                height: 2,
                borderRadius: 2,
                background: "rgba(255,255,255,0.1)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  borderRadius: 2,
                  background: "linear-gradient(90deg, var(--brand), #00f5d4)",
                  width: `${videoProgress}%`,
                  transition: "width 0.7s ease",
                }}
              />
            </div>
            <span
              style={{
                fontSize: "var(--text-2xs)",
                color: "var(--fg-muted)",
                letterSpacing: "0.1em",
                marginTop: 4,
                display: "block",
              }}
            >
              {t("preview_generating_video") as string}{" "}
              {Math.round(videoProgress)}%
            </span>
          </div>
        )}

        {/* Expanded chooser panel (for multi-result print/video selection) */}
        {chooserAction && state.allResults && (
          <div
            className="animate-fade-in"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 200,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(9,1,53,0.72)",
              backdropFilter: "blur(8px)",
            }}
            onClick={() => setChooserAction(null)}
          >
            <div
              className="animate-fade-in"
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "rgba(20,10,70,0.95)",
                border: "1px solid var(--border-dialog)",
                borderRadius: "var(--radius-dialog)",
                padding: "32px",
                width: "90%",
                maxWidth: 460,
                boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
              }}
            >
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--fg-muted)",
                  marginBottom: 16,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  textAlign: "center",
                }}
              >
                Pick which one to{" "}
                {chooserAction === "print" ? "print" : "animate"}
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 20,
                }}
              >
                {state.allResults.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setResultIndex(i);
                      if (chooserAction === "print") {
                        setQty(1);
                      } else {
                        setShowVideoConfirm(true);
                      }
                      setChooserAction(null);
                    }}
                    className="relative aspect-[2/3] rounded-xl overflow-hidden active:scale-[0.97] transition-all"
                    style={{
                      border:
                        resultIndex === i
                          ? "2px solid var(--brand)"
                          : "2px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    <img
                      src={r.aiUrl}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
              <TouchButton
                variant="secondary"
                onClick={() => setChooserAction(null)}
                className="w-full"
              >
                {t("preview_print_cancel") as string}
              </TouchButton>
            </div>
          </div>
        )}

        {/* Expanded print panel — full width takeover */}
        {qty !== null && (
          <div className="preview-expand-backdrop" onClick={() => setQty(null)}>
            <div
              className="preview-expand-panel"
              onClick={(e) => e.stopPropagation()}
            >
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--fg-muted)",
                  marginBottom: 16,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                {t("preview_print_qty_label") as string}
              </p>
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    width: 80,
                    height: 120,
                    borderRadius: 8,
                    overflow: "hidden",
                    position: "relative",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <img
                    src={
                      (showOriginal
                        ? activeResult.originalUrl
                        : activeResult.aiUrl) || undefined
                    }
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                  {visibleFrame && (
                    <img
                      src={visibleFrame.url}
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  )}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0,
                  background: "rgba(255,255,255,0.06)",
                  borderRadius: 16,
                  overflow: "hidden",
                  marginBottom: 20,
                }}
              >
                <button
                  onClick={() => setQty((q) => Math.max(1, (q ?? 1) - 1))}
                  style={{
                    flex: 1,
                    padding: "18px 0",
                    fontSize: "var(--text-xl)",
                    color: "#fff",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  −
                </button>
                <span
                  style={{
                    flex: 1,
                    textAlign: "center",
                    fontSize: "var(--text-2xl)",
                    fontWeight: 600,
                    color: "#fff",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  {qty}
                </span>
                <button
                  onClick={() => setQty((q) => (q ?? 1) + 1)}
                  style={{
                    flex: 1,
                    padding: "18px 0",
                    fontSize: "var(--text-xl)",
                    color: "#fff",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  +
                </button>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <TouchButton
                  variant="secondary"
                  onClick={() => setQty(null)}
                  className="flex-1"
                >
                  {t("preview_print_cancel") as string}
                </TouchButton>
                <TouchButton onClick={handlePrintBtn} className="flex-1">
                  {printing
                    ? (t("preview_printing") as string)
                    : `${t("preview_print_btn") as string} ${qty}x`}
                </TouchButton>
              </div>
            </div>
          </div>
        )}

        {/* Expanded email panel — full width takeover */}
        {emailMode && (
          <div
            className="preview-expand-backdrop"
            onClick={() => {
              setEmailMode(false);
              setEmail("");
              setEmailError(false);
            }}
          >
            <div
              className="preview-expand-panel"
              onClick={(e) => e.stopPropagation()}
            >
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--fg-muted)",
                  marginBottom: 16,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                {t("preview_email_label") as string}
              </p>
              <div style={{ position: "relative", marginBottom: 20 }}>
                {emailError && (
                  <span
                    style={{
                      position: "absolute",
                      top: -20,
                      left: 4,
                      fontSize: "var(--text-2xs)",
                      color: "#ff6b6b",
                    }}
                  >
                    {t("preview_email_invalid") as string}
                  </span>
                )}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    background: "rgba(255,255,255,0.08)",
                    border: `1px solid ${emailError ? "#ff6b6b" : "rgba(255,255,255,0.15)"}`,
                    borderRadius: 14,
                    padding: "0 16px",
                    transition: "border-color 0.2s",
                  }}
                >
                  <input
                    ref={inputRef}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setEmailError(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleEmailSend();
                      if (e.key === "Escape") {
                        setEmailMode(false);
                        setEmail("");
                        setEmailError(false);
                      }
                    }}
                    placeholder={t("preview_email_placeholder") as string}
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "none",
                      fontSize: "var(--text-base)",
                      fontFamily: "var(--font-ui)",
                      outline: "none",
                      color: "#fff",
                      padding: "16px 0",
                      caretColor: "white",
                    }}
                  />
                  {email && (
                    <button
                      onClick={handleEmailSend}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: "0 4px",
                        color: "rgba(255,255,255,0.8)",
                        fontSize: "var(--text-lg)",
                        flexShrink: 0,
                      }}
                    >
                      ➤
                    </button>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <TouchButton
                  variant="secondary"
                  onClick={() => {
                    setEmailMode(false);
                    setEmail("");
                    setEmailError(false);
                  }}
                  className="flex-1"
                >
                  {t("preview_email_cancel") as string}
                </TouchButton>
                <TouchButton onClick={handleEmailSend} className="flex-1">
                  {t("preview_email_send") as string}
                </TouchButton>
              </div>
            </div>
          </div>
        )}

        {isChoose ? (
          // Frame chooser footer — Back (re-pilih template) + Next (bawa frame ke preview).
          <div className="screen-actions-row flex gap-3">
            <TouchButton
              variant="secondary"
              onClick={() => dispatch({ type: "BACK" })}
              className="flex-1"
            >
              {t("nav_back") as string}
            </TouchButton>
            <TouchButton
              onClick={() =>
                dispatch({ type: "CONFIRM_FRAME", frame: currentFrame })
              }
              className="flex-1"
            >
              {t("nav_next") as string}
            </TouchButton>
          </div>
        ) : (
          <div className="screen-actions-row flex gap-3">
            {config.enable_print && (
              <TouchButton
                onClick={() => {
                  if (
                    !showOriginal &&
                    state.allResults &&
                    state.allResults.length > 1
                  )
                    setChooserAction("print");
                  else setQty(1);
                }}
                className="flex-1"
                disabled={printing}
              >
                {printing
                  ? (t("preview_printing") as string)
                  : (t("preview_btn_print") as string)}
              </TouchButton>
            )}
            {config.enable_email && (
              <TouchButton
                onClick={handleEmailBtn}
                className="flex-1"
                disabled={printing}
              >
                {t("preview_btn_email") as string}
              </TouchButton>
            )}
            <TouchButton
              onClick={() => setShowBigQr(true)}
              className="flex-1"
              disabled={printing || activeTab === "video"}
            >
              QR Code
            </TouchButton>
            {videoAllowed && (
              <TouchButton
                onClick={() => {
                  if (
                    !showOriginal &&
                    state.allResults &&
                    state.allResults.length > 1 &&
                    !videoUrl
                  )
                    setChooserAction("video");
                  else setShowVideoConfirm(true);
                }}
                className="flex-1"
                disabled={printing || videoLoading || !!videoUrl}
              >
                <span
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    lineHeight: 1.2,
                  }}
                >
                  <span style={{ fontSize: "var(--text-sm)" }}>
                    {videoUrl
                      ? (t("preview_btn_video_ready") as string)
                      : videoLoading
                        ? (t("preview_generating") as string)
                        : (t("preview_btn_make_video") as string)}
                  </span>
                  {!videoUrl && !videoLoading && (
                    <span
                      style={{
                        fontSize: "var(--text-2xs)",
                        opacity: 0.55,
                        fontWeight: 400,
                      }}
                    >
                      {videoCost != null
                        ? `${videoCost} Token`
                        : (t("preview_video_cost_note") as string)}
                    </span>
                  )}
                </span>
              </TouchButton>
            )}
            <TouchButton
              variant="secondary"
              onClick={() => dispatch({ type: "BACK" })}
              className="flex-1"
              disabled={printing}
            >
              {t("preview_btn_rechoose") as string}
            </TouchButton>
            <TouchButton
              variant="secondary"
              onClick={() => dispatch({ type: "RESET" })}
              className="flex-1"
              disabled={printing}
            >
              {t("preview_btn_restart") as string}
            </TouchButton>
          </div>
        )}
      </div>

      {/* Email sent celebration popup */}
      {emailSent && (
        <div
          className="animate-fade-in"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(9,1,53,0.6)",
            backdropFilter: "blur(8px)",
            pointerEvents: "none",
          }}
        >
          <div
            className="animate-fade-in"
            style={{
              background: "rgba(20,10,70,0.95)",
              border: "1px solid var(--border-dialog)",
              borderRadius: "var(--radius-preview)",
              padding: "48px 44px",
              maxWidth: 400,
              width: "80%",
              textAlign: "center",
              boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
            }}
          >
            <div style={{ fontSize: "var(--text-3xl)", marginBottom: 16 }}>
              📬
            </div>
            <h2
              style={{
                fontSize: "var(--text-xl)",
                fontWeight: 600,
                marginBottom: 12,
                letterSpacing: "-0.02em",
              }}
            >
              {t("preview_email_sent_title") as string}
            </h2>
            <p
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--fg-muted)",
                lineHeight: 1.7,
              }}
            >
              {t("preview_email_sent_body") as string}
            </p>
          </div>
        </div>
      )}

      {/* Out of tokens popup (worker 402) */}
      {noTokens && (
        <div
          className="animate-fade-in"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(9,1,53,0.72)",
            backdropFilter: "blur(8px)",
          }}
          onClick={() => setNoTokens(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "rgba(20,10,70,0.95)",
              border: "1px solid var(--border-dialog)",
              borderRadius: "var(--radius-dialog)",
              padding: "40px 36px",
              maxWidth: 420,
              width: "80%",
              textAlign: "center",
              boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
            }}
          >
            <div style={{ fontSize: "var(--text-3xl)", marginBottom: 16 }}>
              🪙
            </div>
            <h2
              style={{
                fontSize: "var(--text-lg)",
                fontWeight: 600,
                marginBottom: 12,
                letterSpacing: "-0.02em",
              }}
            >
              Oops — out of tokens!
            </h2>
            <p
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--fg-muted)",
                lineHeight: 1.6,
                marginBottom: 28,
              }}
            >
              Your video credits just ran out. Please contact the admin to top
              up and keep the magic rolling. ✨
            </p>
            <TouchButton onClick={() => setNoTokens(false)} className="w-full">
              Got it
            </TouchButton>
          </div>
        </div>
      )}

      {/* Make Video confirm dialog */}
      {showVideoConfirm && (
        <div
          className="animate-fade-in"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(9,1,53,0.7)",
            backdropFilter: "blur(8px)",
          }}
          onClick={() => { setShowVideoConfirm(false); setShowVideoChoices(false); }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "rgba(20,10,70,0.92)",
              border: "1px solid var(--border-dialog)",
              borderRadius: "var(--radius-dialog)",
              padding: "40px 36px",
              maxWidth: 420,
              width: "80%",
              textAlign: "center",
              boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 80,
                  height: 120,
                  borderRadius: 8,
                  overflow: "hidden",
                  position: "relative",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <img
                  src={
                    (showOriginal
                      ? activeResult.originalUrl
                      : activeResult.aiUrl) || undefined
                  }
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
                {visibleFrame && (
                  <img
                    src={visibleFrame.url}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                )}
              </div>
            </div>
            <h2
              style={{
                fontSize: "var(--text-lg)",
                fontWeight: 500,
                marginBottom: 12,
                letterSpacing: "-0.02em",
              }}
            >
              {t("preview_video_dialog_title") as string}
            </h2>
            <p
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--fg-muted)",
                lineHeight: 1.6,
                marginBottom: 32,
              }}
            >
              {t("preview_video_dialog_body") as string}
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <TouchButton onClick={handleVideoConfirmOk} className="flex-1">
                {t("preview_video_dialog_ok") as string}
              </TouchButton>
              <TouchButton
                variant="secondary"
                onClick={() => setShowVideoConfirm(false)}
                className="flex-1"
              >
                {t("preview_video_dialog_cancel") as string}
              </TouchButton>
            </div>
          </div>
        </div>
      )}

      {/* Video Style Choices — popup milih gaya gerak SEBELUM video di-generate.
          Muncul kalau config.video_prompt_choices terisi & user klik OK di confirm dialog.
          Pilih salah satu → handleVideoConfirmOk(choice) → langsung generate. */}
      {showVideoChoices && (
        <div
          className="animate-fade-in"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(9,1,53,0.85)",
            backdropFilter: "blur(12px)",
          }}
          onClick={() => setShowVideoChoices(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "rgba(20,10,70,0.95)",
              border: "1px solid var(--border-dialog)",
              borderRadius: "var(--radius-dialog)",
              padding: "40px 32px",
              maxWidth: 520,
              width: "88%",
              textAlign: "center",
              boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
            }}
          >
            <h2
              style={{
                fontSize: "var(--text-xl)",
                fontWeight: 600,
                marginBottom: 8,
                letterSpacing: "-0.02em",
              }}
            >
              Pilih Gaya Video
            </h2>
            <p
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--fg-muted)",
                lineHeight: 1.5,
                marginBottom: 28,
              }}
            >
              Mau gerakan kayak gimana?
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {(config.video_prompt_choices ?? []).map((c) => (
                <TouchButton
                  key={c.id}
                  onClick={() =>
                    handleVideoConfirmOk({
                      positive: c.positive_prompt,
                      negative: c.negative_prompt,
                    })
                  }
                  className="w-full"
                  style={{ fontSize: "var(--text-base)", padding: "18px 24px" }}
                >
                  {c.title}
                </TouchButton>
              ))}
              <TouchButton
                variant="secondary"
                onClick={() => setShowVideoChoices(false)}
                className="w-full"
                style={{ marginTop: 4 }}
              >
                Batal
              </TouchButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
