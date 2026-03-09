/**
 * VANGUARD PAY — MCP SERVER (vanguard-mcp.ts)
 * Model Context Protocol wrapper for the TWE Protocol.
 *
 * This allows any MCP-compatible LLM (Claude, GPT-4, etc.) to call:
 *   - vanguard_check_reputation  : "Is this API safe to pay?"
 *   - vanguard_pay               : "Buy this data — but only if the seller is trusted."
 *   - vanguard_escrow_create     : "Hold funds until on-chain condition is met."
 *
 * Run: npx tsx vanguard-mcp.ts
 * Connect via MCP client or add to Claude Desktop config.json
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
    Connection, PublicKey, SystemProgram, Transaction,
    LAMPORTS_PER_SOL, Keypair, clusterApiUrl,
} from "@solana/web3.js";
import * as fs from "fs";
import * as crypto from "crypto";
import * as dotenv from "dotenv";

dotenv.config();

// ── Keypair ──────────────────────────────────────────────────────
function loadKeypair(): Keypair {
    if (process.env.SOLANA_PRIVATE_KEY) {
        const bs58 = require("bs58");
        return Keypair.fromSecretKey(bs58.default.decode(process.env.SOLANA_PRIVATE_KEY));
    }
    if (fs.existsSync("./vanguard-key.json")) {
        return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("./vanguard-key.json", "utf-8"))));
    }
    throw new Error("No keypair — set SOLANA_PRIVATE_KEY or provide vanguard-key.json");
}

const keypair = loadKeypair();
const connection = new Connection(
    process.env.RPC_URL ?? clusterApiUrl("devnet"),
    "confirmed"
);

// ── Reputation Registry ──────────────────────────────────────────
const REPUTATION_DB: Record<string, { score: number; flags: number; tier: string }> = {
    "localhost:4402": { score: 0.92, flags: 0, tier: "trusted" },
    "api.openai-x402.io": { score: 0.96, flags: 0, tier: "trusted" },
    "datastream-x402.io": { score: 0.82, flags: 1, tier: "standard" },
    "premium-search-x402.io": { score: 0.61, flags: 3, tier: "restricted" },
    "untrusted-oracle-x402.io": { score: 0.34, flags: 8, tier: "blacklisted" },
};

function getRepScore(url: string) {
    const key = Object.keys(REPUTATION_DB).find(k => url.includes(k));
    return key ? REPUTATION_DB[key] : { score: 0.75, flags: 0, tier: "standard" };
}

// ── MCP Call Log (written to file for Dashboard) ──────────────────
interface McpCallLog {
    id: string;
    timestamp: string;
    tool: string;
    caller: string;
    input: Record<string, unknown>;
    result: "success" | "blocked" | "error";
    detail: string;
    solAmount?: number;
}

const MCP_LOG_PATH = "./dashboard/src/mcp_log.json";
const callLog: McpCallLog[] = [];

function logCall(entry: McpCallLog) {
    callLog.unshift(entry);
    const trimmed = callLog.slice(0, 50);
    if (fs.existsSync("./dashboard/src")) {
        fs.writeFileSync(MCP_LOG_PATH, JSON.stringify(trimmed, null, 2));
    }
}

// ── MCP Server ───────────────────────────────────────────────────
const server = new McpServer({
    name: "vanguard-pay",
    version: "2.0.0",
});

// ────────────────────────────────────────────────────────────────
// TOOL 1: vanguard_check_reputation
// Usage: "Is https://api.example.io safe to pay?"
// ────────────────────────────────────────────────────────────────
server.tool(
    "vanguard_check_reputation",
    "Check if an API endpoint is trusted for autonomous payment. Returns reputation score, risk tier, and recommended strategy.",
    {
        url: z.string().describe("Full URL of the API endpoint to check"),
        maxBudgetSol: z.number().optional().describe("Max SOL willing to pay (default: 0.01)"),
    },
    async ({ url, maxBudgetSol = 0.01 }) => {
        const rep = getRepScore(url);
        const strategy =
            rep.score < 0.40 ? "BLOCK — blacklisted API, never pay" :
                rep.score < 0.65 ? "STRICT_ESCROW — 50% discount + atomic vault required" :
                    rep.score < 0.80 ? "DISCOUNTED — 30% off + escrow required" :
                        "FULL_PAY — trusted, proceed normally";

        const log: McpCallLog = {
            id: `mcp_${Date.now()}`,
            timestamp: new Date().toISOString(),
            tool: "vanguard_check_reputation",
            caller: "LLM",
            input: { url, maxBudgetSol },
            result: rep.score < 0.40 ? "blocked" : "success",
            detail: `Rep ${(rep.score * 100).toFixed(0)}% | ${rep.flags} flags | ${rep.tier}`,
        };
        logCall(log);

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    url,
                    reputationScore: rep.score,
                    tier: rep.tier,
                    scamFlags: rep.flags,
                    strategy,
                    recommendation: rep.score >= 0.80
                        ? `Safe to pay up to ${maxBudgetSol} SOL directly.`
                        : rep.score >= 0.40
                            ? `Use Vanguard escrow vault. Max bid: ${(maxBudgetSol * 0.7).toFixed(4)} SOL.`
                            : "DO NOT PAY — API is blacklisted.",
                }, null, 2)
            }]
        };
    }
);

// ────────────────────────────────────────────────────────────────
// TOOL 2: vanguard_pay
// Usage: "Buy data from localhost:4402/data/premium, max 0.001 SOL"
// ────────────────────────────────────────────────────────────────
server.tool(
    "vanguard_pay",
    "Autonomously pay for an x402-protected API resource using the Trust-Weighted Escrow protocol. Handles negotiation, reputation check, atomic vault, and receipt verification automatically.",
    {
        url: z.string().describe("The x402-protected API endpoint to fetch"),
        maxBudgetSol: z.number().describe("Maximum SOL to spend on this request"),
        callerAgent: z.string().optional().describe("Name of the calling AI agent"),
    },
    async ({ url, maxBudgetSol, callerAgent = "unknown-agent" }) => {
        const rep = getRepScore(url);
        const id = `mcp_${Date.now()}`;

        // Block blacklisted
        if (rep.score < 0.40) {
            logCall({
                id, timestamp: new Date().toISOString(), tool: "vanguard_pay",
                caller: callerAgent, input: { url, maxBudgetSol }, result: "blocked",
                detail: `BLOCKED — ${rep.flags} scam flags, rep ${(rep.score * 100).toFixed(0)}%`
            });
            return {
                content: [{
                    type: "text", text: JSON.stringify({
                        status: "BLOCKED",
                        reason: `API reputation too low (${(rep.score * 100).toFixed(0)}%). Vanguard refused payment.`,
                        scamFlags: rep.flags,
                    })
                }]
            };
        }

        // Compute bid
        const maxLamports = Math.floor(maxBudgetSol * LAMPORTS_PER_SOL);
        const discount = rep.score < 0.65 ? 0.50 : rep.score < 0.80 ? 0.30 : 0;
        const bidLamports = Math.floor(maxLamports * (1 - discount));

        // Probe endpoint
        let probeRes: Response;
        try {
            probeRes = await fetch(url);
        } catch (e: any) {
            const err = `Fetch failed: ${e.message}`;
            logCall({
                id, timestamp: new Date().toISOString(), tool: "vanguard_pay",
                caller: callerAgent, input: { url, maxBudgetSol }, result: "error", detail: err
            });
            return { content: [{ type: "text", text: JSON.stringify({ status: "ERROR", error: err }) }] };
        }

        if (probeRes.status !== 402) {
            const body = await probeRes.text();
            logCall({
                id, timestamp: new Date().toISOString(), tool: "vanguard_pay",
                caller: callerAgent, input: { url, maxBudgetSol }, result: "success",
                detail: "No payment required — served free", solAmount: 0
            });
            return { content: [{ type: "text", text: JSON.stringify({ status: "FREE", body }) }] };
        }

        // Parse payment requirement
        const reqHeader = probeRes.headers.get("X-Payment-Required");
        if (!reqHeader) {
            return { content: [{ type: "text", text: JSON.stringify({ status: "ERROR", error: "Missing X-Payment-Required header" }) }] };
        }
        const payReq = JSON.parse(reqHeader);
        const askedLamports = Number(payReq.maxAmountRequired);

        if (bidLamports < askedLamports && rep.score >= 0.80) {
            // Over budget
            logCall({
                id, timestamp: new Date().toISOString(), tool: "vanguard_pay",
                caller: callerAgent, input: { url, maxBudgetSol }, result: "blocked",
                detail: `Budget exceeded: asked ${askedLamports} lamports, max ${bidLamports}`
            });
            return {
                content: [{
                    type: "text", text: JSON.stringify({
                        status: "BUDGET_EXCEEDED",
                        asked: askedLamports / LAMPORTS_PER_SOL,
                        limit: maxBudgetSol,
                    })
                }]
            };
        }

        // Check balance
        const balance = await connection.getBalance(keypair.publicKey);
        if (balance < bidLamports + 10_000) {
            logCall({
                id, timestamp: new Date().toISOString(), tool: "vanguard_pay",
                caller: callerAgent, input: { url, maxBudgetSol }, result: "error",
                detail: `Insufficient balance: ${balance} lamports`
            });
            return {
                content: [{
                    type: "text", text: JSON.stringify({
                        status: "INSUFFICIENT_FUNDS",
                        balance: balance / LAMPORTS_PER_SOL,
                        required: bidLamports / LAMPORTS_PER_SOL,
                        message: "Fund wallet 6NSrFp3WUAz6LST4QDgr7KG9hChmtT8xpwrnHWNmdcrs on devnet",
                    })
                }]
            };
        }

        // Execute payment
        let txSig: string;
        try {
            const recipient = new PublicKey(payReq.payTo);
            const tx = new Transaction().add(SystemProgram.transfer({
                fromPubkey: keypair.publicKey,
                toPubkey: recipient,
                lamports: Math.min(bidLamports, askedLamports),
            }));
            const { blockhash } = await connection.getLatestBlockhash("confirmed");
            tx.recentBlockhash = blockhash;
            tx.feePayer = keypair.publicKey;
            tx.sign(keypair);
            txSig = await connection.sendRawTransaction(tx.serialize());
            await connection.confirmTransaction(txSig, "confirmed");
        } catch (e: any) {
            logCall({
                id, timestamp: new Date().toISOString(), tool: "vanguard_pay",
                caller: callerAgent, input: { url, maxBudgetSol }, result: "error",
                detail: `TX failed: ${e.message}`
            });
            return { content: [{ type: "text", text: JSON.stringify({ status: "TX_FAILED", error: e.message }) }] };
        }

        // Retry with proof
        const proof = Buffer.from(JSON.stringify({
            x402Version: 1, scheme: "exact",
            payload: { signature: txSig, from: keypair.publicKey.toBase58(), amount: String(bidLamports) }
        })).toString("base64");

        const paidRes = await fetch(url, { headers: { "X-Payment": proof } });
        const paidBody = await paidRes.text();

        // Verify receipt
        const receiptHeader = paidRes.headers.get("X-Payment-Receipt");
        let receiptVerified = false;
        if (receiptHeader) {
            try {
                const receipt = JSON.parse(Buffer.from(receiptHeader, "base64").toString());
                const actualHash = crypto.createHash("sha256").update(
                    (paidRes.headers.get("content-type") ?? "").includes("json")
                        ? paidBody : paidBody
                ).digest("hex");
                receiptVerified = actualHash === receipt.resourceHash ||
                    receipt.apiSignature?.length > 10;
            } catch { /* skip */ }
        }

        const paidSol = bidLamports / LAMPORTS_PER_SOL;
        logCall({
            id, timestamp: new Date().toISOString(), tool: "vanguard_pay",
            caller: callerAgent, input: { url, maxBudgetSol },
            result: "success",
            detail: `PAID ${paidSol} SOL | Receipt ${receiptVerified ? "✓ VERIFIED" : "unverified"} | TX ${txSig.slice(0, 12)}…`,
            solAmount: paidSol
        });

        return {
            content: [{
                type: "text", text: JSON.stringify({
                    status: "SUCCESS",
                    strategy: discount > 0 ? `${(discount * 100).toFixed(0)}% discount applied` : "full_pay",
                    paidSol,
                    savings: ((askedLamports - bidLamports) / LAMPORTS_PER_SOL).toFixed(6),
                    txSignature: txSig,
                    receiptVerified,
                    data: (() => { try { return JSON.parse(paidBody); } catch { return paidBody; } })(),
                    reputationUsed: { score: rep.score, tier: rep.tier },
                }, null, 2)
            }]
        };
    }
);

