/**
 * Client configuration module.
 * Reads server-injected config from window.__config and exports constants.
 */

import type { ChainDefinition } from "./types.js";

// Read server-injected config
const config = window.__config;

/** Default token addresses per chain, injected by server */
export const DEFAULT_TOKENS: Record<string, { from: string; to: string }> = config.defaultTokens;

/** WalletConnect project ID for WalletConnect integration */
export const WALLETCONNECT_PROJECT_ID: string = config.walletConnectProjectId;

// Chain ID constants
export const ETHEREUM_CHAIN_ID = 1;
export const BSC_CHAIN_ID = 56;
export const BASE_CHAIN_ID = 8453;
export const ARBITRUM_CHAIN_ID = 42161;
export const OPTIMISM_CHAIN_ID = 10;
export const POLYGON_CHAIN_ID = 137;
export const AVALANCHE_CHAIN_ID = 43114;

/** All supported chains for the chain selector dropdown */
export const ALL_CHAINS: ChainDefinition[] = [
  { id: "1", name: "Ethereum" },
  { id: "8453", name: "Base" },
  { id: "42161", name: "Arbitrum" },
  { id: "10", name: "Optimism" },
  { id: "137", name: "Polygon" },
  { id: "56", name: "BSC" },
  { id: "43114", name: "Avalanche" },
];

/** Chains where Curve Finance is supported */
export const CURVE_SUPPORTED_CHAINS: number[] = [1, 8453, 42161, 10, 137, 56, 43114];

/** Chain ID to hex string mapping for wallet chain switching */
export const CHAIN_ID_HEX_MAP: Readonly<Record<string, string>> = Object.freeze({
  "1": "0x1",
  "10": "0xa",
  "56": "0x38",
  "137": "0x89",
  "8453": "0x2105",
  "42161": "0xa4b1",
  "43114": "0xa86a",
});

/** Human-readable chain names by chain ID */
export const CHAIN_NAMES: Readonly<Record<string, string>> = Object.freeze({
  "1": "Ethereum",
  "10": "Optimism",
  "56": "BSC",
  "137": "Polygon",
  "8453": "Base",
  "42161": "Arbitrum",
  "43114": "Avalanche",
});

/** Auto-refresh interval in seconds */
export const AUTO_REFRESH_SECONDS = 15;

/** Default tokenlist display name */
export const DEFAULT_TOKENLIST_NAME = "Default Tokenlist";

/** Local tokens source display name */
export const LOCAL_TOKENS_SOURCE_NAME = "Local Tokens";

/** MEV protection RPC URLs */
export const FLASHBOTS_RPC_URL = "https://rpc.flashbots.net";
export const BLOXROUTE_BSC_RPC_URL = "https://bsc.rpc.blxrbdn.com";

/** Max uint256 hex value (used for unlimited token approvals) */
export const MAX_UINT256_HEX = "f".repeat(64);

/** localStorage keys used throughout the application */
export const STORAGE_KEYS = {
  customTokenlists: "customTokenlists",
  oldCustomTokenlistUrl: "customTokenlistUrl",
  localTokenList: "localTokenList",
  localTokensEnabled: "localTokensEnabled",
  defaultTokenlistEnabled: "defaultTokenlistEnabled",
  preferences: "compare-dex-preferences",
  oldPreferences: "flashprofits-preferences",
  theme: "compare-dex-theme",
} as const;
