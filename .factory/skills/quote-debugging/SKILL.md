# Quote Debugging Skill

## Description
Helps debug failed or incorrect swap quotes by tracing the request through provider layers.

## When to Use
- A quote request returns an unexpected output amount
- A quote request fails with a provider error
- Comparing outputs across different providers

## Steps
1. Check the request parameters (chainId, from, to, amount, slippageBps, sender)
2. Verify token addresses are valid for the specified chain
3. Check if the token pair has liquidity on the specified chain
4. Test the quote with a known-good sender address (whale fallback)
5. Compare router outputs (Spandex vs Curve) for the same pair using `/compare`
6. Check gas estimation and ensure the router has sufficient allowance

## Key Files
- `packages/api/src/server.ts` - Request handling and quote orchestration
- `packages/api/src/config.ts` - Chain config and token metadata
- `packages/api/src/quote.ts` - Parameter validation
- `packages/api/src/curve.ts` - Curve-specific quote logic
