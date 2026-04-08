@echo off
setlocal
title VOICEVOX OpenAI Bridge - Setup
echo ===================================================
echo VOICEVOX OpenAI Bridge - Automated Setup
echo ===================================================
echo.

echo Checking for Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] Node.js is not installed. Attempting to install via winget...
    winget install OpenJS.NodeJS -e --accept-package-agreements --accept-source-agreements
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install Node.js automatically.
        echo Please install it manually from https://nodejs.org/
        pause
        exit /b 1
    )
    echo [OK] Node.js installed.
    echo IMPORTANT: You may need to close and reopen this window for 'node' to be recognized.
) else (
    echo [OK] Node.js is already installed.
)

echo.
echo Checking for VOICEVOX...
set VV_PATH=%LOCALAPPDATA%\Programs\VOICEVOX\vv-engine\run.exe
if not exist "%VV_PATH%" (
    echo [WARN] VOICEVOX Engine not found at default location.
    echo Attempting to install via winget...
    winget install HiroshibaKazuyuki.VOICEVOX -e --silent --accept-package-agreements --accept-source-agreements
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install VOICEVOX automatically.
        echo Please install it manually from https://voicevox.hiroshiba.jp/
        pause
        exit /b 1
    )
    echo [OK] VOICEVOX installed.
) else (
    echo [OK] VOICEVOX is already installed.
)

echo.
echo ===================================================
echo Setup Complete!
echo You can now use 'start-voicevox-bridge.bat'
echo ===================================================
pause
