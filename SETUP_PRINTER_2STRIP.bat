@echo off
title SEMETA KIOSK - Auto Setup Printer 2-Strip
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [i] Meminta Izin Administrator...
    powershell -Command "Start-Process cmd.exe -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_printer.ps1"

