"""
Semeta Face Server — InsightFace + CodeFormer
Port of LPS-smartmodule/aiphotobooth/face_swap_server.py
Added: /detect endpoint returning all face bboxes (for FaceAssign UI)

Run:
  pip install -r requirements.txt
  python face_server.py

GPU (optional):
  pip install onnxruntime-gpu
"""

import os
import threading
import time

# Must be before any onnxruntime import (insightface loads it at import time)
if os.name == "nt":
    _base = os.path.dirname(os.path.abspath(__file__))
    _cudnn = os.path.join(_base, "venv", "Lib", "site-packages", "nvidia", "cudnn", "bin")
    _cublas = os.path.join(_base, "venv", "Lib", "site-packages", "nvidia", "cublas", "bin")
    os.environ["PATH"] = _cudnn + os.pathsep + _cublas + os.pathsep + os.environ.get("PATH", "")
    if hasattr(os, "add_dll_directory"):
        if os.path.exists(_cudnn): os.add_dll_directory(_cudnn)
        if os.path.exists(_cublas): os.add_dll_directory(_cublas)

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
import json
import cv2
import numpy as np
import insightface
import insightface.utils.face_align as face_align
import onnxruntime as ort
from io import BytesIO
from contextlib import asynccontextmanager

import comfy_client  # graph builder + HTTP ke ComfyUI :8188 (stdlib only, same dir)

face_analyser = None
face_swapper = None
codeformer_enhancer = None
active_provider = "unknown"

# CodeFormer fidelity weight [0..1]. 0.5 = default resmi CodeFormer. Tested 0.5/0.7/1.0 di photobooth:
# beda tipis, 0.5 dipilih (paling mulus, cukup jaga identitas). Override per-request via form `cf_weight`.
CF_WEIGHT_DEFAULT = 0.5


def _clamp_cf_weight(v):
    """cf_weight harus float di [0,1]. Invalid/None → default. Bukan angka → default."""
    if v is None:
        return CF_WEIGHT_DEFAULT
    try:
        f = float(v)
    except (ValueError, TypeError):
        return CF_WEIGHT_DEFAULT
    return min(1.0, max(0.0, f))


# Denoise img2img [0.10, 0.95] — di bawah 0.10 nyaris no-op, di atas 0.95 identitas hilang total.
DENOISE_DEFAULT = 0.65
DENOISE_MIN = 0.10
DENOISE_MAX = 0.95


def _clamp_denoise(v):
    """denoise harus float di [0.10, 0.95]. Invalid/None → default. Mirror _clamp_cf_weight."""
    if v is None:
        return DENOISE_DEFAULT
    try:
        f = float(v)
    except (ValueError, TypeError):
        return DENOISE_DEFAULT
    return min(DENOISE_MAX, max(DENOISE_MIN, f))


