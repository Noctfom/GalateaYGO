@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.18 or later first.
  pause
  exit /b 1
)
if not exist "node_modules\astro\astro.js" (
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Open http://127.0.0.1:4321/zh/ in your browser.
call npm run dev -- --port 4321
pause
