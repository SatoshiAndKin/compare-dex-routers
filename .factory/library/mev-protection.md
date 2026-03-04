# MEV Protection

Chain-specific MEV protection research and recommended RPCs.

---

## Chain-Specific Guidance

| Chain | chainId | Needs Protection | Free RPC | RPC URL | Recommendation |
|-------|---------|------------------|----------|---------|----------------|
| Ethereum | 1 | Yes | Yes | `https://rpc.flashbots.net` | Add Flashbots Protect |
| BSC | 56 | Yes | Yes | `https://bsc.rpc.blxrbdn.com` | Add bloXroute BSC Protect |
| Polygon | 137 | Yes | No | — | No free option available |
| Base | 8453 | Minimal | No | — | Sequencer provides FCFS ordering |
| Arbitrum | 42161 | Minimal | No | — | Sequencer + Timeboost protects |
| Optimism | 10 | Minimal | No | — | Sequencer provides FCFS ordering |
| Avalanche | 43114 | Minimal | No | — | Fast finality reduces risk |

## wallet_addEthereumChain Params

**Ethereum - Flashbots Protect:**
```json
{
  "chainId": "0x1",
  "chainName": "Ethereum (Flashbots Protect)",
  "rpcUrls": ["https://rpc.flashbots.net"],
  "nativeCurrency": { "name": "Ether", "symbol": "ETH", "decimals": 18 },
  "blockExplorerUrls": ["https://etherscan.io"]
}
```

**BSC - bloXroute Protect:**
```json
{
  "chainId": "0x38",
  "chainName": "BSC (bloXroute Protect)",
  "rpcUrls": ["https://bsc.rpc.blxrbdn.com"],
  "nativeCurrency": { "name": "BNB", "symbol": "BNB", "decimals": 18 },
  "blockExplorerUrls": ["https://bscscan.com"]
}
```

## Modal Text Guidance

**What is MEV?** MEV (Maximal Extractable Value) means bots can see your pending swap and front-run it, sandwiching your trade to profit at your expense. A protected RPC sends your transaction directly to block builders, bypassing the public mempool.

**Ethereum:** Your swap is vulnerable to sandwich attacks. Add Flashbots Protect to send transactions privately.

**BSC:** BSC has active MEV bots. Add bloXroute BSC Protect for private transaction submission.

**L2 chains (Base, Arbitrum, Optimism):** These chains use a centralized sequencer that processes transactions in order received (FCFS). Sandwich attacks are significantly harder. No additional protection needed.

**Polygon, Avalanche:** MEV protection is useful but no free public RPC is available for these chains.
