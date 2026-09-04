@echo off
setlocal enabledelayedexpansion
title SEMETA - PASANG / UPDATE TEMPLATE EVENT
cd /d "%~dp0"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "INBOX=%ROOT%\kiosk\face_server\put-template-here"

REM ============================================================================
REM  Buat operator lapangan. Pasang / perbarui folder template event, lalu paksa
REM  kiosk muat ulang SEMUA template dari nol (REBUILD) — bukan sync biasa.
REM
REM  KENAPA REBUILD, bukan sync biasa:
REM  Sync biasa cuma nambah yang BARU + ganti yang berubah. Kalau ada record lama
REM  nyangkut di database (mis. template dari event sebelumnya, atau gambar
REM  referensi versi lama), dia bisa ikut kebawa ke event berikutnya. Rebuild
REM  hapus SEMUA record dulu baru muat ulang dari folder — nol sisa, nol nyelip.
REM
REM  CARA PAKAI:
REM   1. Copy folder template event (mis. Garudafood4) ke:
REM      kiosk\face_server\put-template-here\
REM   2. Klik dua kali file ini.
REM
REM  JANGAN dipakai pas ada tamu antre: selama rebuild, grid template kosong
REM  beberapa detik.
REM ============================================================================

echo ============================================================
echo   PASANG / UPDATE TEMPLATE EVENT
echo ============================================================
echo.

REM ---- [1/4] Cek folder template ----
echo [1/4] Cek folder template...
if not exist "%INBOX%" (
  echo.
  echo   [GAGAL] Folder template ga ketemu:
  echo   %INBOX%
  echo.
  echo   Pastikan file ini ditaruh di folder utama kiosk ^(sejajar sama kill.bat^).
  echo.
  pause
  exit /b 1
)

set "NFOLDER=0"
for /d %%D in ("%INBOX%\*") do (
  if /i not "%%~nxD"=="node_modules" (
    set /a NFOLDER+=1
    echo       - %%~nxD
  )
)
if "!NFOLDER!"=="0" (
  echo.
  echo   [GAGAL] Belum ada folder template di dalam:
  echo   %INBOX%
  echo.
  echo   Copy dulu folder event-nya ^(mis. Garudafood4^) ke situ, lalu ulangi.
  echo.
  pause
  exit /b 1
)
echo       OK - !NFOLDER! folder kategori ketemu.

REM ---- [2/4] Pastikan kiosk nyala ----
REM Rebuild jalan lewat kiosk (dia yang megang kredensial PocketBase), jadi
REM servernya WAJIB hidup dulu.
echo [2/4] Cek kiosk nyala...
netstat -ano | findstr /C:":3000 " | findstr LISTENING >nul 2>&1
if errorlevel 1 (
  echo       Kiosk belum nyala - nyalain dulu...
  if not exist "%ROOT%\LAUNCHER-BUILD.BAT" (
    echo.
    echo   [GAGAL] LAUNCHER-BUILD.BAT ga ketemu. Nyalain kiosk manual dulu,
    echo   lalu jalanin file ini lagi.
    echo.
    pause
    exit /b 1
  )
  start "" "%ROOT%\LAUNCHER-BUILD.BAT"
  echo       Nunggu kiosk siap ^(maksimal 3 menit^)...
  set "READY="
  for /l %%i in (1,1,90) do (
    if not defined READY (
      timeout /t 2 /nobreak >nul 2>&1
      netstat -ano | findstr /C:":3000 " | findstr LISTENING >nul 2>&1
      if not errorlevel 1 set "READY=1"
    )
  )
  if not defined READY (
    echo.
    echo   [GAGAL] Kiosk ga nyala-nyala dalam 3 menit.
    echo   Buka window "Kiosk" di taskbar buat baca errornya.
    echo.
    pause
    exit /b 1
  )
  REM Kasih napas bentar: port udah LISTENING tapi route API bisa belum siap.
  timeout /t 5 /nobreak >nul 2>&1
)
echo       OK - kiosk jalan di port 3000.

REM ---- [3/4] REBUILD ----
echo [3/4] Muat ulang SEMUA template dari folder ^(rebuild^)...
echo       Ini hapus data template lama di database lalu isi ulang dari folder.
echo       Sabar, bisa beberapa menit kalau template-nya banyak...
echo.

REM PENTING: route ini SELALU balas HTTP 200 — hasil aslinya ada di dalam badan
REM stream (`"ok":false` + error). Jadi cek status HTTP doang GA CUKUP: rebuild yang
REM gagal karena PocketBase mati bakal kebaca "sukses" dan operator ninggalin booth
REM dengan template kosong. Isi badan WAJIB diparse.
powershell -NoProfile -Command ^
  "try {" ^
  "  $r = Invoke-WebRequest -Uri 'http://localhost:3000/api/sync-templates?rebuild=1' -Method POST -TimeoutSec 900 -UseBasicParsing;" ^
  "  $ev = ($r.Content -split \"`n\") | Where-Object { $_.StartsWith('data: ') } | ForEach-Object { try { $_.Substring(6) | ConvertFrom-Json } catch { $null } } | Where-Object { $_ -ne $null };" ^
  "  $fin = $ev | Where-Object { $_.PSObject.Properties.Name -contains 'ok' } | Select-Object -Last 1;" ^
  "  if (-not $fin) { Write-Host '       Server ga ngasih hasil akhir.'; exit 1 }" ^
  "  if (-not $fin.ok) { Write-Host ('       Server bilang GAGAL: ' + $fin.error); exit 1 }" ^
  "  Write-Host ('       Template masuk  : ' + $fin.added);" ^
  "  if ($fin.updated) { Write-Host ('       Diperbarui      : ' + $fin.updated) }" ^
  "  if ($fin.skipped -and $fin.skipped.Count -gt 0) {" ^
  "    Write-Host ('       [!] DI-SKIP     : ' + $fin.skipped.Count + ' file - INI YANG GA MASUK:');" ^
  "    $fin.skipped | ForEach-Object { Write-Host ('           - ' + $_.name + '  (' + $_.reason + ')') };" ^
  "  }" ^
  "  if ($fin.added -eq 0) { Write-Host '       [!] NOL template masuk - folder-nya kosong / semua ke-skip.'; exit 1 }" ^
  "  exit 0" ^
  "} catch { Write-Host ('       ' + $_.Exception.Message); exit 1 }"

if errorlevel 1 (
  echo.
  echo   [GAGAL] Template TIDAK jadi dipasang.
  echo.
  echo   Sebab paling sering: PocketBase ^(database^) ga nyala.
  echo   Coba urut:
  echo     1. Tutup semua           : kill.bat
  echo     2. Buka kiosk lengkap    : LAUNCHER-BUILD.BAT
  echo        ^(LAUNCHER nyalain PocketBase + kiosk sekalian^)
  echo     3. Ulangi file ini
  echo.
  pause
  exit /b 1
)
echo       OK.

REM ---- [4/4] Selesai ----
echo [4/4] Selesai.
echo.
echo ============================================================
echo   TEMPLATE SIAP DIPAKAI
echo ============================================================
echo.
echo   Cek di layar kiosk: jumlah template harus sesuai isi folder.
echo   Kalau ada yang kurang, baca baris "di-skip" di atas - biasanya
echo   gambar referensi atau frame yang filenya ga ada.
echo.
pause
exit /b 0
