@echo off
setlocal enabledelayedexpansion
title SEMETA KIOSK - AUTO UPDATE & FORCE SYNC
cd /d "%~dp0"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "DIST_URL=https://github.com/epicyoung/semeta-kiosk-dist.git"

echo ============================================================
echo   SEMETA KIOSK - AUTO UPDATE & FORCE OVERWRITE
echo ============================================================
echo.
echo   Script ini akan:
echo     1. Menutup semua service kiosk yang sedang berjalan
echo     2. Menarik KODE TERBARU dari GitHub (menimpa konflik kode)
echo     3. AMAN: Template, frame, secret, dan model AI TIDAK terhapus
echo     4. Re-compile otomatis ke versi terbaru & buka Kiosk
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [GAGAL] Git belum terinstall di Windows ini!
  echo Silakan download dan install Git dari: https://git-scm.com/download/win
  echo Setelah install Git, jalankan AUTO-UPDATE.bat ini lagi.
  echo.
  pause
  exit /b 1
)

echo [1/6] Menghentikan service kiosk lama...
if exist "%ROOT%\kill.bat" (
  call "%ROOT%\kill.bat" >nul 2>&1
) else (
  taskkill /F /IM node.exe >nul 2>&1
  taskkill /F /IM pocketbase.exe >nul 2>&1
  taskkill /F /IM python.exe >nul 2>&1
)
timeout /t 2 /nobreak >nul 2>&1
echo       OK.

REM ---- Bersihkan lock git jika ada crash sebelumnya ----
if exist "%ROOT%\.git\index.lock" del /f /q "%ROOT%\.git\index.lock" >nul 2>&1

REM ---- Pastikan safety net .gitignore lokal melindungi data lapangan ----
echo [2/6] Memeriksa proteksi data lokal...
if not exist "%ROOT%\.gitignore" (
  > "%ROOT%\.gitignore" echo pb/pb_data/
  >> "%ROOT%\.gitignore" echo kiosk/.env.local
  >> "%ROOT%\.gitignore" echo kiosk/.env
  >> "%ROOT%\.gitignore" echo kiosk/node_modules/
  >> "%ROOT%\.gitignore" echo kiosk/.next/
  >> "%ROOT%\.gitignore" echo **/venv/
  >> "%ROOT%\.gitignore" echo kiosk/face_server/*.onnx
)
echo       OK.

REM ---- Pastikan folder ini terhubung ke git repo dist ----
echo [3/6] Menghubungkan ke server update GitHub...
if not exist "%ROOT%\.git" (
  git init >nul 2>&1
  git remote add origin "%DIST_URL%" >nul 2>&1
) else (
  git remote set-url origin "%DIST_URL%" >nul 2>&1
)

REM ---- Tarik update terbaru secara paksa (NIMPA KODE LAMA) ----
echo [4/6] Menarik update terbaru dari server (force sync)...
git fetch origin main --prune
if errorlevel 1 (
  echo [!] Gagal fetch main, mencoba fetch master...
  git fetch origin master --prune
  if errorlevel 1 (
    echo [GAGAL] Tidak bisa konek ke GitHub. Cek koneksi internet mesin ini!
    pause
    exit /b 1
  )
  git reset --hard origin/master
) else (
  git reset --hard origin/main
)

echo       Update kode berhasil ditarik dan disinkronkan 100%%.

REM ---- Hapus cache build lama agar dipaksa re-compile ----
echo [5/6] Membersihkan cache compile lama...
if exist "%ROOT%\kiosk\.next\BUILD_ID" del /f /q "%ROOT%\kiosk\.next\BUILD_ID" >nul 2>&1
echo       OK.

REM ---- Jalankan compile ulang produksi dan start Kiosk ----
echo [6/6] Memulai kompilasi versi baru & meluncurkan Kiosk...
echo.
echo ============================================================
echo   UPDATE SELESAI! Kiosk akan langsung di-compile dan dibuka.
echo ============================================================
echo.

if exist "%ROOT%\LAUNCHER-BUILD.BAT" (
  call "%ROOT%\LAUNCHER-BUILD.BAT" --rebuild
) else if exist "%ROOT%\LAUNCHER-DEV.bat" (
  call "%ROOT%\LAUNCHER-DEV.bat"
) else (
  cd /d "%ROOT%\kiosk"
  npm run build && npm run start
)

pause
