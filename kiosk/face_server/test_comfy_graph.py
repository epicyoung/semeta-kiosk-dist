"""Self-check untuk comfy_client.build_comfy_graph — jalanin: python test_comfy_graph.py
Port dari kiosk/__tests__/comfy-graph.test.ts (v1) minus case ReActor/depth: face lock
pindah ke post-pass insightface, depth deferred. comfy_client stdlib-only, no model load."""
import comfy_client
from comfy_client import build_comfy_graph, normalize_controlnet, classify_family

BASE = dict(
    family="sd15",
    checkpoint="epicrealism_pureEvolutionV5.safetensors",
    controlnet="canny",
    denoise=0.65,
    positive="cinematic portrait, neon city",
    negative="blurry, lowres",
    seed=424242,
    input_image="stylize-424242.jpg",
)

CN_CLASSES = ["Canny", "MiDaS-DepthMapPreprocessor", "ControlNetLoader", "ControlNetApplyAdvanced"]

VARIANTS = [
    {},
    {"controlnet": "depth"},
    {"controlnet": "off"},
    {"family": "sdxl"},
    {"family": "flux"},
    {"family": "flux", "controlnet": "off"},
    {"family": "sdxl", "controlnet": "depth"},
]


def build(**overrides):
    opts = dict(BASE)
    opts.update(overrides)
    return build_comfy_graph(**opts)


def has_class(g, cls):
    return any(n["class_type"] == cls for n in g.values())


def is_ref(v):
    # [id, slot] link — bool itu subclass int, tapi gak pernah muncul di slot ref
    return isinstance(v, list) and len(v) == 2 and isinstance(v[0], str) and isinstance(v[1], int)


