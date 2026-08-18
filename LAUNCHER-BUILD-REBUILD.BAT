@echo off
setlocal enabledelayedexpansion
title SEMETA KIOSK - Rebuild & Launch Production
cd /d "%~dp0"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo ============================================================
echo  SEMETA KIOSK - REBUILD PRODUCTION BUILD
echo ============================================================
echo.
echo [1/2] Memastikan proses lama dimatikan...
call "%ROOT%\kill.bat" >nul 2>&1
timeout /t 1 /nobreak >nul

echo [2/2] Memulai build ulang (Next.js) dan menyalakan Kiosk...
echo.
call "%ROOT%\LAUNCHER-BUILD.BAT" --rebuild %*