class CodeFormerEnhancer:
    def __init__(self, model_path, providers):
        self.session = ort.InferenceSession(model_path, providers=providers)
        self.input_name = self.session.get_inputs()[0].name
        self.weight_name = self.session.get_inputs()[1].name

    def enhance(self, img, target_face, cf_weight=CF_WEIGHT_DEFAULT):
        M = face_align.estimate_norm(target_face.kps, 512)
        crop = cv2.warpAffine(img, M, (512, 512), borderMode=cv2.BORDER_REPLICATE)

        crop_norm = crop.astype(np.float32) / 255.0
        crop_norm = (crop_norm - 0.5) / 0.5
        crop_rgb = cv2.cvtColor(crop_norm, cv2.COLOR_BGR2RGB)
        crop_chw = np.transpose(crop_rgb, (2, 0, 1))
        input_tensor = np.expand_dims(crop_chw, axis=0)
        # CodeFormer fidelity: kecil = mulus tapi identitas melenceng, besar = setia ke wajah.
        # Face swap photobooth (close-up) → 0.7 default (jaga identitas hasil swap). Riset: sczhou/CodeFormer.
        weight = np.array([cf_weight], dtype=np.double)

        outputs = self.session.run(None, {self.input_name: input_tensor, self.weight_name: weight})
        out_tensor = outputs[0][0]

        out_hwc = np.transpose(out_tensor, (1, 2, 0))
        out_bgr = cv2.cvtColor(out_hwc, cv2.COLOR_RGB2BGR)
        out_img = np.clip((out_bgr * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)

        M_inv = cv2.invertAffineTransform(M)
        mask = np.zeros((512, 512), dtype=np.float32)
        cv2.circle(mask, (256, 256), 240, 1.0, -1)
        mask = cv2.GaussianBlur(mask, (51, 51), 0)

        out_warped = cv2.warpAffine(out_img, M_inv, (img.shape[1], img.shape[0]), borderMode=cv2.BORDER_TRANSPARENT)
        mask_warped = cv2.warpAffine(mask, M_inv, (img.shape[1], img.shape[0]), borderMode=cv2.BORDER_CONSTANT)
        mask_warped = np.expand_dims(mask_warped, axis=-1)

        return (img * (1.0 - mask_warped) + out_warped * mask_warped).astype(np.uint8)


def detect_provider():
    global active_provider
    available = ort.get_available_providers()
    if "CUDAExecutionProvider" in available:
        active_provider = "GPU (CUDA)"
        print("[semeta] GPU detected — CUDAExecutionProvider")
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    active_provider = "CPU"
    print("[semeta] No GPU — CPUExecutionProvider")
    return ["CPUExecutionProvider"]


def load_models():
    global face_analyser, face_swapper, codeformer_enhancer
    providers = detect_provider()
    base = os.path.dirname(os.path.abspath(__file__))

    face_analyser = insightface.app.FaceAnalysis(name="buffalo_l", providers=providers)
    face_analyser.prepare(ctx_id=0, det_size=(640, 640))

    swap_path = os.path.join(base, "inswapper_128.onnx")
    face_swapper = insightface.model_zoo.get_model(swap_path, providers=providers)

    cf_path = os.path.join(base, "codeformer.onnx")
    if os.path.exists(cf_path):
        codeformer_enhancer = CodeFormerEnhancer(cf_path, providers)
        print("[semeta] CodeFormer loaded")

    print(f"[semeta] Models ready — provider: {active_provider}")


# Kiosk = satu tamu diproses sekaligus (sequential by design). Lock ini serialize SEMUA
# panggilan ke ComfyUI (warmup + /stylize) — tanpa ini, warmup bisa masih ngantre pas tamu
# pertama generate: dua job numpuk di satu GPU, /stylize/interrupt jadi nembak job yang
# salah (ComfyUI /api/interrupt stop yang LAGI JALAN, gak scoped per prompt_id).
comfy_lock = threading.Lock()


def _comfy_warmup():
    """Cold start ComfyUI ~15s (load checkpoint+VAE+CLIP+ControlNet dari disk) dan itu
    kena TAMU PERTAMA. Warmup: tunggu ComfyUI hidup (LAUNCHER nyalain barengan), masak
    1 job mini di background biar semua model udah staged sebelum ada tamu.
    ponytail: warmup pake checkpoint default doang — operator ganti checkpoint lain =
    shot pertamanya tetep kena load sekali."""
    deadline = time.time() + 180
    while time.time() < deadline:
        if comfy_client.comfy_alive():
            break
        time.sleep(5)
    else:
        print("[semeta] comfy warmup skip — :8188 gak hidup dalam 180s")
        return
    # Tamu udah keburu generate duluan (operator cepet) → comfy_lock lagi dipegang;
    # warmup gak ada gunanya lagi (checkpoint pasti udah ke-load oleh job tamu itu), skip.
    if not comfy_lock.acquire(blocking=False):
        print("[semeta] comfy warmup skip — tamu pertama udah generate duluan")
        return
    try:
        blank = np.zeros((768, 512, 3), dtype=np.uint8)
        _, buf = cv2.imencode(".jpg", blank)
        # denoise 0.3 → cuma ~9 step efektif; yang penting model ke-load, bukan hasilnya
        comfy_client.stylize(
            buf.tobytes(), positive="warmup", negative="", family="sd15",
            checkpoint="epicrealism_pureEvolutionV5.safetensors",
            controlnet="canny", denoise=0.3)
        print("[semeta] comfy warmup done — checkpoint staged, tamu pertama bebas cold start")
    except Exception as e:  # non-fatal — warmup gagal cuma berarti tamu pertama nunggu load
        print(f"[semeta] comfy warmup gagal (non-fatal): {e}")
    finally:
        comfy_lock.release()


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_models()
    threading.Thread(target=_comfy_warmup, daemon=True).start()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health():
    return {"status": "ok", "models_loaded": face_swapper is not None, "provider": active_provider}


# Filter thresholds — buang "muka" palsu (blur, background, orang lewat) dari hasil detect.
MIN_DET_SCORE = 0.55   # confidence InsightFace; blur/background biasanya < 0.5
MIN_AREA_RATIO = 0.12  # muka < 12% area muka terbesar = background face, dibuang


def _bbox_area(f):
    return (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1])


