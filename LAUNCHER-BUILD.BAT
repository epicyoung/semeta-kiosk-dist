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

REM ── Build kiosk dulu (FOREGROUND — operator lihat progress + error ketauan sebelum booth kebuka) ──
if defined FORCE_REBUILD (
  echo [BUILD] --rebuild diminta — compile ulang produksi...
  goto :do_build
)
if not exist "%ROOT%\kiosk\.next" (
  echo [BUILD] Belum ada build (.next ga ada) — compile produksi dulu...
  goto :do_build
)
echo [OK] Build lama kepake (.next udah ada). Mau build ulang? tutup + jalanin: LAUNCHER-BUILD.BAT --rebuild
goto :build_done

:do_build
pushd "%ROOT%\kiosk"
call npm run build
set "BUILD_ERR=%ERRORLEVEL%"
popd
if not "%BUILD_ERR%"=="0" (
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

REM ── ComfyUI — kompor stylize buat mode Fullbody. Reuse 0MulaiComfy.bat (flags cuma di satu tempat). ──
netstat -ano | findstr /C:":8188 " | findstr LISTENING >nul 2>&1
if not errorlevel 1 (
  echo [OK] ComfyUI udah nyala — port 8188
  goto :comfy_done
)
if exist "C:\ComfyUI\0MulaiComfy.bat" (
  start /min "ComfyUI" cmd /c "C:\ComfyUI\0MulaiComfy.bat"
  echo [OK] ComfyUI — port 8188, model ke-load pas job stylize pertama
) else (
  echo [--] ComfyUI skip — C:\ComfyUI ga ada, mode Fullbody butuh ini
)
:comfy_done

REM ── Kiosk UI — PRODUKSI: next start (bukan dev). Butuh .next dari build di atas. ──
start /min "Kiosk" cmd /k "cd /d "%ROOT%\kiosk" && npm run start"
echo [OK] Kiosk — port 3000 ^(next start, produksi^)

REM ── Tunggu Next.js beneran LISTENING di 3000 baru buka browser. Poll, bukan timeout buta —
REM    next start bisa butuh beberapa detik, buka browser kecepetan = "connection refused". ──
echo [..] Nunggu kiosk siap di port 3000...
set "READY="
for /L %%i in (1,1,30) do (
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
if not defined READY echo [!!] Port 3000 belum listening setelah 30s — browser tetep dibuka, refresh manual kalau perlu.

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
