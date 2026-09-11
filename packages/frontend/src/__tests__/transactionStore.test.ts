import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionStore as transactions } from "../lib/stores/transactionStore.svelte.js";
import { comparisonStore } from "../lib/stores/comparisonStore.svelte.js";
import { walletStore } from "../lib/stores/walletStore.svelte.js";
import { formStore } from "../lib/stores/formStore.svelte.js";
import { autoRefreshStore } from "../lib/stores/autoRefreshStore.svelte.js";
import { makeQuote, SENDER, FROM, TO, ROUTER, deferred } from "./quote-fixture.js";

const HASH = `0x${"a".repeat(64)}`;
const request =
  vi.fn<(args: { method: string; params?: unknown[] | object }) => Promise<unknown>>();
let allowance: bigint;
let actualChain: string;
let actualAccount: string;
function current(overrides: Parameters<typeof makeQuote>[0] = {}) {
  comparisonStore.spandexResult = makeQuote(overrides);
  return comparisonStore.spandexResult;
}
function sent() {
  return request.mock.calls.filter(([args]) => args.method === "eth_sendTransaction");
}
async function confirmation() {
  await vi.waitFor(() => expect(transactions.swapConfirmation).not.toBeNull());
}

beforeEach(() => {
  comparisonStore.invalidate();
  transactions.cancelSwap();
  transactions.allowances = {};
  transactions.swapStatus = {};
  transactions.busy = false;
  autoRefreshStore.stop();
  walletStore.address = SENDER;
  walletStore.chainId = 1;
  walletStore.provider = { request };
  walletStore.walletMenuRequested = false;
  formStore.chainId = 1;
  formStore.mode = "exactIn";
  formStore.slippageBps = 50;
  formStore.sellAmount = "100";
  formStore.fromToken = { address: FROM, symbol: "USDC", decimals: 6, chainId: 1 };
  formStore.toToken = { address: TO, symbol: "USDT", decimals: 6, chainId: 1 };
  allowance = 0n;
  actualChain = "0x1";
  actualAccount = SENDER;
  request.mockReset().mockImplementation(async ({ method }) => {
    switch (method) {
      case "eth_accounts":
        return [actualAccount];
      case "eth_chainId":
        return actualChain;
      case "eth_call":
        return `0x${allowance.toString(16)}`;
      case "eth_sendTransaction":
        allowance = 2n ** 256n - 1n;
        return HASH;
      case "eth_getTransactionReceipt":
        return { status: "0x1" };
      default:
        throw new Error(`Unexpected wallet method: ${method}`);
    }
  });
});
afterEach(() => {
  transactions.cancelSwap();
  autoRefreshStore.stop();
  vi.restoreAllMocks();
});

