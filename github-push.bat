@echo off
setlocal
title GitHub Repo Push

echo =========================================
echo Pushing to GitHub...
echo =========================================

:: Fix directory ownership issue automatically
git config --global --add safe.directory "%CD%"
git config --global user.name "Kuroneko"
git config --global user.email "bot@example.com"

:: Initialize and Add
git init
git add .
git commit -m "✨ feat: Add Remilya authorship, MIT License, available-voices list & reorganize directory structure for cleaner root"
git branch -M main

:: Remote and Push
git remote set-url origin https://github.com/Remilya/voicevox-expressive-tts.git >nul 2>&1
if %errorlevel% neq 0 (
    git remote add origin https://github.com/Remilya/voicevox-expressive-tts.git
)

echo.
echo Waiting for GitHub Authentication...
echo Pushing...
git push -u origin main

echo.
echo =========================================
echo Done!
echo =========================================
pause
