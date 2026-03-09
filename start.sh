#!/bin/bash
# Vanguard Pay Evaluation Engine
# ---------------------------------------------------------
echo -e "\n====================================================================="
echo -e "               VANGUARD PAY : THE SOVEREIGN NODE"
echo -e "      Trust-Weighted Escrow (TWE) Protocol  ---  Colosseum 2026"
echo -e "=====================================================================\n"

echo "Initializing zero-UI evaluation environment..."

if [ ! -d "node_modules" ]; then
    echo "[0/4] Installing dependencies silently..."
    npm install > /dev/null 2>&1
fi

if [ ! -d "dashboard/node_modules" ]; then
    echo "[0/4] Installing dashboard dependencies silently..."
    cd dashboard
    npm install > /dev/null 2>&1
    cd ..
fi

echo "[1/3] Activating Hyperscreen Dashboard (React Terminal)..."
cd dashboard && npm run dev &
PID_WEB=$!
cd ..
sleep 2

echo "[2/3] Engaging Autonomous TWE Loop (connector.ts)..."
npx tsx connector.ts &
PID_CONN=$!

echo "[3/3] Initiating Simulated TWE Execution (agent.ts)..."
npx tsx agent.ts --sim &
PID_AGENT=$!

echo -e "\n====================================================================="
echo "[+] ALL SYSTEMS ONLINE"
echo "[+] Navigate to: http://localhost:5173"
echo "====================================================================="
echo "[Press CTRL+C to terminate all processes]"

wait ${PID_WEB} ${PID_CONN} ${PID_AGENT}