def filter_real_faces(faces):
    """Keep faces yang beneran subjek: skor deteksi cukup + ukuran ga jauh lebih kecil dari yang terbesar.
    Blur/background face skornya rendah ATAU kecil. Kalau semua ke-filter, balikin 1 skor tertinggi
    (jangan sampai kosong — mending 1 kandidat daripada nol)."""
    if not faces:
        return []
    max_area = max(_bbox_area(f) for f in faces)
    kept = [
        f for f in faces
        if getattr(f, "det_score", 1.0) >= MIN_DET_SCORE
        and _bbox_area(f) >= MIN_AREA_RATIO * max_area
    ]
    if kept:
        return kept
    return [max(faces, key=lambda f: getattr(f, "det_score", 0.0))]


def resolve_pairs(mapping_str, n_template, n_selfie):
    """Per template face i (L-R) → index selfie face (L-R) yang di-swap. None = slot dilewat.
    mapping_str kosong/invalid → default identitas L-R (swap semua, slot i <- selfie i, clamp).
    Entry out-of-range / bukan int → None. Sinkron sama index UI karena filter+sort sama /detect."""
    pairs = None
    if mapping_str:
        try:
            parsed = json.loads(mapping_str)
            if isinstance(parsed, list):
                pairs = parsed
        except (ValueError, TypeError):
            pairs = None
    if pairs is None:
        return [i if i < n_selfie else None for i in range(n_template)]
    out = []
    for i in range(n_template):
        v = pairs[i] if i < len(pairs) else None
        out.append(v if isinstance(v, int) and 0 <= v < n_selfie else None)
    return out


def _selfcheck_resolve_pairs():
    assert resolve_pairs(None, 2, 2) == [0, 1]           # default identity
    assert resolve_pairs("[1,0]", 2, 2) == [1, 0]        # explicit reversed
    assert resolve_pairs("[null,1]", 2, 2) == [None, 1]  # slot 0 skipped
    assert resolve_pairs("[0,5]", 2, 2) == [0, None]     # out-of-range → None
    assert resolve_pairs("bad", 3, 2) == [0, 1, None]    # invalid → identity + clamp
    assert resolve_pairs("[0]", 2, 2) == [0, None]       # short list → rest None


def _selfcheck_cf_weight():
    assert _clamp_cf_weight(None) == CF_WEIGHT_DEFAULT   # kosong → default (0.5)
    assert _clamp_cf_weight("bad") == CF_WEIGHT_DEFAULT  # invalid → default
    assert _clamp_cf_weight("0.5") == 0.5                # valid string
    assert _clamp_cf_weight("1.8") == 1.0                # clamp atas
    assert _clamp_cf_weight("-0.3") == 0.0               # clamp bawah


