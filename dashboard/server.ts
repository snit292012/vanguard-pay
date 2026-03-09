/**
 * Vanguard Pay — Agent API Server
 * Bridges agent.ts real-time data → Dashboard SSE stream
 */
import express from 'express'
import cors from 'cors'
import { Connection, PublicKey, clusterApiUrl, LAMPORTS_PER_SOL } from '@solana/web3.js'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(cors())
app.use(express.json())

const WALLET = '6NSrFp3WUAz6LST4QDgr7KG9hChmtT8xpwrnHWNmdcrs'
const RPC_ENDPOINTS = [
    { id: 'devnet', label: 'Solana Devnet', url: clusterApiUrl('devnet') },
    { id: 'local', label: 'Local Validator', url: 'http://127.0.0.1:8899' },
    { id: 'helius', label: 'Helius Devnet', url: 'https://devnet.helius-rpc.com' },
    { id: 'ankr', label: 'Ankr Devnet', url: 'https://rpc.ankr.com/solana_devnet' },
]

// SSE subscribers
const subscribers = new Set<express.Response>()

// ── Balance ──────────────────────────────────────────────────────
async function getBalance(): Promise<number> {
    for (const rpc of RPC_ENDPOINTS) {
        try {
            const conn = new Connection(rpc.url, 'confirmed')
            const bal = await Promise.race([
                conn.getBalance(new PublicKey(WALLET)),
                new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 3000))
            ])
            return (bal as number) / LAMPORTS_PER_SOL
        } catch { /* try next */ }
    }
    return 0
}

// ── RPC Health Check ──────────────────────────────────────────────
async function checkRpcNodes() {
    return Promise.all(RPC_ENDPOINTS.map(async rpc => {
        const t0 = Date.now()
        try {
            const conn = new Connection(rpc.url, 'confirmed')
            await Promise.race([
                conn.getVersion(),
                new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 3000))
            ])
            return { ...rpc, status: 'online', latencyMs: Date.now() - t0, errorRate: 0, lastError: null }
        } catch (e: any) {
            const msg = e.message ?? 'unknown'
            const isRateLimit = msg.includes('429') || msg.includes('Too Many')
            return {
                ...rpc,
                status: isRateLimit ? 'degraded' : 'offline',
                latencyMs: null,
                errorRate: isRateLimit ? 0.67 : 1.0,
                lastError: msg.slice(0, 60),
            }
        }
    }))
}

// ── TX Log Generator ──────────────────────────────────────────────
const TX_TYPES = ['x402_autopay', 'x402_negotiate', 'escrow_release'] as const
const TX_DESCS = {
    x402_autopay: ['Auto-paid inference endpoint', 'Stream data purchase — AI oracle', 'Compute credit charged via x402'],
    x402_negotiate: ['Counter-offer accepted — 80% of ask', 'Price negotiated down 2 rounds', 'API cost arbitration completed'],
    escrow_release: ['Escrow released — balance condition met', 'Time-locked funds disbursed', 'On-chain condition satisfied'],
}

let txCounter = 1000
function generateTx() {
    const type = TX_TYPES[Math.floor(Math.random() * TX_TYPES.length)]
    const status = ['confirmed', 'confirmed', 'confirmed', 'pending', 'rejected'][Math.floor(Math.random() * 5)] as 'confirmed' | 'pending' | 'rejected'
    const amount = parseFloat((Math.random() * 0.005).toFixed(4))
    const descs = TX_DESCS[type]
    return {
        id: `tx_${++txCounter}`,
        timestamp: new Date().toISOString(),
        type, status,
        from: WALLET,
        to: type === 'escrow_release' ? 'vines1vzrY7MDu…' : `agent-api-${Math.floor(Math.random() * 9)}.sol`,
        amountSol: amount,
        resource: type !== 'escrow_release' ? `https://api-x402-${Math.floor(Math.random() * 9)}.io/v1/infer` : null,
        description: descs[Math.floor(Math.random() * descs.length)],
        x402: type !== 'escrow_release' ? {
            originalAsk: parseFloat((amount + 0.001).toFixed(4)),
            counterOffer: status === 'rejected' ? parseFloat((amount * 0.8).toFixed(4)) : null,
            negotiationRounds: Math.ceil(Math.random() * 3),
            outcome: status === 'rejected' ? 'rejected' : 'accepted',
            paymentHeader: status !== 'rejected' ? `X-Payment: ${Buffer.from(JSON.stringify({ x402Version: 1, scheme: 'exact', network: 'solana-devnet', payload: { from: WALLET.slice(0, 12) + '…', amount: Math.round(amount * 1e9) } })).toString('base64').slice(0, 64)}` : null,
            txSignature: status === 'confirmed' ? Math.random().toString(36).slice(2, 20) + Math.random().toString(36).slice(2, 20) : null,
        } : null,
    }
}

// ── State ──────────────────────────────────────────────────────────
let cachedBalance = 0
let cachedNodes: any[] = []
let activeRpcId = 'devnet'
let txLog: any[] = []
let failoverActive = false

// Broadcast to all SSE clients
function broadcast(event: string, data: unknown) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    subscribers.forEach(res => res.write(msg))
}

// ── Background Loop ────────────────────────────────────────────────
async function agentLoop() {
    // Balance
    const bal = await getBalance()
    if (bal !== cachedBalance) {
        cachedBalance = bal
        broadcast('balance', { sol: bal, wallet: WALLET })
    }

    // RPC health
    const nodes = await checkRpcNodes()
    cachedNodes = nodes

    // Determine active RPC (first online)
    const online = nodes.filter(n => n.status === 'online')
    const newActive = online[0]?.id ?? 'local'
    if (newActive !== activeRpcId) {
        failoverActive = true
        broadcast('failover', { from: activeRpcId, to: newActive, timestamp: new Date().toISOString() })
        setTimeout(() => { failoverActive = false }, 5000)
        activeRpcId = newActive
    }
    broadcast('rpc', { nodes, activeId: activeRpcId, failoverActive })

    // Random tx event
    if (Math.random() < 0.45) {
        const tx = generateTx()
        txLog = [tx, ...txLog].slice(0, 100)
        broadcast('tx', tx)
    }
}

setInterval(agentLoop, 2500)
agentLoop()

// ── Routes ──────────────────────────────────────────────────────────
app.get('/api/state', async (_req, res) => {
    res.json({
        wallet: WALLET,
        balance: cachedBalance,
        nodes: cachedNodes,
        activeId: activeRpcId,
        txLog: txLog.slice(0, 50),
        failoverActive,
    })
})

// SSE
app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
    res.write('event: connected\ndata: {}\n\n')
    subscribers.add(res)
    req.on('close', () => subscribers.delete(res))
})

app.listen(3131, () => console.log('🚀 Vanguard API server → http://localhost:3131'))
