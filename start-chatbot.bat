@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 18 or newer, then try again.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js 18 or newer, then try again.
  pause
  exit /b 1
)
start "Toshu Chatbot Server" /min cmd /c "npm start"
powershell -NoProfile -Command "$url = 'http://127.0.0.1:3000/api/status'; for ($i = 0; $i -lt 30; $i++) { try { $null = Invoke-RestMethod -Uri $url -TimeoutSec 1; Start-Process 'http://127.0.0.1:3000'; exit 0 } catch { Start-Sleep -Seconds 1 } }; Write-Error 'Toshu did not start. Check the server window for errors.'; exit 1"
if errorlevel 1 pause
