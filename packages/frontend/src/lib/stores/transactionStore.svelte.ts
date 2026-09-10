import { comparisonStore, type Quote } from "./comparisonStore.svelte.js";
import { walletStore, type EIP1193Provider } from "./walletStore.svelte.js";
import { autoRefreshStore } from "./autoRefreshStore.svelte.js";
import { formStore } from "./formStore.svelte.js";

export type TxStatus = "idle" | "pending" | "confirmed" | "failed";
export interface SwapConfirmationData {
  routerName: string;
  quote: Quote;
}
interface Allowance {
  amount: bigint | null;
  status: TxStatus;
}
const MAX_UINT256 = "f".repeat(64);

function rejected(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    code?: number;
    data?: unknown;
    error?: unknown;
    originalError?: unknown;
  };
  return (
    value.code === 4001 ||
    rejected(value.data) ||
    rejected(value.error) ||
    rejected(value.originalError)
  );
}
function hex(value: string | number): string {
  return `0x${BigInt(value).toString(16)}`;
}
function allowanceKey(quote: Quote): string | null {
  const approval = quote.execution?.approval;
  return approval && quote.sender
    ? [quote.chainId, quote.sender, approval.token, approval.spender].join(":").toLowerCase()
    : null;
}
function quoteKey(quote: Quote): string {
  return JSON.stringify([
    quote.chainId,
    quote.sender,
    quote.from,
    quote.to,
    quote.input_amount_raw,
    quote.execution,
  ]);
}

class TransactionStore {
  allowances = $state<Record<string, Allowance>>({});
  swapStatus = $state<Record<string, TxStatus>>({});
  swapConfirmation = $state<SwapConfirmationData | null>(null);
  busy = $state(false);
  private confirmationResolve: ((confirmed: boolean) => void) | null = null;
  private allowanceRequests = new Map<string, number>();

  matches(quote: Quote): boolean {
    return Boolean(
      quote.execution &&
      quote.sender &&
      walletStore.provider &&
      walletStore.chainId === quote.chainId &&
      formStore.chainId === quote.chainId &&
      walletStore.address?.toLowerCase() === quote.sender.toLowerCase() &&
      formStore.fromToken?.address.toLowerCase() === quote.from.toLowerCase() &&
      formStore.toToken?.address.toLowerCase() === quote.to.toLowerCase() &&
      formStore.mode === quote.mode &&
      formStore.slippageBps === quote.slippage_bps &&
      (quote.mode === "exactIn" ? formStore.sellAmount : formStore.receiveAmount) ===
        quote.amount &&
      comparisonStore.isCurrent(quote)
    );
  }

  private async assertContext(quote: Quote, provider: EIP1193Provider): Promise<void> {
    if (!this.matches(quote) || walletStore.provider !== provider)
      throw new Error("Wallet or quote changed. Refresh quotes.");
    const [chain, accounts] = await Promise.all([
      provider.request({ method: "eth_chainId" }),
      provider.request({ method: "eth_accounts" }),
    ]);
    if (
      !this.matches(quote) ||
      walletStore.provider !== provider ||
      typeof chain !== "string" ||
      Number(BigInt(chain)) !== quote.chainId ||
      !Array.isArray(accounts) ||
      typeof accounts[0] !== "string" ||
      accounts[0].toLowerCase() !== quote.sender?.toLowerCase()
    ) {
      throw new Error("Wallet or quote changed. Refresh quotes.");
    }
  }

  getApproveStatus(quote: Quote): TxStatus {
    if (!this.matches(quote)) return "idle";
    const key = allowanceKey(quote);
    if (!key) return "confirmed";
    const entry = this.allowances[key];
    if (!entry) return "idle";
    if (entry.status === "pending") return "pending";
    return entry.amount !== null && entry.amount >= BigInt(quote.input_amount_raw)
      ? "confirmed"
      : entry.status;
  }

  getSwapStatus(quote: Quote): TxStatus {
    return this.swapStatus[quoteKey(quote)] ?? "idle";
  }

  private async readAllowance(quote: Quote, provider: EIP1193Provider): Promise<bigint> {
    const approval = quote.execution?.approval;
    if (!approval || !quote.sender) throw new Error("No approval data for this quote");
    const data = `0xdd62ed3e${quote.sender.slice(2).toLowerCase().padStart(64, "0")}${approval.spender.slice(2).toLowerCase().padStart(64, "0")}`;
    const amount = await provider.request({
      method: "eth_call",
      params: [{ to: approval.token, data }, "latest"],
    });
    if (typeof amount !== "string" || !/^0x[0-9a-f]+$/i.test(amount))
      throw new Error("Cannot read token allowance");
    return BigInt(amount);
  }

  async refreshAllowance(quote: Quote): Promise<void> {
    const key = allowanceKey(quote);
    const provider = walletStore.provider;
    if (!key || !provider || !this.matches(quote) || this.busy) return;
    const sequence = (this.allowanceRequests.get(key) ?? 0) + 1;
    this.allowanceRequests.set(key, sequence);
    this.allowances[key] = { amount: null, status: "idle" };
    try {
      await this.assertContext(quote, provider);
      const amount = await this.readAllowance(quote, provider);
      await this.assertContext(quote, provider);
      if (this.allowanceRequests.get(key) === sequence)
        this.allowances[key] = { amount, status: "idle" };
    } catch {
      if (this.allowanceRequests.get(key) === sequence)
        this.allowances[key] = { amount: null, status: "failed" };
    }
  }

