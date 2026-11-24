@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required to launch Golden Hour Riding from source.
  echo Download it from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  call npm install
)

if not exist "dist\index.html" (
  call npm run build
)

start "" /b "%~dp0node_modules\.bin\electron.cmd" .
