/**
 * VANGUARD PAY — GHOST API (mock-seller.ts)
 * A real HTTP 402 server. Proves the x402 handshake is live.
 *
 * Run: npx tsx mock-seller.ts
 * Endpoints:
 *   GET /data/premium  → 402 (unauthenticated)
 *   GET /data/premium  + X-Payment header → 200 + signed receipt
 */
import express from "express";
import crypto from "crypto";

const app = express();
const PORT = 4402; // x402
const PRICE_LAMPORTS = 1000; // 0.000001 SOL — dust-cheap for demo
const WALLET = "6NSrFp3WUAz6LST4QDgr7KG9hChmtT8xpwrnHWNmdcrs";
const RESOURCE_DATA = JSON.stringify({
    model: "ghost-oracle-v1", inference: "The agent economy is real.",
    tokens: 42, timestamp: new Date().toISOString(),
});

app.use((req, _res, next) => {
    console.log(`[Ghost API] ${req.method} ${req.path} ${req.headers["x-payment"] ? "✓ PAYMENT HEADER" : "— no payment"}`);
    next();
});

// Premium endpoint
app.get("/data/premium", (req, res) => {
    const payment = req.headers["x-payment"] as string | undefined;

    if (!payment) {
        // Return 402 with X-Payment-Required (x402 spec)
        const requirement = {
            scheme: "exact",
            network: "solana-devnet",
            maxAmountRequired: String(PRICE_LAMPORTS),
            resource: `http://localhost:${PORT}/data/premium`,
            description: "Ghost Oracle inference — 0.000001 SOL",
            payTo: WALLET,
            maxTimeoutSeconds: 30,
            asset: "native",
        };
        res.status(402)
            .header("X-Payment-Required", JSON.stringify(requirement))
            .json({ error: "Payment Required", requirement });
        return;
    }

    // Validate payment proof (production: verify TX on-chain)
    let proof: Record<string, unknown> = {};
    try { proof = JSON.parse(Buffer.from(payment, "base64").toString("utf-8")); }
    catch { /* accept any payment header for demo */ }

    // Generate signed receipt (SHA-256 of response body)
    const hash = crypto.createHash("sha256").update(RESOURCE_DATA).digest("hex");
    const receipt = {
        resourceHash: hash,
        txSignature: (proof?.payload as any)?.signature ?? "GHOST_SIM_SIG",
        apiSignature: crypto.createHash("sha256").update(hash + WALLET).digest("hex"),
        timestamp: new Date().toISOString(),
        resourceUrl: `http://localhost:${PORT}/data/premium`,
    };

    console.log(`[Ghost API] ✅ Payment accepted — serving data`);
    res.status(200)
        .header("X-Payment-Receipt", Buffer.from(JSON.stringify(receipt)).toString("base64"))
        .json({ success: true, data: JSON.parse(RESOURCE_DATA), receipt: { hash } });
});

// Health
app.get("/health", (_req, res) => res.json({ status: "ghost-online", priceSOL: PRICE_LAMPORTS / 1e9 }));

app.listen(PORT, () => {
    console.log(`\n👻 GHOST API online → http://localhost:${PORT}`);
    console.log(`   Premium endpoint : http://localhost:${PORT}/data/premium`);
    console.log(`   Price            : ${PRICE_LAMPORTS} lamports (${PRICE_LAMPORTS / 1e9} SOL)`);
    console.log(`   Wallet           : ${WALLET}\n`);
});
