import { spawn } from "child_process";

console.log("🚀 VANGUARD TWE CONNECTOR");
console.log("Streaming real-time agent execution logs to telemetry.json...\n");

function loop() {
    console.log(`\n[${new Date().toISOString()}] Initiating TWE active mainnet cycle...`);

    // Spawn agent.ts locally. Since agent.ts uses telemetry.record(), 
    // it inherently writes the required logs into ./dashboard/src/telemetry.json
    const proc = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "agent.ts"], {
        stdio: "inherit",
        env: process.env,
        shell: true
    });

    proc.on("close", (code) => {
        console.log(`⭕ Agent cycle finished (Code: ${code}). Streaming next cycle in 6s...`);
        setTimeout(loop, 6000); // 6 second throttle to prevent rate limits
    });

    proc.on("error", (err) => {
        console.error("Connector Error: ", err);
    });
}

// Start the autonomous streaming loop
loop();
