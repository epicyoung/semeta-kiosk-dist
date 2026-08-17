@echo off
setlocal
cd /d "%~dp0"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

powershell -NoProfile -Command "$e=[char]27;$p=$e+'[38;2;255;64;153m';$r=$e+'[0m';$d=$e+'[90m';cls;Write-Host '';Write-Host ($p+'###### #####  ####  #####  ##  ##  #####  ##   ## ##   ##  #####'+$r);Write-Host ($p+'##     ##  ##  ##  ##     ##  ## ##   ## ##   ## ###  ## ##    '+$r);Write-Host ($p+'####   #####   ##  ##     #####  ##   ## ##   ## ## # ## ## ###'+$r);Write-Host ($p+'##     ##      ##  ##      ##    ##   ## ##   ## ##  ### ##   ##'+$r);Write-Host ($p+'###### ##     ####  #####   ##    #####   #####  ##   ##  #####'+$r);Write-Host '';Write-Host ($d+'  Starting Semeta by Spindonesia x Epicyoung AI Pro Booth (DEV MODE)...'+$r);Write-Host ''"

REM PocketBase
if exist "%ROOT%\pb\pocketbase.exe" (
  start /min "PocketBase" cmd /k ""%ROOT%\pb\pocketbase.exe" serve --dir "%ROOT%\pb\pb_data""
  echo [OK] PocketBase — port 8090
  echo      Admin: http://localhost:8090/_/
) else (
  echo [--] PocketBase skip — jalanin setup.bat dulu
)

REM Face server
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

REM ComfyUI — TIDAK auto-start lagi. Toggle "Fullbody Engine" di kiosk Settings yang
REM nyalain/matiin (POST /comfy/start|stop ke face_server).
echo [--] ComfyUI — nyalain manual via Settings > Fullbody Engine kalau jual paket Fullbody

REM Kiosk UI (Dev Mode: npm run dev)
start /min "Kiosk" cmd /k "cd /d "%ROOT%\kiosk" && npm run dev"
echo [OK] Kiosk (Dev Mode) — port 3000

REM Tunggu Next.js ready baru buka browser
timeout /t 5 /nobreak >nul
set "BROWSER="
set "KDATA=%LOCALAPPDATA%\SemetaKioskChrome"
set "BFLAGS=--start-fullscreen --use-fake-ui-for-media-stream --test-type --user-data-dir="%KDATA%" --no-first-run --no-default-browser-check --disable-features=Translate,InfobarUIForBubble --disable-session-crashed-bubble --disable-infobars --overscroll-history-navigation=0 --autoplay-policy=no-user-gesture-required"
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "BROWSER=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "BROWSER=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "BROWSER=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "BROWSER=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
if defined BROWSER (
  start "" "%BROWSER%" %BFLAGS% http://localhost:3000
  echo [OK] Browser fullscreen + silent print
) else (
  start "" http://localhost:3000
  echo [--] Chrome/Edge ga ada — buka default browser
)

echo.
echo   Kiosk (DEV): http://localhost:3000
echo   PB         : http://localhost:8090/_/
echo   Tutup      : kill.bat
echo.
pause
