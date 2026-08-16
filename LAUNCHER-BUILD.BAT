@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

REM ============================================================================
REM  LAUNCHER-BUILD.BAT  —  MODE PRODUKSI buat KIOSK LAPANGAN
REM
REM  Beda dari LAUNCHER.bat: ini jalanin `npm run build` + `npm run start`
REM  (produksi, pre-compiled, STABIL) BUKAN `npm run dev` (rapuh, gampang mati
REM  kalau file berubah / hot-reload ngambek). Dev mode CUMA buat ngoding.
REM
REM  Pakai ini di mesin klien / event. Pakai LAUNCHER.bat cuma pas ngoding lokal.
REM
REM  Argumen opsional:
REM    LAUNCHER-BUILD.BAT --rebuild   → paksa build ulang walau .next udah ada
REM  Default: skip build kalau folder .next udah ada (restart CEPAT, ga build lagi).
REM ============================================================================

set "FORCE_REBUILD="
if /I "%~1"=="--rebuild" set "FORCE_REBUILD=1"

powershell -NoProfile -Command "$e=[char]27;$p=$e+'[38;2;255;64;153m';$r=$e+'[0m';$d=$e+'[90m';cls;Write-Host '';Write-Host ($p+'###### #####  ####  #####  ##  ##  #####  ##   ## ##   ##  #####'+$r);Write-Host ($p+'##     ##  ##  ##  ##     ##  ## ##   ## ##   ## ###  ## ##    '+$r);Write-Host ($p+'####   #####   ##  ##     #####  ##   ## ##   ## ## # ## ## ###'+$r);Write-Host ($p+'##     ##      ##  ##      ##    ##   ## ##   ## ##  ### ##   ##'+$r);Write-Host ($p+'###### ##     ####  #####   ##    #####   #####  ##   ##  #####'+$r);Write-Host '';Write-Host ($d+'  Starting Semeta by Spindonesia x Epicyoung — MODE PRODUKSI (build+start)'+$r);Write-Host ''"

REM ── Guard: kiosk masih nyala? Dua kerusakan sekaligus kalau diterusin —
REM    (1) `next build` gagal, Windows ngunci file di .next yang lagi dibaca server lama;
REM    (2) poll port 3000 di bawah nemu server LAMA, lapor "siap", browser kebuka ke
REM        build LAMA — operator ngira update kepasang padahal enggak. ──
netstat -ano | findstr /C:":3000 " | findstr LISTENING >nul 2>&1
if not errorlevel 1 (
  echo.
  echo ============================================================
  echo  [STOP] Port 3000 udah kepake — kiosk masih nyala.
  echo  Tutup dulu pakai kill.bat, baru jalanin file ini lagi.
  echo ============================================================
  echo.
  pause
  exit /b 1
)

REM ── node_modules ada? Tanpa ini error `npm run build` ga jelas juntrungannya. ──
if not exist "%ROOT%\kiosk\node_modules" (
  echo [GAGAL] kiosk\node_modules ga ada — jalanin setup.bat dulu.
  pause
  exit /b 1
)

REM ── Build kiosk dulu (FOREGROUND — operator lihat progress + error ketauan sebelum booth kebuka) ──
if defined FORCE_REBUILD (
  echo [BUILD] --rebuild diminta — compile ulang produksi...
  goto :do_build
)
REM Cek BUILD_ID, bukan folder .next: build yang gagal/keputus di tengah tetep ninggalin
REM .next separo jadi. Kalau cuma ngecek foldernya, script bilang "OK" terus `next start`
REM mati dengan "Could not find a production build" — di window minimize, ga keliatan.
if not exist "%ROOT%\kiosk\.next\BUILD_ID" (
  echo [BUILD] Belum ada build produksi yang utuh — compile dulu...
  goto :do_build
)
echo [OK] Build lama kepake. Mau compile ulang? tutup + jalanin: LAUNCHER-BUILD.BAT --rebuild
goto :build_done

:do_build
pushd "%ROOT%\kiosk"
call npm run build
set "BUILD_ERR=%ERRORLEVEL%"
popd
if not "%BUILD_ERR%"=="0" (
  REM Buang BUILD_ID biar run berikutnya KEPAKSA compile ulang. Tanpa ini, sisa BUILD_ID
  REM dari build lama bikin script bilang "Build lama kepake" — booth jalan pakai kode
  REM lama diam-diam, persis kondisi yang bikin operator ngira update udah kepasang.
  del /q "%ROOT%\kiosk\.next\BUILD_ID" >nul 2>&1
  echo.
  echo ============================================================
  echo  [GAGAL] npm run build ERROR ^(exit %BUILD_ERR%^).
  echo  JANGAN buka booth. Cek pesan error di atas dulu.
  echo  Kalau mepet event: pakai build lama lewat LAUNCHER.bat ^(dev^) sementara.
  echo ============================================================
  echo.
  pause
  exit /b %BUILD_ERR%
)
echo [OK] Build produksi selesai.
:build_done