def _selfcheck_denoise():
    assert _clamp_denoise(None) == DENOISE_DEFAULT       # kosong → default (0.65)
    assert _clamp_denoise("bad") == DENOISE_DEFAULT      # invalid → default
    assert _clamp_denoise("0.5") == 0.5                  # valid string
    assert _clamp_denoise("2.0") == DENOISE_MAX          # clamp atas (0.95)
    assert _clamp_denoise("0.01") == DENOISE_MIN         # clamp bawah (0.10)


@app.post("/detect")
async def detect_faces(image: UploadFile = File(...)):
    """Return real face bounding boxes (left-to-right), for the FaceAssign UI.
    Blur/background faces are filtered out — see filter_real_faces."""
    img_bytes = await image.read()
    img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return JSONResponse({"error": "Invalid image"}, status_code=400)

    faces = filter_real_faces(face_analyser.get(img))
    # bbox is [x1, y1, x2, y2] — convert to {x, y, w, h}
    return {
        "faces": [
            {
                "x": int(f.bbox[0]),
                "y": int(f.bbox[1]),
                "w": int(f.bbox[2] - f.bbox[0]),
                "h": int(f.bbox[3] - f.bbox[1]),
                "score": round(float(getattr(f, "det_score", 1.0)), 3),
            }
            for f in sorted(faces, key=lambda f: f.bbox[0])
        ]
    }