def run():
    # 1. img2img invariant — THE invariant: tanpa ini denoise slider gak berarti apa-apa
    g = build()
    assert g["load"]["inputs"]["image"] == BASE["input_image"], "load harus baca input image"
    assert g["scale"]["inputs"]["image"] == ["load", 0], "scale makan load"
    assert g["encode"]["class_type"] == "VAEEncode", "encode harus VAEEncode (img2img)"
    assert g["encode"]["inputs"]["pixels"] == ["scale", 0], "encode makan scale"
    assert g["sampler"]["inputs"]["latent_image"] == ["encode", 0], "sampler.latent_image dari encode (bukan txt2img)"

    # 2. sd15 + canny full wiring: Canny + loader + apply → sampler pos/neg
    assert g["cn_pre"]["class_type"] == "Canny", "cn_pre harus Canny (comfy-core)"
    assert g["cn_pre"]["inputs"]["image"] == ["scale", 0], "canny makan scale"
    assert g["cn_loader"]["inputs"]["control_net_name"] == "control_v11p_sd15_canny.pth"
    assert g["cn_apply"]["class_type"] == "ControlNetApplyAdvanced"
    assert g["cn_apply"]["inputs"]["control_net"] == ["cn_loader", 0]
    assert g["cn_apply"]["inputs"]["image"] == ["cn_pre", 0]
    assert g["sampler"]["inputs"]["positive"] == ["cn_apply", 0], "cn_apply output 0 → sampler positive"
    assert g["sampler"]["inputs"]["negative"] == ["cn_apply", 1], "cn_apply output 1 → sampler negative"

    # 3. opts patched: denoise, checkpoint, seed, prompts
    assert g["sampler"]["inputs"]["denoise"] == BASE["denoise"]
    assert g["sampler"]["inputs"]["seed"] == BASE["seed"]
    assert g["ckpt"]["inputs"]["ckpt_name"] == BASE["checkpoint"]
    assert g["pos"]["inputs"]["text"] == BASE["positive"]
    assert g["neg"]["inputs"]["text"] == BASE["negative"]

    # 4. VAE eksternal sd15 dipakai encode + decode
    assert g["vae_loader"]["inputs"]["vae_name"] == "vae-ft-mse-840000-ema-pruned.safetensors"
    assert g["encode"]["inputs"]["vae"] == ["vae_loader", 0]
    assert g["decode"]["inputs"]["vae"] == ["vae_loader", 0]

    # 5. controlnet off → no CN nodes, pos/neg langsung dari CLIPTextEncode
    g = build(controlnet="off")
    for cls in CN_CLASSES:
        assert not has_class(g, cls), f"controlnet off tapi ada {cls}"
    assert g["sampler"]["inputs"]["positive"] == ["pos", 0]
    assert g["sampler"]["inputs"]["negative"] == ["neg", 0]

    # 6. flux: FluxGuidance + cfg 1.0 + negative kosong + no CN
    g = build(family="flux")
    assert g["flux_guidance"]["class_type"] == "FluxGuidance"
    assert g["flux_guidance"]["inputs"]["conditioning"] == ["pos", 0]
    assert g["flux_guidance"]["inputs"]["guidance"] == 3.5
    assert g["sampler"]["inputs"]["positive"] == ["flux_guidance", 0]
    assert g["sampler"]["inputs"]["cfg"] == 1.0, "flux cfg harus 1.0"
    assert g["neg"]["inputs"]["text"] == "", "flux gak pakai negative prompt"
    assert g["sampler"]["inputs"]["negative"] == ["neg", 0]
    for cls in CN_CLASSES:
        assert not has_class(g, cls), f"flux gak boleh punya {cls} walau canny diminta"
    assert g["sampler"]["inputs"]["latent_image"] == ["encode", 0], "img2img invariant flux"

    # 7. sdxl: no CN + 832x1216 + VAE bawaan checkpoint
    g = build(family="sdxl")
    for cls in CN_CLASSES:
        assert not has_class(g, cls), f"sdxl gak boleh punya {cls} (CN = SD1.5 only)"
    assert g["scale"]["inputs"]["width"] == 832 and g["scale"]["inputs"]["height"] == 1216
    assert "vae_loader" not in g, "sdxl pakai VAE bawaan checkpoint"
    assert g["encode"]["inputs"]["vae"] == ["ckpt", 2]
    assert g["decode"]["inputs"]["vae"] == ["ckpt", 2]
    sd15 = build()
    assert sd15["scale"]["inputs"]["width"] == 512 and sd15["scale"]["inputs"]["height"] == 768

    # 8. NO ReActor di varian mana pun — face lock = post-pass insightface di face_server
    for v in VARIANTS:
        g = build(**v)
        assert not has_class(g, "ReActorFaceSwap"), f"ReActor nongol di varian {v}"
        assert g["upscale"]["inputs"]["image"] == ["decode", 0], "upscale langsung dari decode (no reactor)"

    # 9. controlnet mode passthrough — depth/canny/off apa adanya, nilai aneh → canny
    assert normalize_controlnet("depth") == "depth"
    assert normalize_controlnet("canny") == "canny"
    assert normalize_controlnet("off") == "off"
    assert normalize_controlnet("nonsense") == "canny", "nilai aneh jatuh ke default canny"
    # depth → MiDaS preprocessor + model depth (bukan canny)
    g = build(controlnet="depth")
    assert g["cn_pre"]["class_type"] == "MiDaS-DepthMapPreprocessor", "depth pake MiDaS preprocessor"
    assert g["cn_pre"]["inputs"]["image"] == ["scale", 0], "depth pre makan scale (sama kayak canny)"
    assert g["cn_loader"]["inputs"]["control_net_name"] == "control_v11f1p_sd15_depth.pth"
    assert g["cn_apply"]["inputs"]["image"] == ["cn_pre", 0], "cn_apply makan output depth pre"
    assert not has_class(g, "Canny"), "depth request gak boleh ada Canny node"

    # 10. graph terminates in PreviewImage (BUKAN SaveImage — bocorin clean pre-watermark)
    g = build()
    assert g["save"]["class_type"] == "PreviewImage"
    assert g["save"]["inputs"]["images"] == ["upscale", 0]
    assert g["upscale"]["inputs"]["upscale_model"] == ["upscale_model", 0]
    for v in VARIANTS:
        assert not has_class(build(**v), "SaveImage"), f"SaveImage nongol di varian {v}"

    # 11. link integrity: dangling [id, slot] = ComfyUI 400 saat POST /prompt
    for v in VARIANTS:
        g = build(**v)
        ids = set(g.keys())
        for node_id, node in g.items():
            for key, val in node["inputs"].items():
                if is_ref(val):
                    assert val[0] in ids, f"varian {v}: {node_id}.{key} nunjuk node ghost '{val[0]}'"

    # 12. classify_family heuristik (buat /capabilities)
    assert classify_family("flux1-dev-fp8.safetensors") == "flux"
    assert classify_family("juggernautXL_v9.safetensors") == "sdxl"
    assert classify_family("epicrealism_pureEvolutionV5.safetensors") == "sd15"
    assert classify_family("FLUX-schnell.safetensors") == "flux", "case-insensitive"

    # 13. filter model video — jangan nyasar ke dropdown checkpoint (ltx-2 beneran ada di disk)
    assert not comfy_client.is_image_checkpoint("ltx-2-19b-distilled-fp8.safetensors")
    assert not comfy_client.is_image_checkpoint("Wan2_2-TI2V-5B_fp8.safetensors")
    assert comfy_client.is_image_checkpoint("epicrealism_pureEvolutionV5.safetensors")
    assert comfy_client.is_image_checkpoint("flux1CompactCLIPAnd_Flux1DevFp16.safetensors")

    # 14. sampler/scheduler override: kosong → default family, valid → dipakai, invalid → default
    g_def = build()
    assert g_def["sampler"]["inputs"]["sampler_name"] == "dpmpp_2m_sde", "sd15 default sampler (epicRealism rec)"
    assert g_def["sampler"]["inputs"]["scheduler"] == "karras", "sd15 default scheduler"
    g_ov = build(sampler="ddim", scheduler="normal")
    assert g_ov["sampler"]["inputs"]["sampler_name"] == "ddim", "override sampler dipakai"
    assert g_ov["sampler"]["inputs"]["scheduler"] == "normal", "override scheduler dipakai"
    g_bad = build(sampler="notreal", scheduler="bogus")
    assert g_bad["sampler"]["inputs"]["sampler_name"] == "dpmpp_2m_sde", "invalid sampler → default family"
    assert g_bad["sampler"]["inputs"]["scheduler"] == "karras", "invalid scheduler → default family"
    g_empty = build(sampler="", scheduler="")
    assert g_empty["sampler"]["inputs"]["sampler_name"] == "dpmpp_2m_sde", "kosong → default family"
    # steps/cfg TETAP dari family walau sampler di-override — jangan keutak
    assert g_ov["sampler"]["inputs"]["steps"] == 30 and g_ov["sampler"]["inputs"]["cfg"] == 7
    # flux LOCK: override sampler/scheduler DIABAIKAN — euler/simple wajib (kalau ga output rusak)
    g_flux = build(family="flux", sampler="ddim", scheduler="karras")
    assert g_flux["sampler"]["inputs"]["sampler_name"] == "euler", "flux override sampler harus diabaikan"
    assert g_flux["sampler"]["inputs"]["scheduler"] == "simple", "flux override scheduler harus diabaikan"

    # 15. CFG override: valid → dipakai, clamp 1-12, kosong/ngaco → default family, flux dikunci 1.0
    assert build(cfg="5")["sampler"]["inputs"]["cfg"] == 5.0, "cfg override dipakai"
    assert build(cfg="99")["sampler"]["inputs"]["cfg"] == 12.0, "cfg clamp atas"
    assert build(cfg="0.1")["sampler"]["inputs"]["cfg"] == 1.0, "cfg clamp bawah"
    assert build(cfg="")["sampler"]["inputs"]["cfg"] == 7, "cfg kosong → default family"
    assert build(cfg="ngaco")["sampler"]["inputs"]["cfg"] == 7, "cfg invalid → default family"
    assert build(family="flux", cfg="7")["sampler"]["inputs"]["cfg"] == 1.0, "flux cfg dikunci 1.0"
    assert build(cfg="nan")["sampler"]["inputs"]["cfg"] == 7, "cfg NaN → default family (bukan NaN nyasar ke graph)"

    # 16. Steps override: valid → dipakai, clamp 15-30, kosong/ngaco → default family, flux dikunci 20
    assert build(steps="20")["sampler"]["inputs"]["steps"] == 20, "steps override dipakai"
    assert build(steps="99")["sampler"]["inputs"]["steps"] == 30, "steps clamp atas"
    assert build(steps="1")["sampler"]["inputs"]["steps"] == 15, "steps clamp bawah"
    assert build(steps="")["sampler"]["inputs"]["steps"] == 30, "steps kosong → default family"
    assert build(steps="ngaco")["sampler"]["inputs"]["steps"] == 30, "steps invalid → default family"
    assert build(family="flux", steps="15")["sampler"]["inputs"]["steps"] == 20, "flux steps dikunci 20"
    assert build(steps="inf")["sampler"]["inputs"]["steps"] == 30, "steps inf → default family (bukan crash)"
    assert build(steps="1e400")["sampler"]["inputs"]["steps"] == 30, "steps 1e400 → default family (bukan crash)"

    # 17. ControlNet strength override: valid → dipakai, clamp 0.3-1.0, kosong/ngaco → default 0.8
    assert build(cn_strength="0.5")["cn_apply"]["inputs"]["strength"] == 0.5, "cn_strength override dipakai"
    assert build(cn_strength="99")["cn_apply"]["inputs"]["strength"] == 1.0, "cn_strength clamp atas"
    assert build(cn_strength="0.01")["cn_apply"]["inputs"]["strength"] == 0.3, "cn_strength clamp bawah"
    assert build(cn_strength="")["cn_apply"]["inputs"]["strength"] == 0.8, "cn_strength kosong → default"
    assert build(cn_strength="ngaco")["cn_apply"]["inputs"]["strength"] == 0.8, "cn_strength invalid → default"
    # controlnet off → gak ada cn_apply node sama sekali, override diem-diem gak ngefek
    assert "cn_apply" not in build(controlnet="off", cn_strength="0.5")

    print("OK — semua assert lolos")


if __name__ == "__main__":
    run()
