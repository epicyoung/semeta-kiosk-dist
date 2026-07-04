# Changelog

Format: [Keep a Changelog](https://keepachangelog.com). Grup per area (kiosk/admin/worker/microsite/ops).
`[LOKAL]` = udah commit tapi **belum push/deploy** — cek sebelum go-live.

## [Unreleased] — branch `feat/frame-delivery-orientation`

### Kiosk
- **Frame chooser jadi page sendiri** sebelum Preview (BACK/NEXT). Frame kepilih lewat state, upload+print di Preview. (`6e99fac`)
- **Overlay Original seorientasi foto asli** pas mismatch (P+L & L+P) — no pairing by-nama, operator upload frame bebas. Ga ada frame = polos, foto uncrop. `[LOKAL]` (`41e1c9a`)
- **Frame di-burn ke QR share (A+B) + print** — Original & AI dua-duanya kena frame kepilih sebelum upload R2. (`bfe3ca3`, `e7a6b06`)
- **Tombol "Ulangi QR"** manual kalau upload R2 gagal (offline). (`bfe3ca3`)
- **AI-or-original choice screen** setelah capture. (`a100972`)
- Preview no-crop pas orientasi mismatch + native box via CSS var. (`043f6b0`, `7ef18d2`)
- Canvas frame compositor (cover-fit). (`6e257b1`)
- Locale copy frame picker + delivery, 9 bahasa. (`d4cad66`)

### Fixes (kiosk)
- **Print: dialog Chrome muncul** — `--kiosk-printing` dicopot dari LAUNCHER; iframe persisten, selalu `print()` setelah decode, ga remove iframe (fix "printbox muncul lalu ilang"). (`bfe3ca3`, `79a42fe`)
- **PHOTO_UPLOADED dobel** — upload sekali per foto (guard `uploadedBase`); dulu re-run gara-gara `mismatch` resolve async. `[LOKAL]` (`86faab4`)

### Admin
- **Analisis false-alarm di page Abuse** — concurrent_ip IPv4↔IPv6 / IPv6 /64 sama = false alarm (dual-stack), badge "LIKELY FALSE ALARM", ga bikin panik. Murni presentational. `[LOKAL]` (Vercel deploy) (`569783d`)

### Worker
- **R2 event folder readable** — `{kiosk_no}-{name-slug}` (mis. `6-lps`) gantiin UUID, enak di FileZilla. Collision guard utuh. `[LOKAL]` (**butuh `npm run deploy`**) (`d13c28c`)

### Ops
- **`fix-update-button.bat`** — convert kiosk ZIP → git repo biar tombol Update muncul. (`9cbb85c`)
- **`kill.bat` bunuh chrome.exe** — biar flag LAUNCHER kepake (chrome zombie = flag drop). (`1731b4c`)

### Docs
- Plan gallery link + folder verify + A/B sanity (besok). (`38dcb9c`)

---

### ⚠️ Belum push / deploy (per 2026-07-04, tes dulu):
- Push branch: semua commit di atas
- **Deploy worker**: `d13c28c` (folder R2 readable ga aktif sampe deploy)
- **Deploy microsite (Pages)**: gallery link besok
- **Vercel (admin)**: `569783d` auto pas push (preview kalau bukan master)
- **KV `PHOTO_GALLERY` bind di Pages microsite** — cek dashboard Cloudflare (ga keliatan dari kode)
