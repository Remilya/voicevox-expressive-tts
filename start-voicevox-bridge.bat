@echo off
setlocal
title VOICEVOX OpenAI Bridge

echo ===================================================
echo VOICEVOX OpenAI Bridge
echo ===================================================
echo.
echo Starting bridge server...
echo Endpoint: http://127.0.0.1:55221/v1/audio/speech
echo VOICEVOX engine will automatically start when the first request arrives.
echo.
echo Leave this window open while using TTS. Close it to stop the bridge.
echo ===================================================
echo.

:: Change to the directory of this batch script so paths resolve correctly
cd /d "%~dp0"

node tools\voicevox-openai-bridge.mjs
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] The bridge stopped unexpectedly.
    echo Is Node.js installed? Run setup-voicevox-bridge.bat to check.
    pause
)
