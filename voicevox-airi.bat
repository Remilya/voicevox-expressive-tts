@echo off
setlocal

set "SCRIPT=%~dp0voicevox-airi.ps1"

if not exist "%SCRIPT%" (
  echo voicevox-airi.ps1 was not found:
  echo %SCRIPT%
  pause
  exit /b 1
)

if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" start
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
)
