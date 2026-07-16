"""
Semeta ComfyUI client — graph builder + HTTP (stdlib only, no deps).
Port dari kiosk/lib/comfy-graph.ts + comfy.ts (v1, verified) minus ReActor & depth:
face lock pindah ke post-pass insightface di face_server, depth deferred sampai
modelnya di-bundle. Cuma face_server yang boleh ngomong ke :8188 — kiosk & admin
gak perlu tau ComfyUI ada.

Import HARUS ringan (stdlib only) — test_comfy_graph.py import modul ini tanpa venv.
"""

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")  # ponytail: env, bukan FE — set once per-mesin
POLL_S = 0.5        # jeda antar poll history — job warm ~4.5s, poll 1s buang ~0.5-1s per tamu
POLL_CAP_S = 110    # total nunggu ComfyUI — lewat ini anggap gagal
HTTP_TIMEOUT_S = 10
PROBE_TIMEOUT_S = 2

# Selfie ditulis langsung ke input dir ComfyUI (skip /upload/image multipart).
COMFY_INPUT_DIR = os.environ.get("COMFY_INPUT_DIR", "C:/ComfyUI/input")

# Ukuran latent per family — portrait, kelipatan 64 (sama persis v1)
SIZE = {
    "sd15": (512, 768),
    "sdxl": (832, 1216),
    "flux": (768, 1152),
}

