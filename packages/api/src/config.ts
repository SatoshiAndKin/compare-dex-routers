import {
  createConfig,
  defaultProviders,
  fabric,
  zeroX,
  kyberswap,
  odos,
  lifi,
  relay,
  velora,
  type Config,
} from "@spandex/core";
import { createPublicClient, http, type PublicClient, getAddress } from "viem";
const APP_ID = process.env.APP_ID || "compare-dex-routers";

export const SUPPORTED_CHAINS: Record<number, { name: string; alchemySubdomain: string }> = {
  1: { name: "Ethereum", alchemySubdomain: "eth-mainnet" },
  8453: { name: "Base", alchemySubdomain: "base-mainnet" },
  42161: { name: "Arbitrum", alchemySubdomain: "arb-mainnet" },
  10: { name: "Optimism", alchemySubdomain: "opt-mainnet" },
  137: { name: "Polygon", alchemySubdomain: "polygon-mainnet" },
  56: { name: "BSC", alchemySubdomain: "bnb-mainnet" },
  43114: { name: "Avalanche", alchemySubdomain: "avax-mainnet" },
};

export const DEFAULT_TOKENS: Record<number, { from: string; to: string }> = {
  1: {
    from: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    to: "0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E", // crvUSD
  },
  8453: {
    from: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    to: "0x4200000000000000000000000000000000000006",
  },
  42161: {
    from: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    to: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  },
  10: {
    from: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    to: "0x4200000000000000000000000000000000000006",
  },
  137: {
    from: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    to: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
  },
  56: {
    from: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // USDC
    to: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  },
  43114: {
    from: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    to: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
  },
};

const erc20Abi = [
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

function buildProviders() {
  const zeroXApiKey = process.env.ZEROX_API_KEY;
  const fabricApiKey = process.env.FABRIC_API_KEY;

  if (zeroXApiKey || fabricApiKey) {
    const providers = [];
    providers.push(fabric({ appId: APP_ID, apiKey: fabricApiKey }));
    if (zeroXApiKey) providers.push(zeroX({ apiKey: zeroXApiKey }));
    providers.push(kyberswap({ clientId: APP_ID }));
    providers.push(odos({}));
    providers.push(lifi({}));
    providers.push(relay({}));
    providers.push(velora({}));
    return providers;
  }

  return defaultProviders({ appId: APP_ID });
}

const clientCache = new Map<number, PublicClient>();

function assertSupportedChain(chainId: number): { name: string; alchemySubdomain: string } {
  const chain = SUPPORTED_CHAINS[chainId];
  if (!chain) {
    throw new Error(
      `Unsupported chain: ${chainId}. Supported: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`
    );
  }
  return chain;
}

export function getClient(chainId: number): PublicClient {
  const cached = clientCache.get(chainId);
  if (cached) return cached;

  assertSupportedChain(chainId);
  const rpcUrl = getRpcUrl(chainId);

  const client = createPublicClient({
    transport: http(rpcUrl),
  });

  clientCache.set(chainId, client as PublicClient);
  return client as PublicClient;
}

export function getRpcUrl(chainId: number): string {
  const chain = assertSupportedChain(chainId);
  return (
    process.env[`RPC_URL_${chainId}`] ||
    `https://${chain.alchemySubdomain}.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
  );
}

export function getSpandexConfig(): Config {
  return createConfig({
    providers: buildProviders(),
    clients: (chainId: number) => getClient(chainId),
    options: {
      deadlineMs: 5_000,
    },
  });
}

const decimalsCache = new Map<string, number>();
const symbolCache = new Map<string, string>();

export async function getTokenDecimals(chainId: number, address: string): Promise<number> {
  const key = `${chainId}:${address.toLowerCase()}`;
  const cached = decimalsCache.get(key);
  if (cached !== undefined) return cached;

  const client = getClient(chainId);
  // Normalize address to checksummed format for viem
  const normalizedAddress = getAddress(address);
  const decimals = await client.readContract({
    address: normalizedAddress,
    abi: erc20Abi,
    functionName: "decimals",
  });

  decimalsCache.set(key, decimals);
  return decimals;
}

export async function getTokenSymbol(chainId: number, address: string): Promise<string> {
  const key = `${chainId}:${address.toLowerCase()}`;
  const cached = symbolCache.get(key);
  if (cached !== undefined) return cached;

  const client = getClient(chainId);
  try {
    // Normalize address to checksummed format for viem
    const normalizedAddress = getAddress(address);
    const symbol = await client.readContract({
      address: normalizedAddress,
      abi: erc20Abi,
      functionName: "symbol",
    });
    symbolCache.set(key, symbol);
    return symbol;
  } catch {
    symbolCache.set(key, "");
    return "";
  }
}

const nameCache = new Map<string, string>();

export async function getTokenName(chainId: number, address: string): Promise<string> {
  const key = `${chainId}:${address.toLowerCase()}`;
  const cached = nameCache.get(key);
  if (cached !== undefined) return cached;

  const client = getClient(chainId);
  try {
    // Normalize address to checksummed format for viem
    const normalizedAddress = getAddress(address);
    const name = await client.readContract({
      address: normalizedAddress,
      abi: erc20Abi,
      functionName: "name",
    });
    nameCache.set(key, name);
    return name;
  } catch {
    nameCache.set(key, "");
    return "";
  }
}
