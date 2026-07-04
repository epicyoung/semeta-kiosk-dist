@echo off
echo Stopping Semeta services...

REM Kill by window title
taskkill /F /FI "WINDOWTITLE eq Kiosk*"      >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq FaceServer*"  >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq PocketBase*"  >nul 2>&1

REM Kill by process name (sadis mode)
taskkill /F /IM pocketbase.exe  >nul 2>&1
taskkill /F /IM python.exe      >nul 2>&1
taskkill /F /IM python3.exe     >nul 2>&1
taskkill /F /IM pythonw.exe     >nul 2>&1
taskkill /F /IM uvicorn.exe     >nul 2>&1

REM Kill Chrome kiosk — WAJIB. Flag command-line (--kiosk-printing, --start-fullscreen,
REM izin kamera) CUMA kebaca kalau chrome.exe bener-bener MATI TOTAL pas LAUNCHER jalan.
REM Chrome yang masih nyangkut = LAUNCHER cuma buka tab baru, SEMUA flag ke-drop diam-diam
REM (gejala: dialog print ga muncul / kamera gantung / ga fullscreen). taskkill semua chrome.
taskkill /F /IM chrome.exe      >nul 2>&1

REM Kill node on port 3000
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
REM Kill anything on port 8000
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
REM Kill anything on port 8090
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8090 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1

echo Done. All ports 3000 / 8000 / 8090 cleared.
