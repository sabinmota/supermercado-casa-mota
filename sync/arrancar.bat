@echo off
title Sync Panel — Casa Mota
color 0A
cls

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║   🛒  Sync Panel — Supermercado Casa Mota    ║
echo  ╚══════════════════════════════════════════════╝
echo.
echo  Verificando Python...

python --version >nul 2>&1
if errorlevel 1 (
    color 0C
    echo.
    echo  ❌ Python no encontrado.
    echo     Descarga Python en: https://www.python.org/downloads/
    echo     Marca "Add Python to PATH" durante la instalacion.
    echo.
    pause
    exit /b 1
)

echo  Verificando dependencias...
pip show flask >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Instalando dependencias ^(solo la primera vez^)...
    pip install flask flask-cors pyodbc requests
    echo.
)

echo  Iniciando servidor local...
echo.
echo  ┌─────────────────────────────────────────────┐
echo  │  Abre tu navegador en:                      │
echo  │  👉  http://localhost:5000                   │
echo  │                                             │
echo  │  Sincroniza precios y stock, y ademas       │
echo  │  respalda dbSIC y exporta para ChatGPT      │
echo  │                                             │
echo  │  Cierra esta ventana para detener           │
echo  └─────────────────────────────────────────────┘
echo.

cd /d "%~dp0"
start "" http://localhost:5000
python servidor_local.py

pause
