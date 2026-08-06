@echo off
REM ============================================================================
REM   restart.bat — dipanggil tombol "Restart Booth" di Settings (via /api/restart).
REM ============================================================================
REM   Endpoint spawn ini DETACHED, lalu langsung balas ke browser. Jeda 2 detik
REM   di bawah = kasih waktu response nyampe + operator liat toast, BARU kill.
REM   (kill.bat matiin chrome+node yang lagi nampilin Settings ini sendiri).
REM   Abis mati total, LAUNCHER-BUILD.BAT nyalain ulang semua service.
REM
REM   Jalan dari root repo (parent of kiosk/). %~dp0 = folder script ini.
REM ============================================================================
cd /d "%~dp0"

REM Jeda biar HTTP response + toast "Restarting..." kekirim dulu.
timeout /t 2 /nobreak >nul

REM Matiin semua (chrome, node:3000, PB, face_server, comfy).
call "%~dp0kill.bat"

REM Jeda pendek biar port bener-bener lepas sebelum LAUNCHER re-bind.
timeout /t 2 /nobreak >nul

REM Nyalain ulang. .next udah ada → skip build (restart CEPAT, bukan --rebuild).
start "" "%~dp0LAUNCHER-BUILD.BAT"
