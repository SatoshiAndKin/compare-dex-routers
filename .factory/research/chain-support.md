# Chain Support Research

## Current: 7 chains
Ethereum (1), Base (8453), Arbitrum (42161), Optimism (10), Polygon (137), BSC (56), Avalanche (43114)

## Chains to Add

### Tier 1 — Both Curve + Spandex coverage, Alchemy RPC
| Chain ID | Name | Alchemy Subdomain | Curve Router | Spandex Providers |
|----------|------|-------------------|-------------|-------------------|
| 100 | Gnosis | gnosis-mainnet | Yes | KyberSwap, Odos |
| 250 | Fantom | fantom-mainnet | Yes | 0x, KyberSwap, Odos |

### Tier 2 — Curve + some Spandex, Alchemy RPC
| Chain ID | Name | Alchemy Subdomain | Curve Router | Spandex Providers |
|----------|------|-------------------|-------------|-------------------|
| 5000 | Mantle | mantle-mainnet | Yes | 0x, KyberSwap, Odos |
| 324 | zkSync Era | zksync-mainnet | Yes | KyberSwap, Odos, Relay |
| 252 | Fraxtal | frax-mainnet | Yes | Limited |

### Tier 3 — Spandex only, Alchemy RPC
| Chain ID | Name | Alchemy Subdomain | Spandex Providers |
|----------|------|-------------------|-------------------|
| 59144 | Linea | linea-mainnet | 0x, KyberSwap, Odos |
| 534352 | Scroll | scroll-mainnet | 0x, KyberSwap, Odos |
| 81457 | Blast | blast-mainnet | 0x, Relay |

### Skip (no Alchemy RPC, would need custom RPC)
- Kava (2222), X Layer (196), Moonriver (1285), Cronos (25)

## Implementation Notes
1. Add to `SUPPORTED_CHAINS` in `src/config.ts`
2. Add to `CURVE_SUPPORTED_CHAINS` in `src/curve.ts` for chains with Curve routers
3. Add `DEFAULT_TOKENS` entries (USDC variant → native token)
4. Spandex needs no changes (accepts any chainId)
5. Tokenlist needs updating for new chains