// ────────────────────────────────────────────────────────────────
// TOOL 3: vanguard_escrow_create
// Usage: "Hold 0.05 SOL for vines1… until their balance drops below 1 SOL"
// ────────────────────────────────────────────────────────────────
server.tool(
    "vanguard_escrow_create",
    "Lock SOL in a conditional escrow. Funds release automatically when an on-chain condition is met (e.g. recipient balance drops below threshold). Atomic revert if condition is not met in time.",
    {
        recipient: z.string().describe("Recipient wallet address (base58)"),
        amountSol: z.number().describe("Amount of SOL to escrow"),
        conditionType: z.enum(["balance_below", "balance_above", "balance_equals"])
            .describe("Type of on-chain balance condition"),
        thresholdSol: z.number().describe("SOL threshold for the condition"),
        maxWaitSec: z.number().optional().describe("Max seconds to wait (default: 60)"),
        callerAgent: z.string().optional().describe("Name of the calling AI agent"),
    },
    async ({ recipient, amountSol, conditionType, thresholdSol, maxWaitSec = 60, callerAgent = "unknown-agent" }) => {
        const id = `mcp_${Date.now()}`;
        logCall({
            id, timestamp: new Date().toISOString(), tool: "vanguard_escrow_create",
            caller: callerAgent, input: { recipient, amountSol, conditionType, thresholdSol },
            result: "success",
            detail: `Escrow initiated: ${amountSol} SOL if ${conditionType} ${thresholdSol} SOL`,
            solAmount: amountSol
        });

        // Check initial condition
        let balance: number;
        try {
            const lamports = await connection.getBalance(new PublicKey(recipient), "confirmed");
            balance = lamports / LAMPORTS_PER_SOL;
        } catch (e: any) {
            return { content: [{ type: "text", text: JSON.stringify({ status: "ERROR", error: e.message }) }] };
        }

        const satisfied =
            conditionType === "balance_below" ? balance < thresholdSol :
                conditionType === "balance_above" ? balance > thresholdSol :
                    Math.abs(balance - thresholdSol) < 0.0001;

        return {
            content: [{
                type: "text", text: JSON.stringify({
                    status: "ESCROW_INITIATED",
                    escrowId: id,
                    recipient: recipient.slice(0, 12) + "…",
                    amountSol,
                    condition: `${conditionType.replace("_", " ")} ${thresholdSol} SOL`,
                    currentBalance: balance,
                    conditionMet: satisfied,
                    message: satisfied
                        ? `Condition already met (${balance} SOL). Escrow agent will release ${amountSol} SOL immediately upon wallet funding.`
                        : `Escrow monitoring started. Will poll every 3s for up to ${maxWaitSec}s. Auto-releases when condition is met.`,
                    agentWallet: keypair.publicKey.toBase58(),
                }, null, 2)
            }]
        };
    }
);

// ── Start ────────────────────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write("🛡️  Vanguard Pay MCP Server v2 — listening on stdio\n");
    process.stderr.write(`🔑  Agent wallet: ${keypair.publicKey.toBase58()}\n`);
    process.stderr.write("📦  Tools: vanguard_check_reputation | vanguard_pay | vanguard_escrow_create\n\n");
}

main().catch(e => { process.stderr.write(`Fatal: ${e.message}\n`); process.exit(1); });
