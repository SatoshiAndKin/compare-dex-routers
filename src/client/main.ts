declare global {
  interface Window {
    __config: {
      defaultTokens: Record<string, { from: string; to: string }>;
      walletConnectProjectId: string;
    };
  }
}

import "./types.js";
import { DEFAULT_TOKENS, WALLETCONNECT_PROJECT_ID } from "./config.js";

console.log(
  "[client] bundle loaded, chains configured",
  Object.keys(DEFAULT_TOKENS).length,
  "chains,",
  WALLETCONNECT_PROJECT_ID ? "WC enabled" : "WC disabled"
);
export {};