describe("quote-bound wallet actions", () => {
  it.each(["approve", "swap"] as const)(
    "%s asks for a connection without saving a transaction",
    async (action) => {
      walletStore.address = null;
      await transactions[action]("spandex", current({ sender: null, execution: null }));
      expect(walletStore.walletMenuRequested).toBe(true);
      expect(request).not.toHaveBeenCalled();
      expect(walletStore.message).toContain("fresh quote");
    }
  );
  it.each([
    "preview",
    "wrong chain",
    "wrong account",
    "wrong provider account",
    "wrong provider chain",
    "old quote",
    "changed amount",
    "changed slippage",
  ])("blocks %s before approval or swap", async (scenario) => {
    const quote = current(scenario === "preview" ? { sender: null, execution: null } : {});
    if (scenario === "wrong chain") walletStore.chainId = 8453;
    if (scenario === "wrong account") walletStore.address = ROUTER;
    if (scenario === "wrong provider account") actualAccount = ROUTER;
    if (scenario === "wrong provider chain") actualChain = "0x2105";
    if (scenario === "old quote") current();
    if (scenario === "changed amount") formStore.sellAmount = "200";
    if (scenario === "changed slippage") formStore.slippageBps = 100;
    await transactions.approve("spandex", quote);
    await transactions.swap("spandex", quote);
    expect(sent()).toEqual([]);
    expect(transactions.swapConfirmation).toBeNull();
  });
  it("uses the connected account, chain, token, and spender for approval", async () => {
    const quote = current();
    autoRefreshStore.start(15, vi.fn());
    await transactions.approve("spandex", quote);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]?.[0].params).toEqual([
      {
        from: SENDER,
        chainId: "0x1",
        to: FROM,
        value: "0x0",
        data: `0x095ea7b3${ROUTER.slice(2).padStart(64, "0")}${"f".repeat(64)}`,
      },
    ]);
    expect(transactions.getApproveStatus(quote)).toBe("confirmed");
    expect(walletStore.message).toContain(HASH);
    expect(autoRefreshStore.paused).toBe(false);
  });
  it("reads allowance and skips an unnecessary approval", async () => {
    allowance = 100000000n;
    const quote = current();
    await transactions.approve("spandex", quote);
    expect(sent()).toEqual([]);
    expect(transactions.getApproveStatus(quote)).toBe("confirmed");
  });
  it("checks the allowance amount for every new quote", async () => {
    allowance = 100000000n;
    const quote = current();
    await transactions.refreshAllowance(quote);
    expect(transactions.getApproveStatus(quote)).toBe("confirmed");
    formStore.sellAmount = "200";
    const larger = current({ amount: "200", input_amount: "200", input_amount_raw: "200000000" });
    expect(transactions.getApproveStatus(larger)).toBe("idle");
  });
  it.each(["token", "spender", "sender", "chain"])(
    "does not reuse allowance after a %s change",
    async (field) => {
      allowance = 100000000n;
      await transactions.refreshAllowance(current());
      const quote = makeQuote();
      if (field === "token") {
        quote.from = ROUTER;
        quote.execution!.approval!.token = ROUTER;
        formStore.fromToken!.address = ROUTER;
      }
      if (field === "spender") quote.execution!.approval!.spender = TO;
      if (field === "sender") {
        quote.sender = TO;
        walletStore.address = TO;
      }
      if (field === "chain") {
        quote.chainId = 8453;
        formStore.chainId = 8453;
        walletStore.chainId = 8453;
      }
      expect(transactions.getApproveStatus(current(quote))).toBe("idle");
    }
  );
  it("does not allow an older allowance response to overwrite a newer read", async () => {
    const first = deferred<unknown>();
    let reads = 0;
    const base = request.getMockImplementation()!;
    request.mockImplementation((args) =>
      args.method === "eth_call" && ++reads === 1 ? first.promise : base(args)
    );
    const quote = current();
    const pending = transactions.refreshAllowance(quote);
    await vi.waitFor(() => expect(reads).toBe(1));
    allowance = 100000000n;
    await transactions.refreshAllowance(quote);
    first.resolve("0x0");
    await pending;
    expect(transactions.getApproveStatus(quote)).toBe("confirmed");
  });
  it("requires confirmation and sends only through the wallet RPC", async () => {
    allowance = 100000000n;
    const quote = current();
    const pending = transactions.swap("spandex", quote);
    await confirmation();
    expect(sent()).toEqual([]);
    transactions.confirmSwap();
    await pending;
    expect(sent()).toHaveLength(1);
    expect(sent()[0]?.[0].params).toEqual([
      { from: SENDER, chainId: "0x1", to: ROUTER, data: "0xabcdef", value: "0x0" },
    ]);
    expect(transactions.getSwapStatus(quote)).toBe("confirmed");
    expect(walletStore.message).toContain(HASH);
  });
  it.each(["account", "chain", "form", "quote", "provider"])(
    "blocks a %s change while the confirmation is open",
    async (field) => {
      allowance = 100000000n;
      const pending = transactions.swap("spandex", current());
      await confirmation();
      if (field === "account") actualAccount = ROUTER;
      if (field === "chain") actualChain = "0x2105";
      if (field === "form") formStore.slippageBps = 100;
      if (field === "quote") comparisonStore.invalidate();
      if (field === "provider") walletStore.provider = { request: vi.fn() };
      transactions.confirmSwap();
      await pending;
      expect(sent()).toEqual([]);
    }
  );
  it("rechecks context after an allowance read before opening the wallet", async () => {
    const quote = current();
    const base = request.getMockImplementation()!;
    request.mockImplementation(async (args) => {
      if (args.method === "eth_call") {
        actualChain = "0x2105";
        return "0xffffffffffff";
      }
      return base(args);
    });
    const pending = transactions.swap("spandex", quote);
    await confirmation();
    transactions.confirmSwap();
    await pending;
    expect(sent()).toEqual([]);
  });
  it("blocks a swap if allowance fell below the quote input", async () => {
    const quote = current();
    const pending = transactions.swap("spandex", quote);
    await confirmation();
    transactions.confirmSwap();
    await pending;
    expect(sent()).toEqual([]);
    expect(walletStore.message).toContain("Approve token spending");
  });
  it("cancels without a wallet prompt", async () => {
    const pending = transactions.swap("spandex", current());
    await confirmation();
    transactions.cancelSwap();
    await pending;
    expect(sent()).toEqual([]);
    expect(transactions.busy).toBe(false);
  });
  it.each(["approve", "swap"] as const)(
    "stops after wallet rejection during %s, including obsolete saved MEV settings",
    async (action) => {
      localStorage.setItem(
        "compare-dex-settings",
        JSON.stringify({ mevEnabled: true, customRpcUrl: "https://rpc.flashbots.net" })
      );
      allowance = action === "swap" ? 100000000n : 0n;
      const base = request.getMockImplementation()!;
      request.mockImplementation((args) =>
        args.method === "eth_sendTransaction" ? Promise.reject({ code: 4001 }) : base(args)
      );
      const quote = current();
      const pending = transactions[action]("spandex", quote);
      if (action === "swap") {
        await confirmation();
        transactions.confirmSwap();
      }
      await pending;
      expect(sent()).toHaveLength(1);
      expect(request.mock.calls.some(([args]) => /sign|RawTransaction/.test(args.method))).toBe(
        false
      );
      expect(transactions.busy).toBe(false);
      expect(walletStore.message).toContain("canceled");
      localStorage.removeItem("compare-dex-settings");
    }
  );
  it("marks a reverted receipt as failed", async () => {
    const base = request.getMockImplementation()!;
    request.mockImplementation((args) =>
      args.method === "eth_getTransactionReceipt" ? Promise.resolve({ status: "0x0" }) : base(args)
    );
    const quote = current();
    await transactions.approve("spandex", quote);
    expect(transactions.getApproveStatus(quote)).toBe("failed");
  });
  it("does not run concurrent wallet actions", async () => {
    const quote = current();
    const pending = transactions.swap("spandex", quote);
    await confirmation();
    await transactions.approve("spandex", quote);
    expect(sent()).toEqual([]);
    transactions.cancelSwap();
    await pending;
  });
  it("native token swaps do not request ERC-20 approval", async () => {
    const quote = current({
      execution: { to: ROUTER, data: "0xab", value: "100", approval: null },
    });
    expect(transactions.getApproveStatus(quote)).toBe("confirmed");
    const pending = transactions.swap("spandex", quote);
    await confirmation();
    transactions.confirmSwap();
    await pending;
    expect(request.mock.calls.some(([args]) => args.method === "eth_call")).toBe(false);
    expect(sent()[0]?.[0].params).toEqual([expect.objectContaining({ value: "0x64" })]);
  });
});
