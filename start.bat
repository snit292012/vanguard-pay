@echo off
title Vanguard Pay Evaluation Engine
color 0A

echo.
echo =====================================================================
echo                VANGUARD PAY : THE SOVEREIGN NODE
echo       Trust-Weighted Escrow (TWE) Protocol  ---  Colosseum 2026
echo =====================================================================
echo.
echo Initializing zero-UI evaluation environment...
echo.

if not exist "node_modules\" (
    echo [0/4] Installing dependencies silently...
    call npm install >nul 2>&1
)

if not exist "dashboard\node_modules\" (
    echo [0/4] Installing dashboard dependencies silently...
    cd dashboard
    call npm install >nul 2>&1
    cd ..
)

echo [1/3] Activating Hyperscreen Dashboard (React Terminal)...
start "Vanguard Dashboard" cmd /c "cd dashboard && npm run dev"

timeout /t 2 >nul

echo [2/3] Engaging Autonomous TWE Loop (connector.ts)...
start "Vanguard Execution Engine" cmd /c "npx tsx connector.ts"

timeout /t 2 >nul

echo [3/3] Initiating Simulated TWE Execution (agent.ts)...
start "Vanguard Agent Simulation" cmd /k "npx tsx agent.ts --sim"

echo.
echo =====================================================================
echo [+] ALL SYSTEMS ONLINE
echo [+] The Vanguard Dashboard will open in your default browser shortly.
echo [+] If it does not, manually navigate to: http://localhost:5173
echo =====================================================================
pause
