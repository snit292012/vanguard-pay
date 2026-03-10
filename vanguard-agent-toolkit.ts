import { Action, ActionExample, HandlerCallback, IAgentRuntime, Memory, State } from "@elizaos/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { atomicVaultPayment } from "./agent";

// VANGUARD PROTOCOL : ELIZA OS SKILL
// This drops directly into any Eliza/Solana Agent Kit.
// When an agent needs to pay for data or execute a high-risk swap, it uses this action.

export const vanguardPayAction: Action = {
    name: "VANGUARD_SECURE_PAY",
    similes: ["SAFE_PAY", "ESCROW_PAY", "TWE_SWAP", "SECURE_TRANSFER"],
    description: "Executes a mathematically secure Solana payment through a Trust-Weighted Escrow (TWE) Vault. Reverts automatically if the counterparty data hash is invalid.",
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        // Validate that the agent has a Solana wallet configured
        return !!runtime.getSetting("SOLANA_PRIVATE_KEY");
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: any,
        callback?: HandlerCallback
    ) => {
        try {
            const privateKeyStr = runtime.getSetting("SOLANA_PRIVATE_KEY") as string;
            const rpcUrl = runtime.getSetting("RPC_URL") || "https://api.mainnet-beta.solana.com";
            const conn = new Connection(rpcUrl);

            // In a real Eliza skill, these would be extracted from the LLM's parsed arguments
            const targetUrl = options.targetUrl || "https://api.target-oracle.com/data";
            const budgetSol = options.amountSol || 0.05;
            const sellerAddress = options.sellerAddress || "vines1vzrY7MDu3NFWSZ2kft1D3T8iHnt2xG2ySpxiL";

            // Execute the Vanguard TWE-Vault Protocol natively within the Agent's runtime
            callback?.({ text: `🛡️ Initiating Vanguard TWE-Vault for ${budgetSol} SOL to ${sellerAddress}...` });

            // Note: This calls the internal agent.ts logic we already hardened
            const result = await atomicVaultPayment(conn, targetUrl, budgetSol, sellerAddress);

            if (result.success) {
                callback?.({ text: `✅ Vanguard Settlement Complete. Hash Verified. Protocol Fee Extracted.\nSignature: ${result.txSignature}` });
                return true;
            } else if (result.reverted) {
                callback?.({ text: `🚨 Vanguard Revert Triggered. Counterparty failed validation. 100% of capital protected.` });
                return false;
            } else {
                callback?.({ text: `❌ Vanguard Execution Failed. Ensure sufficient liquidity.` });
                return false;
            }

        } catch (error: any) {
            callback?.({ text: `Vanguard Protocol error: ${error.message}` });
            return false;
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: "Pay 0.1 SOL to get the latest Pyth oracle data, but make sure it's safely escrowed." },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "I'll route this through the Vanguard TWE-Vault to ensure we aren't scammed.",
                    action: "VANGUARD_SECURE_PAY",
                },
            },
        ],
    ] as ActionExample[][],
};
