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

1. Install **Git** (git-scm.com/download/win) — wajib buat clone + tombol Update
2. Install **Node.js LTS** (nodejs.org) + **Python 3.11**:
   - Windows 64-bit: https://www.python.org/ftp/python/3.11.0/python-3.11.0-amd64.exe
   - Windows 32-bit: https://www.python.org/ftp/python/3.11.0/python-3.11.0.exe
   - ⚠️ Centang **"Add Python to PATH"** saat install
3. Buka **Command Prompt**, jalanin:
   ```
   git clone https://github.com/epicyoung/semeta-kiosk-dist.git semeta-kiosk
   ```
   (JANGAN download ZIP — tombol Update butuh folder `.git`)
4. Copy **semua isi** bundle `semeta-kiosk-MODELS` (dari admin) ke dalam
   folder `semeta-kiosk\` hasil clone (model AI + `pb\`). Timpa/gabung.
5. Di `semeta-kiosk\`: jalanin `setup.bat` (auto-stop kalau model belum di-copy)
6. Jalanin `LAUNCHER.bat` → buka http://localhost:3000
7. Isi **KIOSK_SECRET** di Settings → Lisensi (minta ke admin)

## Update (mesin yang udah jalan)

Settings (⚙️) → **Sistem** → **Cek update** → **Update** → tutup+buka lagi `LAUNCHER.bat`.
Template + frame yang udah di-upload **aman** — update cuma narik source, gak nyentuh `pb_data`.
