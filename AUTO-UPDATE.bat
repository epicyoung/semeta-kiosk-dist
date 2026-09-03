@echo off
setlocal enabledelayedexpansion
title SEMETA KIOSK - AUTO UPDATE
cd /d "%~dp0"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "DIST_URL=https://github.com/epicyoung/semeta-kiosk-dist.git"

REM ============================================================================
REM  Sekali klik: tarik update terbaru -> compile ulang -> buka kiosk.
REM
REM  DIBIKIN TIMELESS — ga perlu disentuh tiap ada rilis:
REM   - Deteksi branch remote sendiri (main/master), ga di-hardcode
REM   - npm install otomatis kalau ada dependency baru (package.json berubah)
REM   - WAJIB compile ulang: cache dibuang + --rebuild. Bug yang cuma muncul di
REM     bundle produksi (mis. minifier ngerusak filter ffmpeg) ga bakal ketinggal
REM   - VERIFIKASI build beneran jadi sebelum ngaku sukses
REM   - GA ADA fallback ke mode dev. Mesin lapangan wajib produksi; kalau
REM     LAUNCHER-BUILD.BAT ilang, berhenti dengan pesan jelas — bukan diem-diem
REM     jalan mode dev yang lambat dan gampang mati sendiri
REM
REM  AMAN: template, pb_data, frame, secret, model AI TIDAK kesentuh (di-gitignore).
REM ============================================================================

echo ============================================================
echo   SEMETA KIOSK - AUTO UPDATE
echo ============================================================
echo.
echo   1. Tutup service kiosk yang lagi jalan
echo   2. Tarik kode terbaru dari GitHub (nimpa kode lama)
echo   3. Compile ulang ke versi baru, lalu buka kiosk
echo.
echo   AMAN: template, database, frame, secret, model AI TIDAK terhapus.
echo.

REM ---- [1/7] Prasyarat ----
echo [1/7] Cek prasyarat...
where git >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [GAGAL] Git belum keinstall di komputer ini.
  echo   Download: https://git-scm.com/download/win
  echo   Install dulu, lalu jalanin AUTO-UPDATE.bat ini lagi.
  echo.
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [GAGAL] Node.js/npm belum keinstall di komputer ini.
  echo   Download: https://nodejs.org  ^(pilih versi LTS^)
  echo   Install dulu, lalu jalanin AUTO-UPDATE.bat ini lagi.
  echo.
  pause
  exit /b 1
)
echo       OK.

REM ---- [2/7] Matiin service lama ----
echo [2/7] Nutup service kiosk lama...
if exist "%ROOT%\kill.bat" (
  call "%ROOT%\kill.bat" >nul 2>&1
) else (
  taskkill /F /IM node.exe >nul 2>&1
  taskkill /F /IM pocketbase.exe >nul 2>&1
  taskkill /F /IM python.exe >nul 2>&1
)
timeout /t 2 /nobreak >nul 2>&1
echo       OK.

REM ---- [3/7] Proteksi data lapangan ----
REM Safety net kalau .gitignore keilangan/kehapus. Jangan dihapus: tanpa ini
REM `git reset --hard` bisa nimpa template & database punya operator.
echo [3/7] Cek proteksi data lokal...
if exist "%ROOT%\.git\index.lock" del /f /q "%ROOT%\.git\index.lock" >nul 2>&1
if not exist "%ROOT%\.gitignore" type nul > "%ROOT%\.gitignore"
call :ensure_ignore "pb/pb_data/"
call :ensure_ignore "kiosk/face_server/put-template-here/"
call :ensure_ignore "kiosk/.env.local"
call :ensure_ignore "kiosk/.env"
call :ensure_ignore "kiosk/node_modules/"
call :ensure_ignore "kiosk/.next/"
call :ensure_ignore "**/venv/"
call :ensure_ignore "kiosk/face_server/*.onnx"
call :ensure_ignore "buffalo_l/"
echo       OK.

REM ---- [4/7] Tarik update ----
echo [4/7] Narik update dari server...
if not exist "%ROOT%\.git" (
  git init >nul 2>&1
  git remote add origin "%DIST_URL%" >nul 2>&1
) else (
  git remote set-url origin "%DIST_URL%" >nul 2>&1
)

REM Simpan hash package.json SEBELUM pull — buat tau perlu npm install atau nggak.
set "PKG_BEFORE=none"
if exist "%ROOT%\kiosk\package.json" (
  for /f "usebackq delims=" %%H in (`git hash-object "%ROOT%\kiosk\package.json" 2^>nul`) do set "PKG_BEFORE=%%H"
)

