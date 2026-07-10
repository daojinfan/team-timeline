@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js 22.5 or newer.
  echo Download: https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please check your Node.js installation.
  pause
  exit /b 1
)

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo Service already appears to be running.
  echo URL: http://localhost:3000
  start "" "http://localhost:3000"
  pause
  exit /b 0
)

echo Starting team task manager service...
echo URL: http://localhost:3000
echo.

start "" "http://localhost:3000"
npm start

echo.
echo Service stopped.
pause