@app.post("/swap")
async def swap_face(
    template: UploadFile = File(...),
    selfie: UploadFile = File(...),
    mapping: str = Form(None),
    cf_weight: str = Form(None),
):
    """Multi-face swap: tiap muka template (L-R) di-swap sama muka selfie yang di-assign lewat
    `mapping` (dari FaceAssign UI). Tanpa mapping → default swap SEMUA muka urut L-R.
    Filter + sort L-R SAMA PERSIS kayak /detect biar index mapping sinkron sama UI.

    `cf_weight` [0..1] opsional → fidelity CodeFormer buat A/B test (default 0.7). Kosong = default.

    Watermark is NOT applied here. The kiosk client burns the local copies (original + AI) in
    one place when unlicensed (lib/watermark-canvas.ts) so preview/print/save share one canvas.
    """
    start = time.time()
    cf_w = _clamp_cf_weight(cf_weight)

    template_img = cv2.imdecode(np.frombuffer(await template.read(), np.uint8), cv2.IMREAD_COLOR)
    selfie_img = cv2.imdecode(np.frombuffer(await selfie.read(), np.uint8), cv2.IMREAD_COLOR)

    template_faces = sorted(filter_real_faces(face_analyser.get(template_img)), key=lambda f: f.bbox[0])
    if not template_faces:
        return JSONResponse({"error": "No face in template"}, status_code=400)
    selfie_faces = sorted(filter_real_faces(face_analyser.get(selfie_img)), key=lambda f: f.bbox[0])
    if not selfie_faces:
        return JSONResponse({"error": "No face in selfie"}, status_code=400)

    pairs = resolve_pairs(mapping, len(template_faces), len(selfie_faces))

    # Swap tiap muka berurutan ke result yang sama — muka ga overlap jadi bbox awal tetep valid.
    result_img = template_img
    swapped = 0
    for tface, src_idx in zip(template_faces, pairs):
        if src_idx is None:
            continue
        result_img = face_swapper.get(result_img, tface, selfie_faces[src_idx], paste_back=True)
        if codeformer_enhancer:
            result_img = codeformer_enhancer.enhance(result_img, tface, cf_w)
        swapped += 1

    # Semua slot ke-skip (mapping nyasar) → jangan balikin template mentah; fallback biggest<->biggest.
    if swapped == 0:
        t = max(template_faces, key=_bbox_area)
        s = max(selfie_faces, key=_bbox_area)
        result_img = face_swapper.get(template_img, t, s, paste_back=True)
        if codeformer_enhancer:
            result_img = codeformer_enhancer.enhance(result_img, t, cf_w)

    _, buf = cv2.imencode(".jpg", result_img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print(f"[semeta] swap done in {round(time.time() - start, 2)}s, {swapped}/{len(template_faces)} faces, cf_weight={cf_w} ({active_provider})")

    io = BytesIO(buf.tobytes())
    io.seek(0)
    return StreamingResponse(io, media_type="image/jpeg")


@app.get("/capabilities")
def capabilities():
    """Kiosk nanya kemampuan stylize — kiosk gak perlu tau ComfyUI ada di baliknya.
    def (bukan async): probe urllib blocking (timeout 2s) jalan di threadpool FastAPI."""
    try:
        families = comfy_client.list_checkpoints()
        controlnets = comfy_client.list_controlnets()  # canny + depth kalau modelnya ada
        alive = True
    except (OSError, ValueError):  # URLError subclass OSError; ValueError = JSON rusak
        families, controlnets, alive = {}, [], False
    return {
        "stylize": alive,
        "families": families,
        "controlnets": controlnets,
        "face_lock": face_swapper is not None,
    }


def _apply_face_lock(selfie_img, result_img):
    """Swap muka tamu (dari selfie ASLI) balik ke hasil stylize — pengganti node ReActor
    (custom node, bukan comfy-core). MULTI-FACE: urut kiri→kanan di dua sisi, pasangkan
    per-index (konvensi L-R yang sama dengan resolve_pairs di /swap) — grup 3-5 orang
    ke-lock semua. Jumlah timpang → swap sebanyak min(n), sisanya dibiarin (hasil stylize
    kadang 'ngilangin' muka; jangan maksa pasangan salah). Muka gak ketemu di salah satu
    sisi → skip graceful. -> (img, locked_count)"""
    guest_faces = filter_real_faces(face_analyser.get(selfie_img))
    if not guest_faces:
        print("[semeta] face lock skip — no face in selfie")
        return result_img, 0
    result_faces = filter_real_faces(face_analyser.get(result_img))
    if not result_faces:
        print("[semeta] face lock skip — no face in stylized result")
        return result_img, 0
    guest_faces.sort(key=lambda f: f.bbox[0])
    result_faces.sort(key=lambda f: f.bbox[0])
    n = min(len(guest_faces), len(result_faces))
    out = result_img
    for guest, target in zip(guest_faces[:n], result_faces[:n]):
        out = face_swapper.get(out, target, guest, paste_back=True)
        if codeformer_enhancer:
            out = codeformer_enhancer.enhance(out, target, CF_WEIGHT_DEFAULT)
    if n < max(len(guest_faces), len(result_faces)):
        print(f"[semeta] face lock partial — {len(guest_faces)} muka selfie vs "
              f"{len(result_faces)} di hasil, ke-lock {n}")
    return out, n


@app.post("/stylize")
def stylize(
    selfie: UploadFile = File(...),
    positive: str = Form(""),
    negative: str = Form(""),
    family: str = Form("sd15"),
    checkpoint: str = Form("epicrealism_pureEvolutionV5.safetensors"),
    controlnet: str = Form("canny"),
    denoise: str = Form(None),
    face_lock: str = Form("true"),
    sampler: str = Form(None),
    scheduler: str = Form(None),
    cfg: str = Form(None),
    steps: str = Form(None),
    cn_strength: str = Form(None),
):
    """Restyle selfie via ComfyUI img2img + face lock post-pass insightface —
    identitas tamu kejaga walau denoise tinggi. Error = HTTPException {"detail"}.
    def (bukan async): comfy blocking sampai ~110s — sync route jalan di threadpool
    FastAPI, /health & /capabilities tetep responsif selama generate."""
    start = time.time()
    if family not in ("sd15", "sdxl", "flux"):
        raise HTTPException(status_code=400, detail=f"Unknown family '{family}'")
    # Cross-check family vs checkpoint — mismatch (mis. graph flux + ckpt sd15) gak
    # meledak di ComfyUI, tapi hasilnya rusak diam-diam / error buram di lapangan.
    # ponytail: heuristik nama (classify_family), bukan inspeksi file — ceiling sama
    # dengan heuristik dropdown /capabilities, jadi konsisten dua arah.
    ckpt_family = comfy_client.classify_family(checkpoint)
    if ckpt_family != family:
        raise HTTPException(
            status_code=400,
            detail=f"Checkpoint '{checkpoint}' kedeteksi {ckpt_family}, bukan {family} — "
                   f"cek setting Model family / Checkpoint")
    # depth = MiDaS preprocessor + control_v11f1p_sd15_depth (bb51975). normalize_controlnet
    # cuma jatuh ke 'canny' kalau nilainya gak dikenal; 'depth' lolos apa adanya. /capabilities
    # gak nawarin depth kalau model/node-nya gak ada di mesin, jadi UI gak bisa milih yang absen.
    controlnet = comfy_client.normalize_controlnet(controlnet)
    denoise_f = _clamp_denoise(denoise)
    lock = face_lock.strip().lower() != "false"

    selfie_bytes = selfie.file.read()
    selfie_img = cv2.imdecode(np.frombuffer(selfie_bytes, np.uint8), cv2.IMREAD_COLOR)
    if selfie_img is None:
        raise HTTPException(status_code=400, detail="Invalid selfie image")

    # Serialize semua job ke ComfyUI (kiosk = satu GPU, satu tamu diproses sekaligus) —
    # kalau warmup masih jalan pas tamu generate, tunggu di sini alih-alih numpuk 2 job
    # (numpuk bikin /stylize/interrupt nembak job yang salah, lihat comfy_lock di atas).
    with comfy_lock:
        try:
            result_bytes = comfy_client.stylize(
                selfie_bytes, positive=positive, negative=negative, family=family,
                checkpoint=checkpoint, controlnet=controlnet, denoise=denoise_f,
                sampler=sampler, scheduler=scheduler, cfg=cfg, steps=steps, cn_strength=cn_strength)
        except (RuntimeError, TimeoutError, OSError) as e:
            raise HTTPException(status_code=502, detail=f"ComfyUI: {e}")

    # PreviewImage keluarin PNG — decode lalu re-encode jpg (contract: image/jpeg)
    result_img = cv2.imdecode(np.frombuffer(result_bytes, np.uint8), cv2.IMREAD_COLOR)
    if result_img is None:
        raise HTTPException(status_code=502, detail="ComfyUI returned non-image output")

    locked = 0  # jumlah muka yang ke-lock (multi-face L-R)
    if lock and face_swapper is not None:
        result_img, locked = _apply_face_lock(selfie_img, result_img)

    _, buf = cv2.imencode(".jpg", result_img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print(f"[semeta] stylize done in {round(time.time() - start, 2)}s "
          f"family={family} cn={controlnet} denoise={denoise_f} face_lock={locked} ({active_provider})")

    io = BytesIO(buf.tobytes())
    io.seek(0)
    return StreamingResponse(io, media_type="image/jpeg")


@app.post("/stylize/interrupt")
def stylize_interrupt():
    """Kiosk abort/timeout → stop job ComfyUI yang lagi jalan, bebasin GPU.
    (Restore perilaku v1 yang manggil /api/interrupt langsung — sekarang lewat
    boundary face_server, kiosk tetep gak kenal :8188.) Fire-and-forget semantics."""
    return {"ok": comfy_client.interrupt()}


if __name__ == "__main__":
    import uvicorn
    _selfcheck_resolve_pairs()  # fail-fast kalau logika mapping rusak
    _selfcheck_cf_weight()      # fail-fast kalau clamp cf_weight rusak
    _selfcheck_denoise()        # fail-fast kalau clamp denoise rusak
    print("[semeta] Starting Face Server on port 8000...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
