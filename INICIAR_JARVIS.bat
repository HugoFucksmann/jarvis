@echo off
title J.A.R.V.I.S.
color 0B
echo ========================================================
echo   INICIANDO J.A.R.V.I.S. NATIVO (PROTOCOLO LOCAL)
echo ========================================================
echo.

cd /d "e:\colo\rocco"

:: 1. Verificar si Ollama esta corriendo
curl -s http://127.0.0.1:11434/api/tags >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Iniciando servicio Ollama en segundo plano...
    start /b ollama serve
    ping 127.0.0.1 -n 3 >nul
)

:: 2. Verificar si el servidor JARVIS esta activo
curl -s http://127.0.0.1:3000/api/status >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Iniciando nucleo del agente...
    start /b npm run dev
    ping 127.0.0.1 -n 4 >nul
)

:: 3. Lanzar la aplicacion 100% NATIVA en Electron
echo [*] Abriendo ventana nativa de JARVIS...
start "" "e:\colo\rocco\node_modules\electron\dist\electron.exe" "e:\colo\rocco\src\desktop\main.cjs"

echo [OK] JARVIS nativo iniciado.
exit /b 0
