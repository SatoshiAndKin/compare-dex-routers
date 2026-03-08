import { SUPPORTED_CHAINS } from "./config.js";

export type QuoteMode = "exactIn" | "targetOut";

export interface QuoteParams {
  chainId: number;
  from: string;
  to: string;
  amount: string;
  slippageBps: number;
  sender?: string;
  mode: QuoteMode;
}

export type ParseResult = { success: true; data: QuoteParams } | { success: false; error: string };

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function isValidAddress(address: string): boolean {
  return ADDRESS_REGEX.test(address);
}

export function parseQuoteParams(searchParams: URLSearchParams): ParseResult {
  const chainIdStr = searchParams.get("chainId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const amount = searchParams.get("amount");
  const slippageBpsStr = searchParams.get("slippageBps") ?? "50";
  const sender = searchParams.get("sender") || undefined;
  const modeStr = searchParams.get("mode") || "exactIn";

  if (!chainIdStr) {
    return { success: false, error: "Missing required param: chainId" };
  }

  const chainId = parseInt(chainIdStr, 10);
  if (isNaN(chainId) || chainId <= 0) {
    return { success: false, error: `Invalid chainId: ${chainIdStr}` };
  }

  if (!(chainId in SUPPORTED_CHAINS)) {
    return {
      success: false,
      error: `Unsupported chainId: ${chainId}. Supported: ${Object.keys(SUPPORTED_CHAINS).join(", ")}`,
    };
  }

  if (!from || !to) {
    return { success: false, error: "Missing required params: from, to (token addresses)" };
  }

  if (!isValidAddress(from)) {
    return { success: false, error: `Invalid 'from' address: ${from}` };
  }

  if (!isValidAddress(to)) {
    return { success: false, error: `Invalid 'to' address: ${to}` };
  }

  if (!amount) {
    return { success: false, error: "Missing required param: amount" };
  }

  if (isNaN(Number(amount)) || Number(amount) <= 0) {
    return { success: false, error: `Invalid amount: ${amount}` };
  }

  const slippageBps = parseInt(slippageBpsStr, 10);
  if (isNaN(slippageBps) || slippageBps < 0 || slippageBps > 10000) {
    return { success: false, error: `Invalid slippageBps: ${slippageBpsStr} (must be 0-10000)` };
  }

  if (sender && !isValidAddress(sender)) {
    return { success: false, error: `Invalid sender address: ${sender}` };
  }

  // Validate mode parameter
  const mode: QuoteMode = modeStr === "targetOut" ? "targetOut" : "exactIn";

  return { success: true, data: { chainId, from, to, amount, slippageBps, sender, mode } };
}
