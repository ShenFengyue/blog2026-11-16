@echo off
chcp 65001 >nul
cd /d "%~dp0"
set OPEN_BROWSER=1
node scripts\build.mjs
node scripts\serve.mjs
pause
