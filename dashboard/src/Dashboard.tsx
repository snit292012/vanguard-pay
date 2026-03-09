import { useState, useEffect } from 'react'
import './Theme.css'

interface AuditEvent {
    id: string;
    timestamp: string;
    type: string;
    agentId: string;
    payloadHash: string;
    status: 'VERIFIED' | 'REVERTED' | 'PENDING';
}

function useAgentStream() {
    const [events, setEvents] = useState<AuditEvent[]>([])
    const [mainnetSig, setMainnetSig] = useState<string | null>(null)
    const [throughput, setThroughput] = useState(14829)

    // Math Overlay variables
    const [rep, setRep] = useState(0.85)
    const [basePrice, setBasePrice] = useState(0.005)

    useEffect(() => {
        // Poll for mainnet proof
        const iv1 = setInterval(async () => {
            try {
                const res = await fetch(`/src/mainnet_sig.json?v=${Date.now()}`)
                if (res.ok) {
                    const data = await res.json()
                    if (data.signature) setMainnetSig(data.signature)
                }
            } catch { /* ignore */ }
        }, 2000)

        // Simulate live agent activity
        const iv2 = setInterval(() => {
            setThroughput(t => t + Math.floor(Math.random() * 3))

            // Randomize variables for the Math overlay
            const newRep = (Math.random() * 0.6 + 0.4).toFixed(2)
            const newPrice = (Math.random() * 0.01 + 0.001).toFixed(4)
            setRep(parseFloat(newRep))
            setBasePrice(parseFloat(newPrice))

            // Add an audit trail event
            if (Math.random() < 0.6) {
                const isVerified = Math.random() > 0.3
                const agents = ['claude-3-opus', 'gpt-4o', 'gemini-1.5', 'llama-3']
                const ev: AuditEvent = {
                    id: Math.random().toString(36).slice(2, 8),
                    timestamp: new Date().toISOString().split('T')[1].replace('Z', ''),
                    type: isVerified ? 'x402_SETTLEMENT' : 'ATOMIC_REVERT',
                    agentId: agents[Math.floor(Math.random() * agents.length)],
                    payloadHash: `0x${Math.random().toString(16).slice(2, 10)}...${Math.random().toString(16).slice(2, 6)}`,
                    status: isVerified ? 'VERIFIED' : 'REVERTED'
                }
                setEvents(prev => [ev, ...prev].slice(0, 15))
            }

        }, 1500)

        return () => { clearInterval(iv1); clearInterval(iv2) }
    }, [])

    return { events, mainnetSig, throughput, rep, basePrice }
}

export default function Dashboard() {
    const { events, mainnetSig, throughput, rep, basePrice } = useAgentStream()

    const finalPrice = (basePrice * (1 - (rep * 0.5))).toFixed(5)

    return (
        <>
            <header className="cmd-bar">
                <div className="cmd-left">
                    <div className="cmd-logo">VANGUARD</div>
                    <div className="cmd-version">v1.2.0-STABLE</div>
                </div>
                <div className="cmd-center">
                    <span>PROTOCOL THROUGHPUT:</span>
                    <span className="cmd-throughput">{throughput.toLocaleString()} TXs</span>
                </div>
                <div className="cmd-right">
                    <div className={`mainnet-pill ${mainnetSig ? 'active' : ''}`}>
                        MAINNET STATUS {mainnetSig ? '●' : '○'}
                    </div>
                </div>
            </header>

            <div className="dashboard-grid">

                {/* AUDIT TRAIL */}
                <div className="panel" style={{ gridRow: 'span 2' }}>
                    <div className="panel-header">AUDIT TRAIL (TWE LOG)</div>
                    <div className="panel-content" style={{ padding: 0 }}>
                        <table className="audit-table">
                            <thead>
                                <tr>
                                    <th>TIMESTAMP</th>
                                    <th>EVENT_TYPE</th>
                                    <th>AGENT_ID</th>
                                    <th>PAYLOAD_HASH</th>
                                    <th>STATUS</th>
                                </tr>
                            </thead>
                            <tbody>
                                {events.map((ev, i) => (
                                    <tr key={i}>
                                        <td className="text-muted">{ev.timestamp}</td>
                                        <td>{ev.type}</td>
                                        <td>{ev.agentId}</td>
                                        <td className="text-muted">{ev.payloadHash}</td>
                                        <td>
                                            <span className={`status-tag status-${ev.status.toLowerCase()}`}>
                                                [{ev.status}]
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* ESCROW MONITOR / MATH OVERLAY */}
                <div className="panel">
                    <div className="panel-header">ESCROW MONITOR / MATHEMATICAL OVERLAY</div>
                    <div className="panel-content math-container">
                        <div className="math-formula">
                            <span className="text-muted">P_f</span> = <span className="text-muted">P_b</span> &middot; (1 - (<span className="text-muted">R</span> &middot; 0.5))
                        </div>
                        <div className="math-vars">
                            <div className="math-var-box">
                                <div className="var-label">R (REPUTATION)</div>
                                <div className="var-val text-gold">{rep.toFixed(2)}</div>
                            </div>
                            <div className="math-var-box">
                                <div className="var-label">P_b (BASE_ASK)</div>
                                <div className="var-val text-muted">{basePrice.toFixed(4)} SOL</div>
                            </div>
                            <div className="math-var-box">
                                <div className="var-label">P_f (FINAL_BID)</div>
                                <div className="var-val text-emerald">{finalPrice} SOL</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* MCP PIPELINE */}
                <div className="panel">
                    <div className="panel-header">MCP PIPELINE (PEER-TO-PEER HANDSHAKE)</div>
                    <div className="panel-content mcp-visual">
                        <div className="mcp-row">
                            <div className="mcp-node">claude-3-opus</div>
                            <div className="mcp-line"></div>
                            <div className="mcp-node text-gold">TWE-Vault_A</div>
                            <div className="mcp-line"></div>
                            <div className="mcp-node text-muted">Oracle_Node</div>
                        </div>
                        <div className="mcp-row">
                            <div className="mcp-node">gpt-4o</div>
                            <div className="mcp-line"></div>
                            <div className="mcp-node text-gold">TWE-Vault_B</div>
                            <div className="mcp-line"></div>
                            <div className="mcp-node text-muted">Compute_Cluster</div>
                        </div>
                        <div className="mcp-row">
                            <div className="mcp-node">gemini-1.5</div>
                            <div className="mcp-line"></div>
                            <div className="mcp-node text-gold">TWE-Vault_C</div>
                            <div className="mcp-line"></div>
                            <div className="mcp-node text-muted">Data_API</div>
                        </div>
                    </div>
                </div>

            </div>
        </>
    )
}
