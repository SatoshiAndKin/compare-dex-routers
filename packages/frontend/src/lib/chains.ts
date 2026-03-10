/**
 * Static chain definitions and default token pairs.
 * Mirrors packages/api/src/config.ts — update both when adding chains.
 */

export interface ChainDefinition {
  id: number;
  name: string;
}

export interface DefaultTokenPair {
  from: string;
  to: string;
}

export const SUPPORTED_CHAINS: ChainDefinition[] = [
  { id: 1, name: "Ethereum" },
  { id: 8453, name: "Base" },
  { id: 42161, name: "Arbitrum" },
  { id: 10, name: "Optimism" },
  { id: 137, name: "Polygon" },
  { id: 56, name: "BSC" },
  { id: 43114, name: "Avalanche" },
];

export const CHAIN_NAMES: Record<string, string> = Object.fromEntries(
  SUPPORTED_CHAINS.map((c) => [String(c.id), c.name])
);

export const DEFAULT_TOKENS: Record<number, DefaultTokenPair> = {
  1: {
    from: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
    to: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
  },
  8453: {
    from: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
    to: "0x4200000000000000000000000000000000000006", // WETH
  },
  42161: {
    from: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC
    to: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH
  },
  10: {
    from: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", // USDC
    to: "0x4200000000000000000000000000000000000006", // WETH
  },
  137: {
    from: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", // USDC
    to: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", // WETH
  },
  56: {
    from: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // USDC
    to: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB
  },
  43114: {
    from: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", // USDC
    to: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", // WAVAX
  },
};
