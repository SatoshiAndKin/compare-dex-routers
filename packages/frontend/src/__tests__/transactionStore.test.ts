import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionStore as transactions } from "../lib/stores/transactionStore.svelte.js";
import { comparisonStore } from "../lib/stores/comparisonStore.svelte.js";
import { walletStore } from "../lib/stores/walletStore.svelte.js";
import { formStore } from "../lib/stores/formStore.svelte.js";
import { autoRefreshStore } from "../lib/stores/autoRefreshStore.svelte.js";
import { makeQuote, makeComparison, SENDER, FROM, TO, ROUTER, deferred } from "./quote-fixture.js";

const get = vi.hoisted(() => vi.fn());
vi.mock("../lib/api.js", () => ({ apiClient: { GET: get } }));

const HASH = `0x${"a".repeat(64)}`;
const request =
  vi.fn<(args: { method: string; params?: unknown[] | object }) => Promise<unknown>>();
let allowance: bigint;
let actualChain: string;
let actualAccount: string;
function current(overrides: Parameters<typeof makeQuote>[0] = {}) {
  comparisonStore.quotes = [makeQuote(overrides)];
  comparisonStore.recommendation = comparisonStore.quotes[0]!.provider;
  return comparisonStore.quotes[0]!;
}
function sent() {
  return request.mock.calls.filter(([args]) => args.method === "eth_sendTransaction");
}
async function confirmation() {
  await vi.waitFor(() => expect(transactions.swapConfirmation).not.toBeNull());
}

