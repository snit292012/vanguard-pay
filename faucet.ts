import {
    Connection,
    PublicKey,
    LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import https from "https";

const WALLET_ADDRESS = "6NSrFp3WUAz6LST4QDgr7KG9hChmtT8xpwrnHWNmdcrs";
const DEVNET_RPC = "https://api.devnet.solana.com";

// ────────────────────────────────────────────────────────────
// Helper: check balance via web3.js
// ────────────────────────────────────────────────────────────
async function getBalance(pubkey: PublicKey): Promise<number> {
    const conn = new Connection(DEVNET_RPC, "confirmed");
    return conn.getBalance(pubkey);
}

// ────────────────────────────────────────────────────────────
// Strategy 1: Standard requestAirdrop via web3.js
// ────────────────────────────────────────────────────────────
async function tryWeb3Airdrop(pubkey: PublicKey): Promise<boolean> {
    console.log("\n🔵 Strategy 1 — web3.js requestAirdrop (api.devnet.solana.com)");
    try {
        const conn = new Connection(DEVNET_RPC, "confirmed");
        const sig = await conn.requestAirdrop(pubkey, LAMPORTS_PER_SOL);
        console.log(`   ✅ Sig: ${sig}`);
        for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 3000));
            const status = await conn.getSignatureStatus(sig);
            const conf = status?.value?.confirmationStatus;
            console.log(`   ⏳ ${conf ?? "pending"}`);
            if (conf === "confirmed" || conf === "finalized") return true;
        }
    } catch (e: any) {
        console.log(`   ❌ ${e.message}`);
    }
    return false;
}

// ────────────────────────────────────────────────────────────
// Strategy 2: Helius Devnet Faucet REST API
// ────────────────────────────────────────────────────────────
function heliusAirdrop(address: string): Promise<boolean> {
    console.log("\n🟡 Strategy 2 — Helius Devnet Faucet API");
    return new Promise((resolve) => {
        const body = JSON.stringify({ address, amount: 1000000000 }); // 1 SOL in lamports
        const opts = {
            hostname: "faucet.helius-rpc.com",
            path: "/",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
                "User-Agent": "VanguardPay/1.0",
            },
        };
        const req = https.request(opts, (res) => {
            let data = "";
            res.on("data", (d) => (data += d));
            res.on("end", () => {
                console.log(`   HTTP ${res.statusCode}: ${data}`);
                resolve(res.statusCode === 200);
            });
        });
        req.on("error", (e) => {
            console.log(`   ❌ ${e.message}`);
            resolve(false);
        });
        req.write(body);
        req.end();
    });
}

// ────────────────────────────────────────────────────────────
// Strategy 3: QuickNode Faucet API
// ────────────────────────────────────────────────────────────
function quicknodeFaucet(address: string): Promise<boolean> {
    console.log("\n🟠 Strategy 3 — QuickNode Faucet API");
    return new Promise((resolve) => {
        const body = JSON.stringify({ address });
        const opts = {
            hostname: "faucet.quicknode.com",
            path: "/solana/devnet",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
            },
        };
        const req = https.request(opts, (res) => {
            let data = "";
            res.on("data", (d) => (data += d));
            res.on("end", () => {
                console.log(`   HTTP ${res.statusCode}: ${data}`);
                resolve(res.statusCode === 200 || res.statusCode === 201);
            });
        });
        req.on("error", (e) => {
            console.log(`   ❌ ${e.message}`);
            resolve(false);
        });
        req.write(body);
        req.end();
    });
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────
async function main() {
    const pubkey = new PublicKey(WALLET_ADDRESS);
    console.log("🚀 Vanguard Pay — Devnet Faucet Runner");
    console.log(`🔑 Wallet : ${pubkey.toBase58()}`);

    const before = await getBalance(pubkey);
    console.log(`💰 Balance before: ${before / LAMPORTS_PER_SOL} SOL`);

    let funded = false;

    // Try all strategies in order
    funded = await tryWeb3Airdrop(pubkey);
    if (!funded) funded = await heliusAirdrop(WALLET_ADDRESS);
    if (!funded) funded = await quicknodeFaucet(WALLET_ADDRESS);

    // Final balance check regardless
    await new Promise((r) => setTimeout(r, 3000));
    const after = await getBalance(pubkey);
    console.log(`\n💰 Balance after : ${after / LAMPORTS_PER_SOL} SOL`);

    if (after > before) {
        console.log(`\n🎉 SUCCESS! Wallet funded. Received ${(after - before) / LAMPORTS_PER_SOL} SOL.`);
    } else {
        console.log("\n⚠️  Balance unchanged. Devnet faucets are rate-limited globally right now.");
        console.log("👉 Manual options:");
        console.log("   • https://solfaucet.com");
        console.log("   • https://faucet.triangleplatform.com/solana/devnet");
        console.log(`   • solana airdrop 1 ${WALLET_ADDRESS} --url devnet (with Solana CLI)`);
        console.log(`   • solana airdrop 2 ${WALLET_ADDRESS} --url https://api.devnet.solana.com`);
    }
}

main().catch(console.error);
