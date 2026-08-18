@echo off
setlocal enabledelayedexpansion
REM '&' WAJIB di-escape jadi '^&' — di batch dia separator perintah, jadi tanpa escape
REM cmd nyoba jalanin "Launch Production" sebagai perintah dan ngelempar error di baris
REM pertama tiap kali file ini dibuka.
title SEMETA KIOSK - Rebuild ^& Launch Production
cd /d "%~dp0"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo ============================================================
echo  SEMETA KIOSK - REBUILD PRODUCTION BUILD
echo ============================================================
echo.
REM Konfirmasi SEBELUM kill, bukan sesudah. kill.bat nge-taskkill /IM chrome.exe — SEMUA
REM Chrome mati, termasuk jendela pribadi operator. Pas dipanggil manual, operator sadar
REM konsekuensinya karena dia yang ngetik; di balik double-click ini kepanggil sendiri,
REM jadi tanpa gerbang ini tab orang ilang tanpa peringatan dan tanpa jejak di layar.
echo  PERHATIAN: proses ini nutup SEMUA jendela Chrome, bukan cuma kiosk.
echo  Ada tab Chrome lain yang lagi kepake? Simpen dulu sekarang.
echo.
set /p GO="Lanjut rebuild + restart kiosk? (y/N): "
if /i not "!GO!"=="y" (
  echo Dibatalkan. Ga ada yang diubah.
  echo.
  pause
  exit /b 0
)
echo.

echo [1/2] Mematikan proses lama...
REM Output kill.bat SENGAJA ga dibungkam — operator harus lihat apa yang mati.
call "%ROOT%\kill.bat"
timeout /t 1 /nobreak >nul

echo [2/2] Memulai build ulang (Next.js) dan menyalakan Kiosk...
echo.
call "%ROOT%\LAUNCHER-BUILD.BAT" --rebuild %*