SAMPLER = {
    # sd15: dpmpp_2m_sde = rekomendasi author epicRealism (DPM++ SDE Karras) versi multistep —
    # detail kulit SDE, biaya per-step sama kayak 2M (1 call/step). dpmpp_sde asli 2x lebih lambat.
    "sd15": {"steps": 30, "cfg": 7, "sampler_name": "dpmpp_2m_sde", "scheduler": "karras"},
    "sdxl": {"steps": 30, "cfg": 7, "sampler_name": "dpmpp_2m", "scheduler": "karras"},
    # flux: euler/simple + cfg 1.0 itu WAJIB buat flux — jangan diganti walau ada override UI
    "flux": {"steps": 20, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple"},
}

# Sampler/scheduler yang boleh di-override dari Settings. Di luar allowlist / kosong / "default"
# → jatuh ke preset per-family (SAMPLER di atas). Allowlist = node core ComfyUI, offline-safe.
SAMPLER_NAMES = ("euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_sde", "ddim", "uni_pc")
SCHEDULER_NAMES = ("karras", "normal", "simple", "sgm_uniform", "exponential")


# CFG override range — di bawah 1 gak ada guidance, di atas 12 gosong/oversaturated
CFG_MIN = 1.0
CFG_MAX = 12.0

# Steps override — semua "aman" (beda cuma speed vs detail halus), di luar rentang ini
# gak ada gain (>30) atau under-baked (<15). sd15/sdxl only — flux locked di 20.
STEPS_MIN = 15
STEPS_MAX = 30


def resolve_sampler(family, sampler_override, scheduler_override, cfg_override=None, steps_override=None):
    """Merge preset family + override. Override kosong/'default'/di luar allowlist → pakai preset.
    Return dict {steps, cfg, sampler_name, scheduler} — cfg & steps boleh di-override (clamp).
    FLUX di-LOCK total: euler/simple/cfg 1.0/steps 20 wajib, semua override UI diabaikan
    (kalau ga = output rusak)."""
    base = dict(SAMPLER[family])
    if family == "flux":
        return base  # flux kunci mati — no override
    if sampler_override and sampler_override in SAMPLER_NAMES:
        base["sampler_name"] = sampler_override
    if scheduler_override and scheduler_override in SCHEDULER_NAMES:
        base["scheduler"] = scheduler_override
    if cfg_override not in (None, ""):
        try:
            v = float(cfg_override)
            if v == v:  # v != v cuma kalau NaN — float('nan') gak raise, harus dicek manual
                base["cfg"] = min(CFG_MAX, max(CFG_MIN, v))
        except (ValueError, TypeError, OverflowError):
            pass  # nilai ngaco → preset family
    if steps_override not in (None, ""):
        try:
            # int() langsung (bukan lewat float()) — float('inf')/'1e400' lolos ValueError
            # check tapi int(inf) raise OverflowError; int() native udah nolak string ginian.
            base["steps"] = min(STEPS_MAX, max(STEPS_MIN, int(steps_override)))
        except (ValueError, TypeError, OverflowError):
            pass  # nilai ngaco → preset family
    return base

SD15_VAE = "vae-ft-mse-840000-ema-pruned.safetensors"
UPSCALE_MODEL = "RealESRGAN_x2plus.pth"
CANNY_CONTROLNET = "control_v11p_sd15_canny.pth"
DEPTH_CONTROLNET = "control_v11f1p_sd15_depth.pth"


def normalize_controlnet(mode):
    """Contract belt: nilai gak dikenal → default 'canny'. 'off'/'depth'/'canny' apa adanya.
    depth = MiDaS preprocessor (custom node controlnet_aux) + control_v11f1p_sd15_depth;
    kalau model/node gak ada di mesin, /capabilities gak nawarin depth (lihat face_server)."""
    return mode if mode in ("canny", "depth", "off") else "canny"


def classify_family(checkpoint_name):
    """Heuristik filename per contract: 'flux' di nama → flux, 'xl' → sdxl, sisanya sd15."""
    n = checkpoint_name.lower()
    if "flux" in n:
        return "flux"
    if "xl" in n:
        return "sdxl"
    return "sd15"


# ControlNet strength override range — di bawah 0.3 nyaris no-op (Canny gak ngefek),
# di atas 1.0 bisa maksa struktur sampe hasilnya kaku/artefak di tepi.
CN_STRENGTH_MIN = 0.3
CN_STRENGTH_MAX = 1.0
CN_STRENGTH_DEFAULT = 0.8


def _clamp_cn_strength(v):
    if v in (None, ""):
        return CN_STRENGTH_DEFAULT
    try:
        return min(CN_STRENGTH_MAX, max(CN_STRENGTH_MIN, float(v)))
    except (ValueError, TypeError):
        return CN_STRENGTH_DEFAULT


def build_comfy_graph(family, checkpoint, controlnet, denoise, positive, negative, seed, input_image,
                      sampler=None, scheduler=None, cfg=None, steps=None, cn_strength=None):
    """Graph ComfyUI API-format (bukan UI-format workflow JSON). Pure & deterministic:
    seed dari caller, no I/O — unit-testable. Core nodes only: NO ReActor (face lock
    = post-pass insightface di face_server), NO depth preprocessor (deferred).
    sampler/scheduler/cfg/steps/cn_strength override opsional (kosong → preset family)."""
    w, h = SIZE[family]
    s = resolve_sampler(family, sampler, scheduler, cfg, steps)
    controlnet = normalize_controlnet(controlnet)
    # sd15: VAE eksternal (muka lebih bagus, match workflow user). sdxl/flux: VAE bawaan checkpoint.
    vae = ["vae_loader", 0] if family == "sd15" else ["ckpt", 2]

    graph = {
        "ckpt": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": checkpoint}},
        "load": {"class_type": "LoadImage", "inputs": {"image": input_image}},
        "scale": {"class_type": "ImageScale", "inputs": {
            "image": ["load", 0], "upscale_method": "lanczos", "width": w, "height": h, "crop": "center"}},
        # img2img: foto tamu jadi latent — denoise = kekuatan restyle
        "encode": {"class_type": "VAEEncode", "inputs": {"pixels": ["scale", 0], "vae": vae}},
        "pos": {"class_type": "CLIPTextEncode", "inputs": {"text": positive, "clip": ["ckpt", 1]}},
        "neg": {"class_type": "CLIPTextEncode", "inputs": {
            "text": "" if family == "flux" else negative, "clip": ["ckpt", 1]}},
        "upscale_model": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": UPSCALE_MODEL}},
    }
    if family == "sd15":
        graph["vae_loader"] = {"class_type": "VAELoader", "inputs": {"vae_name": SD15_VAE}}

    positive_ref = ["pos", 0]
    negative_ref = ["neg", 0]

    if family == "flux":
        graph["flux_guidance"] = {"class_type": "FluxGuidance", "inputs": {
            "conditioning": ["pos", 0], "guidance": 3.5}}
        positive_ref = ["flux_guidance", 0]

    # ControlNet cuma SD1.5 — gak ada model sdxl/flux di disk.
    # canny = comfy-core node (offline-safe). depth = MiDaS preprocessor (custom node
    # controlnet_aux) + control_v11f1p_sd15_depth — cuma dinyalain kalau /capabilities bilang ada.
    if family == "sd15" and controlnet != "off":
        if controlnet == "depth":
            graph["cn_pre"] = {"class_type": "MiDaS-DepthMapPreprocessor", "inputs": {
                "image": ["scale", 0], "a": 6.28, "bg_threshold": 0.1}}
            cn_model = DEPTH_CONTROLNET
        else:
            graph["cn_pre"] = {"class_type": "Canny", "inputs": {
                "image": ["scale", 0], "low_threshold": 0.1, "high_threshold": 0.9}}
            cn_model = CANNY_CONTROLNET
        graph["cn_loader"] = {"class_type": "ControlNetLoader", "inputs": {
            "control_net_name": cn_model}}
        graph["cn_apply"] = {"class_type": "ControlNetApplyAdvanced", "inputs": {
            "positive": positive_ref, "negative": negative_ref, "control_net": ["cn_loader", 0],
            "image": ["cn_pre", 0], "strength": _clamp_cn_strength(cn_strength),
            "start_percent": 0.0, "end_percent": 1.0}}
        positive_ref = ["cn_apply", 0]
        negative_ref = ["cn_apply", 1]

    graph["sampler"] = {"class_type": "KSampler", "inputs": {
        "model": ["ckpt", 0], "seed": seed, "steps": s["steps"], "cfg": s["cfg"],
        "sampler_name": s["sampler_name"], "scheduler": s["scheduler"],
        "positive": positive_ref, "negative": negative_ref,
        "latent_image": ["encode", 0], "denoise": denoise}}
    graph["decode"] = {"class_type": "VAEDecode", "inputs": {"samples": ["sampler", 0], "vae": vae}}
    graph["upscale"] = {"class_type": "ImageUpscaleWithModel", "inputs": {
        "upscale_model": ["upscale_model", 0], "image": ["decode", 0]}}
    # PreviewImage (temp dir, kehapus tiap restart ComfyUI) — BUKAN SaveImage: SaveImage nulis
    # hasil bersih pre-watermark permanen ke output/, bocorin gate freemium lewat buka folder.
    graph["save"] = {"class_type": "PreviewImage", "inputs": {"images": ["upscale", 0]}}

    return graph


def _get_json(path, timeout=HTTP_TIMEOUT_S):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def _get_bytes(path, timeout=HTTP_TIMEOUT_S):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as res:
        return res.read()


def _post_json(path, payload, timeout=HTTP_TIMEOUT_S):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def comfy_alive():
    """Probe :8188 — True kalau ComfyUI hidup sekarang."""
    try:
        _get_bytes("/api/models/checkpoints", timeout=PROBE_TIMEOUT_S)
        return True
    except (urllib.error.URLError, OSError):
        return False


def is_image_checkpoint(name):
    """ponytail: denylist kasar biar model video (ltx-2 dkk) gak nyasar ke dropdown
    sd15 — heuristik nama, tambahin token kalau ada model video baru nyangkut."""
    n = name.lower()
    return not any(t in n for t in ("ltx", "wan", "svd"))


def list_checkpoints():
    """-> {"sd15": [...], "flux": [...]} — cuma family non-empty (contract).
    Raise URLError/OSError kalau :8188 mati — caller yang mutusin fallback."""
    names = _get_json("/api/models/checkpoints", timeout=PROBE_TIMEOUT_S)
    families = {}
    for name in names:
        if not is_image_checkpoint(name):
            continue
        families.setdefault(classify_family(name), []).append(name)
    return families


def list_controlnets():
    """-> ["canny", ...] modes yang beneran punya model di disk. canny selalu (core node +
    model wajib bundle). depth ditambah cuma kalau control_v11f1p_sd15_depth ada — MiDaS
    preprocessor-nya custom node, kalau ga keinstall graph-nya gagal saat submit, tapi
    modelnya proxy cukup baik (satu paket dibundle bareng). Raise kalau :8188 mati."""
    names = _get_json("/api/models/controlnet", timeout=PROBE_TIMEOUT_S)
    modes = ["canny"]
    if DEPTH_CONTROLNET in names:
        modes.append("depth")
    return modes


def interrupt():
    """Suruh ComfyUI berhentiin job yang LAGI JALAN — buat abort/timeout biar GPU
    gak kebuang ngerjain hasil yang gak bakal dipake. Best-effort, gak pernah raise.
    ponytail: /interrupt cuma stop prompt yang executing; antrian multi-job butuh
    /queue delete — kiosk single-job sequential, cukup ini."""
    try:
        req = urllib.request.Request(BASE + "/api/interrupt", data=b"", method="POST")
        urllib.request.urlopen(req, timeout=PROBE_TIMEOUT_S).close()
        return True
    except (urllib.error.URLError, OSError):
        return False


def _submit_prompt(graph):
    payload = {"prompt": graph, "client_id": uuid.uuid4().hex}
    try:
        out = _post_json("/api/prompt", payload)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"ComfyUI prompt {e.code}: {detail}") from e
    prompt_id = out.get("prompt_id")
    if not prompt_id:
        raise RuntimeError("ComfyUI rejected prompt (no prompt_id)")
    return prompt_id


