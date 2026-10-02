@echo off
chcp 65001 >nul
title Elkhalily Scraper
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo Python is not installed.
    echo Opening the download page - install it and TICK "Add Python to PATH", then double-click this file again.
    start https://www.python.org/downloads/
    pause
    exit /b
)

echo Installing required packages...
python -m pip install --quiet requests beautifulsoup4 lxml

echo.
echo Collecting all products. This can take 20-40 minutes, please keep this window open...
echo.
python scrape_elkhalily.py

echo.
echo Finished. Opening the results folder...
start "" "%~dp0"
pause
