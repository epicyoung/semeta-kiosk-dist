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

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
import cv2
import numpy as np
import insightface
import insightface.utils.face_align as face_align
import onnxruntime as ort
from io import BytesIO
from contextlib import asynccontextmanager

face_analyser = None
face_swapper = None
codeformer_enhancer = None
active_provider = "unknown"


class CodeFormerEnhancer:
    def __init__(self, model_path, providers):
        self.session = ort.InferenceSession(model_path, providers=providers)
        self.input_name = self.session.get_inputs()[0].name
        self.weight_name = self.session.get_inputs()[1].name

    def enhance(self, img, target_face):
        M = face_align.estimate_norm(target_face.kps, 512)
        crop = cv2.warpAffine(img, M, (512, 512), borderMode=cv2.BORDER_REPLICATE)

        crop_norm = crop.astype(np.float32) / 255.0
        crop_norm = (crop_norm - 0.5) / 0.5
        crop_rgb = cv2.cvtColor(crop_norm, cv2.COLOR_BGR2RGB)
        crop_chw = np.transpose(crop_rgb, (2, 0, 1))
        input_tensor = np.expand_dims(crop_chw, axis=0)
        weight = np.array([0.5], dtype=np.double)

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_models()
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
async def swap_face(template: UploadFile = File(...), selfie: UploadFile = File(...)):
    """Swap largest selfie face onto largest template face, with optional CodeFormer enhancement.

    Watermark is NOT applied here. The kiosk client burns the local copies (original + AI) in
    one place when unlicensed (lib/watermark-canvas.ts) so preview/print/save share one canvas;
    burning here too would double-stamp. The guest-facing R2 copy is burned by the worker.
    """
    start = time.time()

    template_img = cv2.imdecode(np.frombuffer(await template.read(), np.uint8), cv2.IMREAD_COLOR)
    selfie_img = cv2.imdecode(np.frombuffer(await selfie.read(), np.uint8), cv2.IMREAD_COLOR)

    template_faces = face_analyser.get(template_img)
    if not template_faces:
        return JSONResponse({"error": "No face in template"}, status_code=400)

    selfie_faces = face_analyser.get(selfie_img)
    if not selfie_faces:
        return JSONResponse({"error": "No face in selfie"}, status_code=400)

    area = lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1])
    target_face = max(template_faces, key=area)
    source_face = max(selfie_faces, key=area)

    result_img = face_swapper.get(template_img, target_face, source_face, paste_back=True)
    if codeformer_enhancer:
        result_img = codeformer_enhancer.enhance(result_img, target_face)

    _, buf = cv2.imencode(".jpg", result_img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print(f"[semeta] swap done in {round(time.time() - start, 2)}s ({active_provider})")

    io = BytesIO(buf.tobytes())
    io.seek(0)
    return StreamingResponse(io, media_type="image/jpeg")


if __name__ == "__main__":
    import uvicorn
    print("[semeta] Starting Face Server on port 8000...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