def _find_output_image(entry):
    """Cuma PreviewImage yang punya images di graph kita — ambil output pertama."""
    for node in (entry.get("outputs") or {}).values():
        images = node.get("images") or []
        if images:
            return images[0]
    return None


def _await_result(prompt_id):
    """Poll history tiap 1s (no WebSocket — progress halus gak kepake server-side)."""
    deadline = time.monotonic() + POLL_CAP_S
    while time.monotonic() < deadline:
        time.sleep(POLL_S)
        try:
            history = _get_json(f"/api/history/{prompt_id}")
        except (urllib.error.URLError, OSError):
            continue  # comfy sibuk — retry tick berikutnya
        entry = history.get(prompt_id)
        if not entry:
            continue
        status = entry.get("status") or {}
        if status.get("status_str") == "error":
            raise RuntimeError("ComfyUI execution error")
        img = _find_output_image(entry)
        if img is None:
            if status.get("completed"):
                raise RuntimeError("ComfyUI finished without output image")
            continue
        q = urllib.parse.urlencode({
            "filename": img["filename"], "subfolder": img.get("subfolder", ""),
            "type": img.get("type", "temp")})  # PreviewImage nulis ke temp
        return _get_bytes(f"/api/view?{q}")
    raise TimeoutError(f"ComfyUI timeout {POLL_CAP_S}s (prompt {prompt_id})")


