import { mainnet, base, arbitrum, optimism, polygon, bsc, avalanche } from "viem/chains";

export interface TransactionReference {
  chainId: number;
  hash: string;
}
const chains = [mainnet, base, arbitrum, optimism, polygon, bsc, avalanche];

export function explorerBase(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function transactionExplorer(transaction: TransactionReference, override?: string | null) {
  if (!/^0x[\da-fA-F]{64}$/.test(transaction.hash)) return null;
  const custom = explorerBase(override);
  const fallback = chains.find((chain) => chain.id === transaction.chainId)?.blockExplorers.default;
  const baseUrl = custom ?? fallback?.url;
  if (!baseUrl) return null;
  return {
    name: custom ? new URL(custom).hostname : (fallback?.name ?? new URL(baseUrl).hostname),
    url: `${baseUrl.replace(/\/+$/, "")}/tx/${transaction.hash}`,
  };
}
