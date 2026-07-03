"""Self-check untuk filter_real_faces — jalanin: python test_filter_faces.py"""
import numpy as np


class FakeFace:
    def __init__(self, x1, y1, x2, y2, score):
        self.bbox = np.array([x1, y1, x2, y2], dtype=float)
        self.det_score = score


# Import face_server nge-trigger load model (berat). Test ini cuma verifikasi logic filter murni,
# jadi konstanta + fungsi di-mirror di sini. Kalau logic di face_server.py berubah, update juga di sini.
MIN_DET_SCORE = 0.55
MIN_AREA_RATIO = 0.12


def _bbox_area(f):
    return (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1])


def filter_real_faces(faces):
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


def run():
    # muka utama besar+tajam, muka background kecil, muka blur skor rendah
    main = FakeFace(100, 100, 300, 340, 0.92)          # area 200x240=48000
    background_small = FakeFace(400, 50, 440, 90, 0.80)  # area 40x40=1600 (<12% dari 48000=5760)
    blurry = FakeFace(100, 100, 300, 340, 0.30)          # besar tapi skor rendah

    # 1. background kecil dibuang walau skor tinggi
    out = filter_real_faces([main, background_small])
    assert len(out) == 1 and out[0] is main, "background kecil harus dibuang"

    # 2. blur (skor < 0.55) dibuang walau ukuran sama
    out = filter_real_faces([FakeFace(100, 100, 300, 340, 0.92), blurry])
    assert len(out) == 1, "muka blur harus dibuang"

    # 3. dua muka valid dua-duanya lolos (foto berdua)
    a = FakeFace(50, 100, 200, 320, 0.88)
    b = FakeFace(250, 110, 400, 330, 0.85)
    out = filter_real_faces([a, b])
    assert len(out) == 2, "dua muka valid harus dua-duanya lolos"

    # 4. semua ke-filter → fallback 1 skor tertinggi (jangan kosong)
    out = filter_real_faces([FakeFace(0, 0, 10, 10, 0.40), FakeFace(0, 0, 12, 12, 0.45)])
    assert len(out) == 1 and out[0].det_score == 0.45, "fallback ambil skor tertinggi"

    # 5. list kosong → kosong
    assert filter_real_faces([]) == []

    print("OK — semua assert lolos")


if __name__ == "__main__":
    run()
