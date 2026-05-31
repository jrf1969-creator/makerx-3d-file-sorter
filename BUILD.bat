@echo off
echo ============================================
echo  MakerX 3D Viewer - Build Script
echo ============================================
echo.

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js not found.
    echo Please install Node.js from https://nodejs.org
    echo Download the LTS version, run the installer, then re-run this script.
    pause
    exit /b 1
)

echo Node.js found:
node --version
echo.

echo [1/3] Installing dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)

echo.
echo [2/3] Building Windows installer...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Build failed.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  SUCCESS! Installer is in the dist\ folder.
echo  File: dist\MakerX 3D Viewer Setup 1.0.0.exe
echo ============================================
echo.
pause
