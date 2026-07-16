# kiosk/bin — bundled binaries

Taruh **`ffmpeg.exe`** di sini (static build Windows, ~70–150MB).

Dipakai `app/api/finalize-video/route.ts` buat letterbox video 2:3 + burn frame+QR.
Kiosk nyari ffmpeg berurutan:

1. `FFMPEG_PATH` env (override eksplisit — menang selalu, buat Electron packaged)
2. `kiosk/bin/ffmpeg.exe` ← **file ini** (portable, no install)
3. `ffmpeg` dari system PATH (fallback dev)

## Kenapa di sini, bukan install global

Portable. Colok folder kiosk ke Mini PC manapun → langsung jalan, **gak perlu**
install ffmpeg / setting Environment Variable PATH manual di lapangan.

## Download

Static build: https://www.gyan.dev/ffmpeg/builds/ (ffmpeg-release-essentials.zip)
→ ambil `bin/ffmpeg.exe` doang, taruh di sini.

> `*.exe` di-gitignore — binary JANGAN masuk git. Copy manual saat setup mesin.
