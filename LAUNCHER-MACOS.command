#!/bin/bash
# Launcher macOS — padanan LAUNCHER-DEV.bat buat mode Photo Print (non-AI).
#
# Sengaja JAUH lebih pendek dari versi Windows: mode print_local ga butuh
# PocketBase (template dari JSON), ga butuh face_server (non-AI), ga butuh
# ComfyUI. Yang tersisa cuma Next.js + Chrome.
#
# Sumber foto = Sony/mirrorless yang di-sedot manual ke folder lewat software
# bawaan kamera, terus di-browse dari kiosk (camera_source 'file').
#
# Pakai: chmod +x LAUNCHER-MACOS.command  → dobel-klik dari Finder.
set -u

cd "$(dirname "$0")"
ROOT="$(pwd)"

printf '\n\033[38;2;255;64;153m  SEMETA — Photo Print (macOS)\033[0m\n'
printf '\033[90m  Spindonesia x Epicyoung AI Pro Booth\033[0m\n\n'

# Folder data. Windows pakai C:/semeta; di Mac ga ada drive C: jadi kita arahkan
# ke home. getDataDir() di kiosk/lib/event.ts baca env ini, jadi nol edit kode.
export TEMPLATE_LOCAL="${TEMPLATE_LOCAL:-$HOME/semeta}"
export SEMETA_CONFIG_PATH="${SEMETA_CONFIG_PATH:-$HOME/semeta/semeta.config.json}"
mkdir -p "$TEMPLATE_LOCAL/event"
echo "[OK] Data folder — $TEMPLATE_LOCAL"

# ffmpeg cuma dipakai jalur video. Mode print ga butuh, jadi absennya bukan error.
if command -v ffmpeg >/dev/null 2>&1; then
  echo "[OK] ffmpeg — $(command -v ffmpeg)"
else
  echo "[--] ffmpeg ga ada — abaikan, mode print ga pakai video"
fi

# Matikan sisa proses dev di port 3000 dari run sebelumnya. Tanpa ini Next.js
# diam-diam pindah ke 3001 dan browser kebuka di port yang salah.
if lsof -ti tcp:3000 >/dev/null 2>&1; then
  echo "[..] Port 3000 kepakai — nutup proses lama"
  lsof -ti tcp:3000 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

cd "$ROOT/kiosk" || { echo "[!!] Folder kiosk ga ketemu"; read -r -p "Enter buat nutup..."; exit 1; }

[ -d node_modules ] || { echo "[..] npm install (sekali doang, agak lama)"; npm install; }

echo "[..] Starting Next.js..."
npm run dev &
DEV_PID=$!

# Ctrl+C di jendela ini ikut nutup Next.js. Tanpa trap, proses nyangkut di
# background dan port 3000 kekunci sampai reboot.
trap 'echo ""; echo "[..] Nutup kiosk..."; kill $DEV_PID 2>/dev/null; exit 0' INT TERM

# Tunggu server bener-bener nerima koneksi — bukan sleep buta. Kalau browser
# kebuka sebelum Next.js siap, tamu liat ERR_CONNECTION_REFUSED.
echo "[..] Nunggu server ready..."
for _ in $(seq 1 60); do
  curl -sf -o /dev/null http://localhost:3000 && break
  sleep 1
done

CHROME="/Applications/Google Chrome.app"
# Profil Chrome terpisah biar bookmark/extension/login pribadi ga kebawa ke layar booth.
CHROME_FLAGS=(
  --start-fullscreen
  --use-fake-ui-for-media-stream
  --test-type
  --user-data-dir="$HOME/.semeta-chrome"
  --no-first-run
  --no-default-browser-check
  --disable-session-crashed-bubble
  --disable-infobars
  --overscroll-history-navigation=0
  --autoplay-policy=no-user-gesture-required
)
# CATATAN: --kiosk-printing SENGAJA ga dipasang. Di macOS route /api/print gagal
# (pdf-to-printer = Windows-only) dan kiosk jatuh ke window.print(). Dialog print
# yang muncul itu justru dipertahankan: operator bisa cek preview sebelum kertas
# 4R keluar. Tambahin flag ini cuma setelah sizing terbukti bener di printer asli.

if [ -d "$CHROME" ]; then
  open -a "$CHROME" --args "${CHROME_FLAGS[@]}" http://localhost:3000
  echo "[OK] Chrome fullscreen"
else
  open http://localhost:3000
  echo "[--] Chrome ga ada — kebuka di browser default (fullscreen manual: Cmd+Ctrl+F)"
fi

printf '\n  Kiosk   : http://localhost:3000\n'
printf '  Foto    : %s/event/\n' "$TEMPLATE_LOCAL"
printf '  Tutup   : Ctrl+C di jendela ini\n\n'

wait $DEV_PID