def stylize(selfie_bytes, positive, negative, family, checkpoint, controlnet, denoise, seed=None,
            sampler=None, scheduler=None, cfg=None, steps=None, cn_strength=None):
    """Selfie jpg bytes -> stylized image bytes (blocking, sampai ~110s).
    Selfie ditulis ke input dir ComfyUI dengan nama per-job UUID — dua job barengan
    gak saling timpa (race overwrite yang ada di v1 nama-tetap). Dihapus di finally."""
    if seed is None:
        seed = int.from_bytes(os.urandom(4), "big")
    input_name = f"stylize-{uuid.uuid4().hex}.jpg"
    input_path = os.path.join(COMFY_INPUT_DIR, input_name)
    with open(input_path, "wb") as f:
        f.write(selfie_bytes)
    try:
        graph = build_comfy_graph(
            family=family, checkpoint=checkpoint, controlnet=controlnet,
            denoise=denoise, positive=positive, negative=negative,
            seed=seed, input_image=input_name, sampler=sampler, scheduler=scheduler,
            cfg=cfg, steps=steps, cn_strength=cn_strength)
        prompt_id = _submit_prompt(graph)
        try:
            return _await_result(prompt_id)
        except TimeoutError:
            interrupt()  # server nyerah nunggu — jangan biarin GPU lanjut ngerjain sia-sia
            raise
    finally:
        try:
            os.remove(input_path)  # retensi/consent: selfie tamu gak nginep di input/
        except OSError as e:
            print(f"[semeta] warn: gagal hapus {input_path}: {e}")
