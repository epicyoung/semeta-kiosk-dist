# Semeta Kiosk

Source distribution buat kiosk lapangan. Auto-mirror dari monorepo private lewat `push-dist.bat`.
**JANGAN edit di sini** — perubahan di-overwrite tiap sync. Edit di monorepo.

---

## ⚠️ Butuh model AI terpisah (TIDAK ada di repo ini)

Repo ini cuma **source code** (~beberapa MB). Model AI (~1.2GB) di-gitignore
karena kegedean buat git — dikirim terpisah lewat bundle (R2 / flashdisk):

| File | Taruh di | Ukuran |
|------|----------|--------|
| `inswapper_128.onnx` | `kiosk/face_server/` | 529 MB |
| `codeformer.onnx` | `kiosk/face_server/` | 360 MB |
| `buffalo_l/` pack | `%USERPROFILE%\.insightface\models\` | 326 MB |

Tanpa model ini, faceswap error. Minta bundle `semeta-kiosk-FULL` ke admin.

---

## Install pertama

1. Install **Node.js LTS** (nodejs.org) + **Python 3.11** (python.org, centang "Add to PATH")
2. `git clone https://github.com/epicyoung/semeta-kiosk-dist.git semeta-kiosk`
   (JANGAN download ZIP — tombol Update butuh folder `.git`)
3. Copy **semua isi** bundle `semeta-kiosk-MODELS` (dari admin) ke dalam
   folder `semeta-kiosk\` hasil clone (model AI + `pb\`). Timpa/gabung.
4. Di `semeta-kiosk\`: jalanin `setup.bat` (auto-stop kalau model belum di-copy)
5. Jalanin `LAUNCHER-BUILD.BAT` → buka http://localhost:3000
   (Pertama kali compile dulu ~1-2 menit — biarin jalan, jangan ditutup.
   Buka berikutnya udah cepet, gak compile lagi.)
6. Isi **KIOSK_SECRET** di Settings → Lisensi (minta ke admin)

## Update (mesin yang udah jalan)

Settings (⚙️) → **Sistem** → **Cek update** → **Update**, terus:

```
kill.bat
LAUNCHER-BUILD.BAT --rebuild
```

**Wajib pakai `--rebuild`.** Mode produksi nyajiin hasil compile lama sampai
di-compile ulang. Kalau cuma tutup-buka biasa, kiosk jalan pakai kode LAMA
dan kelihatannya normal — gak ada tanda apa-apa kalau update belum kepasang.

Template + frame yang udah di-upload **aman** — update cuma narik source, gak nyentuh `pb_data`.

## `LAUNCHER-DEV.bat` vs `LAUNCHER-BUILD.BAT`

| | Buat |
|---|------|
| `LAUNCHER-BUILD.BAT` | **Mesin lapangan.** Mode produksi — pre-compiled, stabil. |
| `LAUNCHER-DEV.bat` | Ngoding/ngetes doang. Mode dev: lambat, gampang mati sendiri. |
