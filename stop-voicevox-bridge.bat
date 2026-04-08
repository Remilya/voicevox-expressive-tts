@echo off
setlocal
title VOICEVOX OpenAI Bridge - Stop

echo ===================================================
echo Stopping VOICEVOX Bridge and Engine
echo ===================================================
echo.

echo Stopping Bridge (Node.js process)...
wmic process where "name='node.exe' and CommandLine like '%%voicevox-openai-bridge%%'" call terminate >nul 2>&1

echo Stopping VOICEVOX Engine (run.exe / rr-engine.exe)...
wmic process where "name='run.exe' and ExecutablePath like '%%VOICEVOX%%'" call terminate >nul 2>&1
wmic process where "name='vv-engine.exe'" call terminate >nul 2>&1
taskkill /IM VOICEVOX.exe /F >nul 2>&1

echo.
echo ===================================================
echo All related processes have been cleanly terminated.
echo ===================================================
pause
