@echo off
cd /d "%~dp0"
node manage-templates.js %*
pause
