@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Semeta Kiosk - Setup
echo ============================================
echo.

REM --- 1. Cek runtime ---
where node >nul 2>&1
if errorlevel 1 (
  echo [X] Node.js belum keinstall. Download LTS: https://nodejs.org
  goto :fail
)
for /f "tokens=*" %%v in ('node -v') do echo [OK] Node %%v

where python >nul 2>&1
if errorlevel 1 (
  echo [X] Python belum keinstall / belum di PATH. https://python.org ^(centang "Add to PATH"^)
  goto :fail
)
for /f "tokens=*" %%v in ('python --version') do echo [OK] %%v
echo.

REM --- 2. Copy buffalo_l ke home dir ---
REM Source dari git clone; model + pb dari bundle 'semeta-kiosk-MODELS' (di-copy ke folder ini).
REM Cuma buffalo_l yang perlu dipindah: InsightFace hardcoded nyari di ~\.insightface\models\,
REM bukan di folder app. inswapper/codeformer udah di kiosk\face_server\ dari bundle.
if not exist "pb\pocketbase.exe" (
  echo [X] pb\pocketbase.exe GA ADA
  echo     Copy pb\ dari bundle 'semeta-kiosk-MODELS' ke folder ini dulu. Setup dihentikan.
  goto :fail
) else (
  echo [OK] PocketBase binary ada
)

if exist "buffalo_l\" if not exist "%USERPROFILE%\.insightface\models\buffalo_l" (
  echo [..] Copy buffalo_l ke %%USERPROFILE%%\.insightface\models\...
  if not exist "%USERPROFILE%\.insightface\models" mkdir "%USERPROFILE%\.insightface\models"
  xcopy /E /I /Q "buffalo_l" "%USERPROFILE%\.insightface\models\buffalo_l" >nul
)
echo.

REM --- 3. Verifikasi model AI ada (HARD STOP kalau yang wajib hilang) ---
REM inswapper = model inti faceswap. Tanpa ini kiosk jalan tapi faceswap ERROR pas dipakai.
REM Stop di sini biar Budi gak kejebak kiosk yang keliatan OK tapi rusak pas event.
if not exist "kiosk\face_server\inswapper_128.onnx" (
  echo [X] inswapper_128.onnx GA ADA di kiosk\face_server\
  echo.
  echo     Source udah ke-clone, tapi MODEL AI belum dipasang.
  echo     Copy isi bundle 'semeta-kiosk-MODELS' ^(dari admin^) ke folder ini dulu:
  echo       - kiosk\face_server\inswapper_128.onnx
  echo       - buffalo_l\  +  pb\
  echo     Lihat README.md buat detail. Setup dihentikan.
  goto :fail
) else (
  echo [OK] inswapper_128.onnx ada
)
if not exist "kiosk\face_server\codeformer.onnx" (
  echo [!] codeformer.onnx ga ada ^(opsional - enhance di-skip^)
) else (
  echo [OK] codeformer.onnx ada
)
if not exist "%USERPROFILE%\.insightface\models\buffalo_l" (
  echo [!] buffalo_l ga ada - bakal auto-download first run ^(butuh internet ~326MB^)
) else (
  echo [OK] buffalo_l ada
)
echo.

REM --- 4. Kiosk: npm install + .env.local ---
echo [..] npm install ^(kiosk^)...
cd kiosk
call npm install
if errorlevel 1 ( echo [X] npm install gagal & goto :fail )
echo.

if not exist ".env.local" (
  if exist ".env.local.example" (
    copy ".env.local.example" ".env.local" >nul
    echo [OK] .env.local dibuat dari example
    echo [!] WAJIB isi KIOSK_SECRET dan NEXT_PUBLIC_WORKER_URL di kiosk\.env.local
  ) else (
    echo [!] .env.local belum ada dan .env.local.example ga ketemu - buat manual
  )
) else (
  echo [OK] .env.local sudah ada
)
echo.

REM --- 5. Face server: venv + pip install (butuh Python 3.11) ---
echo [..] Setup Python venv ^(face_server^)...
cd face_server

REM Cari Python 3.11 via py launcher dulu, fallback ke python
set "PY311="
py -3.11 --version >nul 2>&1 && set "PY311=py -3.11"
if not defined PY311 (
  echo [!] py -3.11 ga ketemu - coba python langsung
  echo [!] InsightFace butuh Python 3.10-3.12. Python 3.13+ GA SUPPORT.
  python --version 2>&1
)

if not exist "venv" (
  if defined PY311 (
    %PY311% -m venv venv
  ) else (
    python -m venv venv
  )
)
venv\Scripts\python.exe -m pip install --upgrade pip -q
venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 ( echo [X] pip install gagal - install Python 3.11 dari python.org lalu hapus folder venv dan setup ulang & goto :fail )
cd ..\..

echo.
echo ============================================
echo   SETUP SELESAI
echo ============================================
echo.
echo Langkah selanjutnya:
echo   1. Isi kiosk\.env.local ^(KIOSK_SECRET + NEXT_PUBLIC_WORKER_URL^)
echo   2. Double-click LAUNCHER.bat untuk jalanin semua service
echo   3. Buka http://localhost:3000
echo.
echo Import template pertama kali:
echo   Taruh gambar 2:3 ke kiosk\face_server\inbox-templates\
echo   lalu double-click kiosk\face_server\import.bat
echo.
goto :end

:fail
echo.
echo *** SETUP GAGAL - lihat error di atas ***
:end
echo.
pause
