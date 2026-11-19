@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js 18 or newer is required.
    echo Install it from https://nodejs.org/
    pause
    exit /b 1
)

if not exist ".env" (
    if not exist ".env.example" (
        echo ERROR: .env.example file is missing.
        pause
        exit /b 1
    )

    copy ".env.example" ".env" >nul
    echo Configure your Gemini API key in .env.
    notepad ".env"
)

echo Starting AirLab AI...
node server.js

pause