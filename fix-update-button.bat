@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM ============================================================================
REM   fix-update-button.bat — ubah folder kiosk hasil ZIP jadi git repo
REM ============================================================================
REM   MASALAH: kiosk di-install dari ZIP GitHub (bukan git clone) → folder .git
REM     GAK ADA → tombol "Update" di Settings ILANG (route balikin isGit:false).
REM   FIX: init git di sini + sambungin ke repo dist + tarik source terbaru.
REM     Jalanin SEKALI. Abis ini tombol Update MUNCUL selamanya.
REM
REM   AMAN — pb_data (template + frame Budi), .env.local, model AI, venv semua
REM   ke-GITIGNORE di repo dist → git GAK NYENTUH. Cuma source code yang refresh.
REM ============================================================================

set "DIST_URL=https://github.com/epicyoung/semeta-kiosk-dist.git"

echo ============================================
echo   Fix tombol Update (ZIP -^> git repo)
echo ============================================
echo.
echo   Folder    : %~dp0
echo   Repo dist : %DIST_URL%
echo.
echo   Ini bakal narik SOURCE CODE terbaru dari GitHub.
echo   AMAN: template, frame, secret, model AI kamu TIDAK tersentuh.
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [X] Git belum keinstall. Install dulu dari https://git-scm.com/download/win
  goto :fail
)

REM ---- Udah git repo? berarti ga perlu fix ----
if exist "%~dp0.git" (
  echo [i] Folder ini SUDAH git repo. Tombol Update harusnya udah ada.
  echo     Kalau masih ilang: kill.bat lalu buka lagi LAUNCHER-BUILD.BAT.
  goto :end
)

set /p CONT="Lanjut fix sekarang? (y/N): "
if /i not "!CONT!"=="y" ( echo Dibatalkan. & goto :end )
echo.

REM ---- 1. init git ----
echo [1/5] git init...
git init
if errorlevel 1 ( echo [X] git init gagal & goto :fail )

REM ---- 2. safety net: .gitignore lokal DULU (sebelum fetch/reset) biar pb_data,
REM        .env.local, model, venv GAK ke-hapus pas reset --hard ----
echo [2/5] Tulis .gitignore pengaman (lindungi data lapangan)...
> "%~dp0.gitignore" echo pb/pb_data/
>> "%~dp0.gitignore" echo kiosk/.env.local
>> "%~dp0.gitignore" echo kiosk/.env
>> "%~dp0.gitignore" echo kiosk/node_modules/
>> "%~dp0.gitignore" echo kiosk/.next/
>> "%~dp0.gitignore" echo **/venv/
>> "%~dp0.gitignore" echo kiosk/face_server/*.onnx

REM ---- 3. sambungin ke repo dist ----
echo [3/5] Sambungin remote ke repo dist...
git remote remove origin >nul 2>&1
git remote add origin "%DIST_URL%"
git fetch origin
if errorlevel 1 ( echo [X] git fetch gagal - cek koneksi internet & goto :fail )

REM ---- 4. tarik source terbaru (branch main). pb_data dkk aman (gitignored) ----
echo [4/5] Tarik source terbaru dari origin/main...
git reset --hard origin/main
if errorlevel 1 ( echo [X] git reset gagal & goto :fail )
git branch --set-upstream-to=origin/main main >nul 2>&1

REM ---- 5. beres ----
echo [5/5] Selesai.
echo.
echo ============================================
echo   BERES - folder ini sekarang git repo
echo ============================================
echo.
echo   Langkah berikutnya:
echo     1. Tutup Chrome kiosk, jalanin kill.bat
echo     2. Jalanin: LAUNCHER-BUILD.BAT --rebuild
echo        ^(--rebuild WAJIB: langkah di atas barusan narik source baru,
echo         mode produksi ga bakal kepake sebelum di-compile ulang.^)
echo     3. Settings ^(gear^) -^> Sistem -^> tombol "Cek update" SEKARANG MUNCUL
echo.
echo   Template + frame + secret kamu AMAN, gak kehapus.
echo.
goto :end

:fail
echo.
echo *** FIX GAGAL - lihat error di atas ***
echo   Kalau mentok, hubungi admin. Data kamu TIDAK berubah.

:end
echo.
pause
