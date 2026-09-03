@echo off
title SEMETA KIOSK - Auto Setup Printer 2-Strip
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [i] Meminta Hak Akses Administrator untuk setting printer...
    powershell -Command "Start-Process cmd.exe -ArgumentList '/k \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_printer.ps1"