beforeEach(() => {
  comparisonStore.invalidate();
  transactions.invalidate();
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
  get.mockReset().mockImplementation(async () => ({
    data: makeComparison({
      quotes: comparisonStore.quotes.map((quote) => ({ ...quote })),
      recommendation: comparisonStore.quotes[0]?.provider ?? null,
    }),
    response: new Response(),
  }));
  request.mockReset().mockImplementation(async ({ method, params }) => {
    switch (method) {
      case "eth_accounts":
        return [actualAccount];
      case "eth_chainId":
        return actualChain;
      case "eth_call":
        return Array.isArray(params) &&
          (params[0] as { data: string }).data.startsWith("0x70a08231")
          ? "0x5f5e100"
          : `0x${allowance.toString(16)}`;
      case "eth_getBalance":
        return "0x8ac7230489e80000";
      case "eth_gasPrice":
        return "0x4a817c800";
      case "eth_estimateGas":
        return "0x1d4c0";
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
        gas: "0x23280",
        gasPrice: "0x4a817c800",
      },
    ]);
    expect(transactions.getApproveStatus(comparisonStore.quotes[0]!)).toBe("confirmed");
    expect(walletStore.message).toContain(HASH);
    expect(autoRefreshStore.paused).toBe(false);
  });
  it("reads allowance and skips an unnecessary approval", async () => {
    allowance = 100000000n;
    const quote = current();
    await transactions.approve("spandex", quote);
    expect(sent()).toEqual([]);
    expect(transactions.getApproveStatus(comparisonStore.quotes[0]!)).toBe("confirmed");
  });
  it("checks the allowance amount for every new quote", async () => {
    allowance = 100000000n;
    const quote = current();
    await transactions.refreshAllowance(quote);
    expect(transactions.getApproveStatus(comparisonStore.quotes[0]!)).toBe("confirmed");
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
    expect(transactions.getApproveStatus(comparisonStore.quotes[0]!)).toBe("confirmed");
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
      {
        from: SENDER,
        chainId: "0x1",
        to: ROUTER,
        data: "0xabcdef",
        value: "0x0",
        gas: "0x23280",
        gasPrice: "0x4a817c800",
      },
    ]);
    expect(transactions.getSwapStatus(quote)).toBe("confirmed");
    expect(comparisonStore.workflowProvider).toBeNull();
    expect(walletStore.message).toContain(HASH);
  });
  it.each([
    [100000n, "120001", 144002n],
    [200001n, "120000", 240002n],
    [200001n, null, 240002n],
  ])("budgets gas from current estimate %s and simulation %s", async (estimate, simulated, gas) => {
    allowance = 100000000n;
    const base = request.getMockImplementation()!;
    request.mockImplementation((args) =>
      args.method === "eth_estimateGas" ? Promise.resolve(`0x${estimate.toString(16)}`) : base(args)
    );
    const pending = transactions.swap("spandex", current({ gas_used: simulated }));
    await confirmation();
    transactions.confirmSwap();
    await pending;
    expect(sent()[0]?.[0].params).toEqual([
      expect.objectContaining({ gas: `0x${gas.toString(16)}` }),
    ]);
  });
  it.each(["account", "chain", "quote", "revert", "invalid"])(
    "blocks submission when gas estimation encounters %s",
    async (problem) => {
      allowance = 100000000n;
      const base = request.getMockImplementation()!;
      request.mockImplementation(async (args) => {
        if (args.method !== "eth_estimateGas") return base(args);
        if (problem === "account") actualAccount = ROUTER;
        if (problem === "chain") actualChain = "0x2105";
        if (problem === "quote") comparisonStore.invalidate();
        if (problem === "revert") throw new Error("execution reverted");
        return problem === "invalid" ? "0x0" : "0x1d4c0";
      });
      const pending = transactions.swap("spandex", current());
      await confirmation();
      transactions.confirmSwap();
      await pending;
      expect(sent()).toEqual([]);
      expect(transactions.busy).toBe(false);
    }
  );
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
    expect(comparisonStore.workflowProvider).toBeNull();
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
      expect(comparisonStore.workflowProvider).toBeNull();
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
    expect(transactions.getApproveStatus(comparisonStore.quotes[0]!)).toBe("failed");
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
    const native = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    formStore.fromToken = { address: native, decimals: 18, symbol: "ETH" };
    formStore.sellAmount = "0.0000000000000001";
    const quote = current({
      from: native,
      from_symbol: "ETH",
      amount: "0.0000000000000001",
      input_amount: "0.0000000000000001",
      input_amount_raw: "100",
      execution: { to: ROUTER, data: "0xab", value: "100", approval: null },
    });
    expect(transactions.getApproveStatus(comparisonStore.quotes[0]!)).toBe("confirmed");
    const pending = transactions.swap("spandex", quote);
    await confirmation();
    transactions.confirmSwap();
    await pending;
    expect(request.mock.calls.some(([args]) => args.method === "eth_call")).toBe(false);
    expect(sent()[0]?.[0].params).toEqual([expect.objectContaining({ value: "0x64" })]);
  });
  it("refreshes before approval and after its receipt without changing provider", async () => {
    await transactions.approve("0x", current());
    expect(get).toHaveBeenCalledTimes(2);
    for (const [path, options] of get.mock.calls) {
      expect(path).toBe("/quote");
      expect(options.params.query.sender).toBe(SENDER);
    }
    expect(comparisonStore.workflowProvider).toBe("0x");
  });
  it("keeps the approved provider through ordinary refreshes and swap confirmation despite a new recommendation", async () => {
    const quote = current({ provider: "curve" });
    get.mockResolvedValue({ data: makeComparison(), response: new Response() });
    await transactions.approve("curve", quote);
    expect(comparisonStore.recommendation).toBe("0x");
    expect(comparisonStore.activeQuote?.provider).toBe("curve");
    expect(transactions.getApproveStatus(comparisonStore.activeQuote!)).toBe("confirmed");
    await comparisonStore.compare({
      chainId: 1,
      from: FROM,
      to: TO,
      amount: "100",
      slippageBps: 50,
      mode: "exactIn",
      sender: SENDER,
    });
    expect(comparisonStore.activeQuote?.provider).toBe("curve");
    const pending = transactions.swap("curve", comparisonStore.activeQuote!);
    await confirmation();
    expect(transactions.swapConfirmation?.quote.provider).toBe("curve");
    expect(comparisonStore.workflowProvider).toBe("curve");
    transactions.confirmSwap();
    await pending;
    expect(sent()).toHaveLength(2);
    expect(comparisonStore.workflowProvider).toBeNull();
    expect(comparisonStore.activeQuote?.provider).toBe("0x");
  });
  it("confirms refreshed calldata and never substitutes another provider", async () => {
    allowance = 100000000n;
    get.mockResolvedValue({
      data: makeComparison({
        quotes: [makeQuote({ execution: { to: TO, data: "0x1234", value: "0", approval: null } })],
      }),
      response: new Response(),
    });
    const pending = transactions.swap("0x", current());
    await confirmation();
    expect(transactions.swapConfirmation?.quote.execution?.data).toBe("0x1234");
    transactions.confirmSwap();
    await pending;
    expect(sent()[0]?.[0].params).toEqual([
      expect.objectContaining({ to: TO, data: "0x1234", from: SENDER }),
    ]);
    get.mockResolvedValue({
      data: makeComparison({ quotes: [makeQuote({ provider: "curve" })], recommendation: "curve" }),
      response: new Response(),
    });
    request.mockClear();
    await transactions.swap("0x", current());
    expect(sent()).toEqual([]);
    expect(walletStore.message).toContain("0x is unavailable");
    expect(comparisonStore.workflowProvider).toBe("0x");
  });
  it.each(["tokens", "gas", "unknown"])(
    "keeps prices visible and blocks %s insufficiency",
    async (problem) => {
      const base = request.getMockImplementation()!;
      request.mockImplementation((args) => {
        if (args.method === "eth_getBalance" && problem === "gas") return Promise.resolve("0x0");
        if (args.method === "eth_call" && problem === "tokens") return Promise.resolve("0x0");
        if (args.method === "eth_gasPrice" && problem === "unknown")
          return Promise.reject(new Error("Gas price unavailable"));
        return base(args);
      });
      const quote = current();
      await transactions.refreshChecks(quote);
      expect(comparisonStore.quotes).toHaveLength(1);
      expect(transactions.getCheck(quote).status).toBe("blocked");
      expect(transactions.getCheck(quote).message).toContain(
        problem === "tokens"
          ? "Insufficient USDC"
          : problem === "gas"
            ? "Insufficient gas"
            : "unavailable"
      );
      await transactions.approve("0x", quote);
      expect(sent()).toEqual([]);
    }
  );
  it("blocks an expired confirmation even after wallet checks pass", async () => {
    allowance = 100000000n;
    const pending = transactions.swap("0x", current());
    await confirmation();
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31000);
    transactions.confirmSwap();
    await pending;
    expect(sent()).toEqual([]);
    expect(walletStore.message).toContain("expired");
  });
});
