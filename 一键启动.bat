@echo off
setlocal
cd /d "%~dp0"
title One-Click Launcher - enterprise-knowledge-qa-wenda

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found. Please install Node.js first.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [Setup] node_modules not found, installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Dependency install failed. Check network and try again.
    pause
    exit /b 1
  )
)

echo Starting: npm run dev
call npm run dev

echo.
echo [INFO] Program exited.
pause
