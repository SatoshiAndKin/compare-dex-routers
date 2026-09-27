import type { EIP1193Provider } from "./walletStore.svelte.js";
import { exactAmount, canonicalToken } from "../native.js";
import { quantity, readBalance } from "../wallet-rpc.js";

export interface TokenRef {
  address: string;
  decimals: number;
  symbol?: string;
}
export interface BalanceState {
  status: "idle" | "loading" | "ready" | "unavailable" | "wrong_network";
  raw: bigint | null;
  decimals: number | null;
}
let cacheEpoch = 0;
const cache = new Map<string, { raw: bigint; timestamp: number }>();
export function formatBalance(balance: bigint, decimals: number): string {
  const [whole = "0", fraction] = exactAmount(balance, decimals).split(".");
  const display = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${display}.${fraction.slice(0, 6)}` : display;
}

export async function fetchTokenBalance(
  provider: EIP1193Provider,
  tokenAddress: string,
  walletAddress: string,
  decimals: number,
  chainId: number
): Promise<bigint | null> {
  if (!provider || !walletAddress || !tokenAddress) return null;
  try {
    exactAmount(0n, decimals);
    const key = `${chainId}:${canonicalToken(tokenAddress).toLowerCase()}:${walletAddress.toLowerCase()}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < 30_000) return cached.raw;
    const epoch = cacheEpoch;
    const raw = await readBalance(provider, walletAddress, tokenAddress);
    if (epoch === cacheEpoch) cache.set(key, { raw, timestamp: Date.now() });
    return raw;
  } catch {
    return null;
  }
}

class BalanceStore {
  private sequence = 0;
  private context: {
    provider: EIP1193Provider;
    account: string;
    chainId: number;
    token: string;
    outputToken: string | null;
  } | null = null;
  private updatedAt = 0;

  inputBalance(
    provider: EIP1193Provider | null,
    account: string | null,
    chainId: number,
    token: string
  ): bigint | null {
    const context = this.context;
    return context &&
      context.provider === provider &&
      context.account === account?.toLowerCase() &&
      context.chainId === chainId &&
      context.token === canonicalToken(token).toLowerCase() &&
      this.from.status === "ready" &&
      Date.now() - this.updatedAt < 30_000
      ? this.from.raw
      : null;
  }

  refresh(
    provider: EIP1193Provider,
    account: string,
    chainId: number,
    fromToken: TokenRef,
    toToken: TokenRef | null,
    force = false
  ): Promise<void> | undefined {
    if (force) this.clearCache();
    if (
      !force &&
      (this.inputBalance(provider, account, chainId, fromToken.address) !== null ||
        (this.from.status === "loading" &&
          this.context?.provider === provider &&
          this.context.account === account.toLowerCase() &&
          this.context.chainId === chainId &&
          this.context.token === canonicalToken(fromToken.address).toLowerCase()))
    )
      return;
    return this.fetchBalances(provider, account, chainId, fromToken, toToken);
  }
  from = $state<BalanceState>({ status: "idle", raw: null, decimals: null });
  to = $state<BalanceState>({ status: "idle", raw: null, decimals: null });
  get fromBalance(): string | null {
    return this.display(this.from);
  }
  get toBalance(): string | null {
    return this.display(this.to);
  }
  private display(balance: BalanceState): string | null {
    return balance.status === "ready" && balance.raw !== null && balance.decimals !== null
      ? formatBalance(balance.raw, balance.decimals)
      : null;
  }

  async fetchBalances(
    provider: EIP1193Provider,
    account: string,
    chainId: number,
    fromToken: TokenRef | null,
    toToken: TokenRef | null
  ): Promise<void> {
    const sequence = ++this.sequence;
    const retain =
      this.context?.provider === provider &&
      this.context.account === account.toLowerCase() &&
      this.context.chainId === chainId &&
      this.context.token === canonicalToken(fromToken?.address ?? "").toLowerCase() &&
      this.context.outputToken ===
        (toToken ? canonicalToken(toToken.address).toLowerCase() : null) &&
      this.from.status === "ready";
    this.context = fromToken
      ? {
          provider,
          account: account.toLowerCase(),
          chainId,
          token: canonicalToken(fromToken.address).toLowerCase(),
          outputToken: toToken ? canonicalToken(toToken.address).toLowerCase() : null,
        }
      : null;
    if (!retain) this.updatedAt = 0;
    const initial = (token: TokenRef | null): BalanceState => ({
      status: token ? "loading" : "idle",
      raw: null,
      decimals: token?.decimals ?? null,
    });
    if (!retain) {
      this.from = initial(fromToken);
      this.to = initial(toToken);
    }
    try {
      const actualChain = quantity(
        await provider.request({ method: "eth_chainId" }),
        "Wallet network"
      );
      if (sequence !== this.sequence) return;
      if (actualChain !== BigInt(chainId)) {
        this.from = { ...this.from, status: "wrong_network" };
        this.to = { ...this.to, status: "wrong_network" };
        return;
      }
      const [from, to] = await Promise.all([
        fromToken
          ? fetchTokenBalance(provider, fromToken.address, account, fromToken.decimals, chainId)
          : null,
        toToken
          ? fetchTokenBalance(provider, toToken.address, account, toToken.decimals, chainId)
          : null,
      ]);
      const checkedChain = quantity(
        await provider.request({ method: "eth_chainId" }),
        "Wallet network"
      );
      if (sequence !== this.sequence) return;
      if (checkedChain !== BigInt(chainId)) {
        this.clearCache();
        this.from = { ...this.from, status: "wrong_network", raw: null };
        this.to = { ...this.to, status: "wrong_network", raw: null };
        return;
      }
      const finish = (token: TokenRef | null, raw: bigint | null): BalanceState => ({
        status: !token ? "idle" : raw === null ? "unavailable" : "ready",
        raw,
        decimals: token?.decimals ?? null,
      });
      this.updatedAt = Date.now();
      this.from = finish(fromToken, from);
      this.to = finish(toToken, to);
    } catch {
      if (sequence !== this.sequence) return;
      this.from = { ...this.from, status: "unavailable", raw: null };
      this.to = { ...this.to, status: "unavailable", raw: null };
    }
  }
  clear(): void {
    this.sequence++;
    this.context = null;
    this.updatedAt = 0;
    this.from = { status: "idle", raw: null, decimals: null };
    this.to = { status: "idle", raw: null, decimals: null };
  }
  clearCache(): void {
    cacheEpoch++;
    cache.clear();
  }
}
export const balanceStore = new BalanceStore();