REM ── PocketBase ──
if exist "%ROOT%\pb\pocketbase.exe" (
  start /min "PocketBase" cmd /k ""%ROOT%\pb\pocketbase.exe" serve --dir "%ROOT%\pb\pb_data""
  echo [OK] PocketBase — port 8090
  echo      Admin: http://localhost:8090/_/
) else (
  echo [--] PocketBase skip — jalanin setup.bat dulu
)

REM ── Face server ──
if exist "%ROOT%\kiosk\face_server\venv\Scripts\python.exe" (
  if exist "%ROOT%\kiosk\face_server\inswapper_128.onnx" (
    start /min "FaceServer" cmd /k "cd /d "%ROOT%\kiosk\face_server" && venv\Scripts\python face_server.py"
    echo [OK] Face server — port 8000
  ) else (
    echo [--] Face server skip — inswapper_128.onnx belum ada
  )
) else (
  echo [--] Face server skip — jalanin setup.bat dulu
)

REM ── ComfyUI — TIDAK auto-start lagi. Toggle "Fullbody Engine" di kiosk Settings yang
REM    nyalain/matiin (POST /comfy/start|stop ke face_server). VRAM idle mahal buat tenant
REM    yang gak jual paket Fullbody — operator nyalain manual pas emang jual. ──
echo [--] ComfyUI — nyalain manual via Settings ^> Fullbody Engine kalau jual paket Fullbody

REM ── Kiosk UI — PRODUKSI: next start (bukan dev). Butuh .next dari build di atas. ──
start /min "Kiosk" cmd /k "cd /d "%ROOT%\kiosk" && npm run start"
echo [OK] Kiosk — port 3000 ^(next start, produksi^)

REM ── Tunggu Next.js beneran LISTENING di 3000 baru buka browser. Poll, bukan timeout buta —
REM    next start bisa butuh beberapa detik, buka browser kecepetan = "connection refused". ──
echo [..] Nunggu kiosk siap di port 3000...
set "READY="
for /L %%i in (1,1,60) do (
  if not defined READY (
    netstat -ano | findstr /C:":3000 " | findstr LISTENING >nul 2>&1
    if not errorlevel 1 (
      set "READY=1"
      echo [OK] Kiosk siap.
    ) else (
      timeout /t 1 /nobreak >nul
    )
  )
)
if not defined READY (
  echo.
  echo ============================================================
  echo  [GAGAL] Port 3000 ga listening setelah 60 detik.
  echo  `next start` mati. Errornya ada di window "Kiosk" yang
  echo  ke-minimize — buka dari taskbar buat baca pesannya.
  echo  Paling sering: build korup. Tutup ^(kill.bat^) lalu jalanin
  echo  LAUNCHER-BUILD.BAT --rebuild
  echo ============================================================
  echo.
  pause
  exit /b 1
)

REM ── Browser fullscreen (flag identik LAUNCHER.bat — dedicated profile, izin kamera, no dialog banner) ──
set "BROWSER="
set "KDATA=%LOCALAPPDATA%\SemetaKioskChrome"
set "BFLAGS=--start-fullscreen --use-fake-ui-for-media-stream --test-type --user-data-dir="%KDATA%" --no-first-run --no-default-browser-check --disable-features=Translate,InfobarUIForBubble --disable-session-crashed-bubble --disable-infobars --overscroll-history-navigation=0 --autoplay-policy=no-user-gesture-required"
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "BROWSER=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "BROWSER=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "BROWSER=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "BROWSER=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
if defined BROWSER (
  start "" "%BROWSER%" %BFLAGS% http://localhost:3000
  echo [OK] Browser fullscreen
) else (
  start "" http://localhost:3000
  echo [--] Chrome/Edge ga ada — buka default browser
)

echo.
echo   Kiosk  : http://localhost:3000  ^(MODE PRODUKSI^)
echo   PB     : http://localhost:8090/_/
echo   Tutup  : kill.bat
echo   Update kode? tutup ^(kill.bat^) lalu: LAUNCHER-BUILD.BAT --rebuild
echo.
pause