  confirmSwap(): void {
    this.finishConfirmation(true);
  }
  cancelSwap(): void {
    this.finishConfirmation(false);
  }
  private finishConfirmation(confirmed: boolean): void {
    const resolve = this.confirmationResolve;
    this.confirmationResolve = null;
    this.swapConfirmation = null;
    resolve?.(confirmed);
  }

  private async receipt(provider: EIP1193Provider, hash: string, quote: Quote): Promise<void> {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await this.assertContext(quote, provider);
      const receipt = (await provider.request({
        method: "eth_getTransactionReceipt",
        params: [hash],
      })) as { status?: string } | null;
      if (receipt) {
        if (receipt.status !== "0x1" && receipt.status !== "1")
          throw new Error("Transaction failed on chain");
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error(`Confirmation is still pending for ${hash}`);
  }

  private start(): boolean {
    if (this.busy) return false;
    this.busy = true;
    autoRefreshStore.pause();
    comparisonStore.cancel();
    return true;
  }
  private finish(): void {
    this.busy = false;
    autoRefreshStore.resume();
  }
  private requestConnection(): void {
    walletStore.requestMenu();
    walletStore.setMessage("Connect your wallet, then review a fresh quote.");
  }

  async approve(_routerName: string, quote: Quote): Promise<void> {
    const provider = walletStore.provider;
    if (!walletStore.isConnected || !provider) {
      this.requestConnection();
      return;
    }
    if (!this.start()) return;
    const key = allowanceKey(quote);
    try {
      await this.assertContext(quote, provider);
      const approval = quote.execution?.approval;
      if (!key || !approval) return;
      // Supersede a display-only allowance read that may still be in flight.
      this.allowanceRequests.set(key, (this.allowanceRequests.get(key) ?? 0) + 1);
      const amount = await this.readAllowance(quote, provider);
      await this.assertContext(quote, provider);
      if (amount >= BigInt(quote.input_amount_raw)) {
        this.allowances[key] = { amount, status: "idle" };
        return;
      }
      this.allowances[key] = { amount: null, status: "pending" };
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: quote.sender,
            chainId: hex(quote.chainId),
            to: approval.token,
            value: "0x0",
            data: `0x095ea7b3${approval.spender.slice(2).toLowerCase().padStart(64, "0")}${MAX_UINT256}`,
          },
        ],
      });
      if (typeof hash !== "string") throw new Error("Wallet returned no transaction hash");
      walletStore.setMessage(`Approval submitted: ${hash}`);
      await this.receipt(provider, hash, quote);
      const confirmedAmount = await this.readAllowance(quote, provider);
      await this.assertContext(quote, provider);
      this.allowances[key] = { amount: confirmedAmount, status: "idle" };
      walletStore.setMessage(`Approval confirmed: ${hash}`);
    } catch (error) {
      if (key) this.allowances[key] = { amount: null, status: rejected(error) ? "idle" : "failed" };
      walletStore.setMessage(
        rejected(error)
          ? "Transaction canceled"
          : error instanceof Error
            ? error.message
            : "Approval failed",
        true
      );
    } finally {
      this.finish();
    }
  }

  async swap(routerName: string, quote: Quote): Promise<void> {
    const provider = walletStore.provider;
    if (!walletStore.isConnected || !provider) {
      this.requestConnection();
      return;
    }
    if (!this.start()) return;
    const key = quoteKey(quote);
    try {
      await this.assertContext(quote, provider);
      const confirmed = await new Promise<boolean>((resolve) => {
        this.confirmationResolve = resolve;
        this.swapConfirmation = { routerName, quote };
      });
      if (!confirmed) return;
      await this.assertContext(quote, provider);
      if (quote.execution?.approval) {
        const amount = await this.readAllowance(quote, provider);
        if (amount < BigInt(quote.input_amount_raw))
          throw new Error("Approve token spending before this swap.");
      }
      await this.assertContext(quote, provider);
      const execution = quote.execution;
      if (!execution) throw new Error("Quote has no execution data. Refresh quotes.");
      this.swapStatus[key] = "pending";
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: quote.sender,
            chainId: hex(quote.chainId),
            to: execution.to,
            data: execution.data,
            value: hex(execution.value),
          },
        ],
      });
      if (typeof hash !== "string") throw new Error("Wallet returned no transaction hash");
      walletStore.setMessage(`Swap submitted: ${hash}`);
      await this.receipt(provider, hash, quote);
      this.swapStatus[key] = "confirmed";
      walletStore.setMessage(`Swap confirmed: ${hash}`);
    } catch (error) {
      this.swapStatus[key] = rejected(error) ? "idle" : "failed";
      walletStore.setMessage(
        rejected(error) ? "Swap canceled" : error instanceof Error ? error.message : "Swap failed",
        true
      );
    } finally {
      this.finish();
    }
  }
}
export const transactionStore = new TransactionStore();