REM Branch remote dideteksi, BUKAN di-hardcode: repo dist boleh ganti main<->master
REM tanpa script ini perlu diedit.
set "BRANCH="
git ls-remote --exit-code --heads origin main >nul 2>&1 && set "BRANCH=main"
if not defined BRANCH git ls-remote --exit-code --heads origin master >nul 2>&1 && set "BRANCH=master"
if not defined BRANCH (
  echo.
  echo   [GAGAL] Ga bisa konek ke GitHub, atau branch main/master ga ketemu.
  echo   Cek koneksi internet mesin ini, lalu coba lagi.
  echo.
  pause
  exit /b 1
)

git fetch origin %BRANCH% --prune
if errorlevel 1 (
  echo.
  echo   [GAGAL] Fetch gagal. Cek koneksi internet mesin ini.
  echo.
  pause
  exit /b 1
)
git reset --hard origin/%BRANCH%
if errorlevel 1 (
  echo.
  echo   [GAGAL] Sinkronisasi kode gagal.
  echo.
  pause
  exit /b 1
)
for /f "usebackq delims=" %%V in (`git log -1 --format^=%%h 2^>nul`) do set "NEWREV=%%V"
echo       OK - kode sekarang di versi !NEWREV!.

REM ---- [5/7] Dependency ----
REM Kalau package.json berubah (ada library baru), build bakal gagal tanpa ini —
REM dan errornya ga nyambung sama sekali sama sebabnya.
echo [5/7] Cek dependency...
set "PKG_AFTER=none"
if exist "%ROOT%\kiosk\package.json" (
  for /f "usebackq delims=" %%H in (`git hash-object "%ROOT%\kiosk\package.json" 2^>nul`) do set "PKG_AFTER=%%H"
)
set "NEED_INSTALL="
if not exist "%ROOT%\kiosk\node_modules" set "NEED_INSTALL=1"
if not "!PKG_BEFORE!"=="!PKG_AFTER!" set "NEED_INSTALL=1"

if defined NEED_INSTALL (
  echo       Ada perubahan dependency - install ulang ^(bisa beberapa menit^)...
  pushd "%ROOT%\kiosk"
  call npm install --no-audit --no-fund
  set "NPM_ERR=!errorlevel!"
  popd
  if not "!NPM_ERR!"=="0" (
    echo.
    echo   [GAGAL] npm install gagal. Cek koneksi internet, lalu jalanin lagi.
    echo.
    pause
    exit /b 1
  )
  echo       OK.
) else (
  echo       OK - ga ada perubahan.
)

REM ---- [6/7] Buang cache build lama ----
REM WAJIB. Sebagian bug cuma hidup di bundle produksi yang udah di-minify — kalau
REM build lama kepake, fix-nya ga kepasang dan ga ada tanda apa-apa.
echo [6/7] Buang cache compile lama...
if exist "%ROOT%\kiosk\.next" rmdir /s /q "%ROOT%\kiosk\.next" >nul 2>&1
echo       OK.

REM ---- [7/7] Compile + jalanin ----
echo [7/7] Compile versi baru dan buka kiosk...
echo.
if not exist "%ROOT%\LAUNCHER-BUILD.BAT" (
  echo.
  echo   [GAGAL] LAUNCHER-BUILD.BAT ga ketemu di folder ini.
  echo   Update-nya berhasil ditarik, tapi kiosk ga bisa dibuka otomatis.
  echo   Hubungi admin - JANGAN pakai LAUNCHER-DEV.bat buat mesin lapangan.
  echo.
  pause
  exit /b 1
)

call "%ROOT%\LAUNCHER-BUILD.BAT" --rebuild

REM Verifikasi build beneran jadi. LAUNCHER build di foreground, jadi pas balik ke
REM sini BUILD_ID harusnya udah ada. Kalau nggak: compile-nya gagal, dan tanpa cek
REM ini operator cuma liat window ketutup tanpa tau kenapa.
if not exist "%ROOT%\kiosk\.next\BUILD_ID" (
  echo.
  echo   [PERINGATAN] Build produksi kelihatannya GAGAL.
  echo   Baca pesan error di atas. Kiosk mungkin ga kebuka.
  echo   Coba jalanin lagi; kalau tetap gagal, hubungi admin.
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   UPDATE SELESAI - versi !NEWREV!
echo ============================================================
echo.
echo   Langkah terakhir DI DALAM KIOSK:
echo   Kalau ada template baru, tekan tombol Rebuild ^(ikon lingkaran
echo   di kanan atas, sebelah tombol sync^) sekali. Update kode ga
echo   mindahin template ke database dengan sendirinya.
echo.
pause
exit /b 0

REM ---- helper: tambahin baris ke .gitignore kalau belum ada ----
:ensure_ignore
findstr /i /x /c:"%~1" "%ROOT%\.gitignore" >nul 2>&1
if errorlevel 1 >> "%ROOT%\.gitignore" echo %~1
exit /b 0
