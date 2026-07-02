@echo off
setlocal
cd /d "%~dp0"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

powershell -NoProfile -Command "$e=[char]27;$p=$e+'[38;2;255;64;153m';$r=$e+'[0m';$d=$e+'[90m';cls;Write-Host '';Write-Host ($p+'██████ █████  ████  █████ ██   ██  █████  ██   ██ ██   ██  █████'+$r);Write-Host ($p+'██     ██  ██  ██  ██    ██   ██ ██   ██ ██   ██ ███  ██ ██    '+$r);Write-Host ($p+'████   █████   ██  ██     █████  ██   ██ ██   ██ ██ █ ██ ██  ███'+$r);Write-Host ($p+'██     ██      ██  ██      ██    ██   ██ ██   ██ ██  ███ ██   ██'+$r);Write-Host ($p+'██████ ██     ████  █████   ██    █████   █████  ██   ██  ██████'+$r);Write-Host '';Write-Host ($d+'  Starting Semeta by Spindonesia x Epicyoung AI Pro Booth...'+$r);Write-Host ''"

REM PocketBase
if exist "%ROOT%\pb\pocketbase.exe" (
  start /min "PocketBase" cmd /k ""%ROOT%\pb\pocketbase.exe" serve --dir "%ROOT%\pb\pb_data""
  echo [OK] PocketBase started (port 8090)
  echo      Admin: http://localhost:8090/_/
) else (
  echo [!] pb\pocketbase.exe ga ada - jalanin setup.bat dulu
)

REM Face server
if exist "%ROOT%\kiosk\face_server\venv\Scripts\python.exe" (
  if exist "%ROOT%\kiosk\face_server\inswapper_128.onnx" (
    start /min "FaceServer" cmd /k "cd /d "%ROOT%\kiosk\face_server" && venv\Scripts\python face_server.py"
    echo [OK] Face server started (port 8000)
  ) else (
    echo [!] inswapper_128.onnx ga ada - jalanin setup.bat dulu
  )
) else (
  echo [!] face_server\venv belum ada - jalanin setup.bat dulu
)

REM Kiosk UI
start /min "Kiosk" cmd /k "cd /d "%ROOT%\kiosk" && npm run dev"
echo [OK] Kiosk started (port 3000)

REM Tunggu Next.js ready baru buka browser
timeout /t 5 /nobreak >nul
set "BROWSER="
REM Dedicated profile = flag kiosk ga mental kalau Chrome utama lagi kebuka.
REM --start-fullscreen (bukan --kiosk): lebih stabil pas print, ga keluar fullscreen.
REM --use-fake-ui-for-media-stream: auto-grant izin kamera (device ASLI, bukan fake).
REM   Wajib karena profil fresh di --user-data-dir belum pernah kasih izin kamera,
REM   dan prompt-nya ketutup fullscreen → getUserMedia gantung di "LOADING CAMERA...".
REM --test-type: nge-suppress banner kuning "unsupported command-line flag" yang
REM   dipicu flag di atas. Aman di kiosk localhost-only. Upgrade bersih (tanpa flag
REM   testing sama sekali): reg policy VideoCaptureAllowedUrls → http://localhost:3000.
set "KDATA=%LOCALAPPDATA%\SemetaKioskChrome"
set "BFLAGS=--start-fullscreen --kiosk-printing --use-fake-ui-for-media-stream --test-type --user-data-dir="%KDATA%" --no-first-run --no-default-browser-check --disable-features=Translate,InfobarUIForBubble --disable-session-crashed-bubble --disable-infobars --overscroll-history-navigation=0 --autoplay-policy=no-user-gesture-required"
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "BROWSER=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "BROWSER=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "BROWSER=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "BROWSER=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
if defined BROWSER (
  start "" "%BROWSER%" %BFLAGS% http://localhost:3000
  echo [OK] Browser opened fullscreen + silent print
) else (
  start "" http://localhost:3000
  echo [!] Chrome/Edge ga ada - buka default browser ^(print dialog mungkin muncul^)
)

echo.
echo   Kiosk  : http://localhost:3000
echo   PB     : http://localhost:8090/_/
echo   Tutup  : kill.bat
echo.
pause
