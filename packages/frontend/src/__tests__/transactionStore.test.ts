import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { transactionStore } from "../lib/stores/transactionStore.svelte.js";
import { walletStore } from "../lib/stores/walletStore.svelte.js";
import { autoRefreshStore } from "../lib/stores/autoRefreshStore.svelte.js";
import type { SpandexQuote, CurveQuote } from "../lib/stores/comparisonStore.svelte.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type MockProvider = {
  request: ReturnType<typeof vi.fn>;
};

function makeProvider(overrides?: Partial<MockProvider>): MockProvider {
  return {
    request: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

const mockSpandexQuote: SpandexQuote = {
  chainId: 1,
  from: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  from_symbol: "USDC",
  to: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  to_symbol: "USDT",
  amount: "100",
  input_amount: "100",
  output_amount: "99.95",
  input_amount_raw: "100000000",
  output_amount_raw: "99950000",
  mode: "exactIn",
  provider: "0x",
  slippage_bps: 50,
  router_address: "0xdef1c0ded9bec7f1a1670819833240f027b25eff",
  router_calldata: "0xabcdef1234",
  router_value: "0x0",
  approval_token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  approval_spender: "0xdef1c0ded9bec7f1a1670819833240f027b25eff",
  gas_used: "120000",
  gas_cost_eth: "0.0024",
  output_value_eth: "0.5",
  net_value_eth: "0.49",
};

const mockCurveQuote: CurveQuote = {
  source: "curve",
  from: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  from_symbol: "USDC",
  to: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  to_symbol: "USDT",
  amount: "100",
  input_amount: "100",
  output_amount: "99.98",
  input_amount_raw: "100000000",
  output_amount_raw: "99980000",
  mode: "exactIn",
  route: [],
  route_symbols: {},
  approval_target: "0x99a58482bd75cbab83b27ec03ca68ff489b5788f",
  router_address: "0x99a58482bd75cbab83b27ec03ca68ff489b5788f",
  router_calldata: "0x123456789a",
  gas_used: "150000",
  gas_cost_eth: "0.003",
  output_value_eth: "0.5",
  net_value_eth: "0.49",
};

// Reset all store state between tests
function resetStores(): void {
  // Reset transactionStore
  transactionStore.approveStatus = {};
  transactionStore.swapStatus = {};
  transactionStore.cancelSwap(); // resolves any pending confirmation promise

  // Reset walletStore
  walletStore.address = null;
  walletStore.chainId = null;
  walletStore.provider = null;
  walletStore.walletInfo = null;
  walletStore.isConnecting = false;
  walletStore.message = "";
  walletStore.messageIsError = false;
  walletStore.pendingAction = null;
  walletStore.walletMenuRequested = false;

  // Stop auto-refresh
  autoRefreshStore.stop();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("transactionStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStores();
  });

  afterEach(() => {
    resetStores();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  it("starts with all statuses idle", () => {
    expect(transactionStore.approveStatus).toEqual({});
    expect(transactionStore.swapStatus).toEqual({});
    expect(transactionStore.swapConfirmation).toBeNull();
  });

  it("getApproveStatus returns idle for unknown routers", () => {
    expect(transactionStore.getApproveStatus("spandex")).toBe("idle");
    expect(transactionStore.getApproveStatus("curve")).toBe("idle");
  });

  it("getSwapStatus returns idle for unknown routers", () => {
    expect(transactionStore.getSwapStatus("spandex")).toBe("idle");
    expect(transactionStore.getSwapStatus("curve")).toBe("idle");
  });

  // ---------------------------------------------------------------------------
  // approve() — no wallet connected
  // ---------------------------------------------------------------------------

  it("approve sets pendingAction when wallet not connected", async () => {
    await transactionStore.approve("spandex", mockSpandexQuote);

    expect(walletStore.pendingAction).not.toBeNull();
    expect(walletStore.pendingAction?.type).toBe("approve");
  });

  it("approve stores routerName and quote in pendingAction params", async () => {
    await transactionStore.approve("spandex", mockSpandexQuote);

    const params = walletStore.pendingAction?.params as { routerName: string; quote: unknown };
    expect(params.routerName).toBe("spandex");
    expect(params.quote).toEqual(mockSpandexQuote);
  });

  it("approve requests wallet menu when not connected", async () => {
    await transactionStore.approve("spandex", mockSpandexQuote);

    expect(walletStore.walletMenuRequested).toBe(true);
  });

  it("approve does not change approveStatus when not connected", async () => {
    await transactionStore.approve("spandex", mockSpandexQuote);

    expect(transactionStore.getApproveStatus("spandex")).toBe("idle");
  });

  // ---------------------------------------------------------------------------
  // swap() — no wallet connected
  // ---------------------------------------------------------------------------

  it("swap sets pendingAction when wallet not connected", async () => {
    await transactionStore.swap("spandex", mockSpandexQuote);

    expect(walletStore.pendingAction).not.toBeNull();
    expect(walletStore.pendingAction?.type).toBe("swap");
  });

  it("swap stores routerName and quote in pendingAction params", async () => {
    await transactionStore.swap("spandex", mockSpandexQuote);

    const params = walletStore.pendingAction?.params as { routerName: string; quote: unknown };
    expect(params.routerName).toBe("spandex");
    expect(params.quote).toEqual(mockSpandexQuote);
  });

  it("swap requests wallet menu when not connected", async () => {
    await transactionStore.swap("spandex", mockSpandexQuote);

    expect(walletStore.walletMenuRequested).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // approve() — allowance sufficient (no tx sent)
  // ---------------------------------------------------------------------------

  it("approve marks confirmed without tx when allowance sufficient", async () => {
    const provider = makeProvider({
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_call") {
          // Return allowance > input_amount_raw (100000000)
          return Promise.resolve("0x" + 200000000n.toString(16).padStart(64, "0"));
        }
        return Promise.resolve(null);
      }),
    });

    walletStore.address = "0xaBC1230000000000000000000000000000000001";
    walletStore.provider = provider as never;

    await transactionStore.approve("spandex", mockSpandexQuote);

    expect(transactionStore.getApproveStatus("spandex")).toBe("confirmed");
    // eth_sendTransaction should NOT have been called
    const calls = (provider.request as ReturnType<typeof vi.fn>).mock.calls;
    const txCalls = calls.filter(
      (c: unknown[]) => (c[0] as { method: string }).method === "eth_sendTransaction"
    );
    expect(txCalls).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // approve() — sends tx when allowance insufficient
  // ---------------------------------------------------------------------------

  it("approve transitions idle → pending → confirmed on success", async () => {
    const txHash = "0xabc123txhash";
    const provider = makeProvider({
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_call") {
          // Allowance is 0 — needs approval
          return Promise.resolve("0x" + "0".repeat(64));
        }
        if (method === "eth_sendTransaction") {
          return Promise.resolve(txHash);
        }
        if (method === "eth_getTransactionReceipt") {
          return Promise.resolve({ status: "0x1" });
        }
        return Promise.resolve(null);
      }),
    });

    walletStore.address = "0xaBC1230000000000000000000000000000000001";
    walletStore.provider = provider as never;

    const approvePromise = transactionStore.approve("spandex", mockSpandexQuote);

    // Status goes pending immediately when tx sent
    await approvePromise;

    expect(transactionStore.getApproveStatus("spandex")).toBe("confirmed");
  });

  it("approve transitions to failed when tx receipt status is 0", async () => {
    const txHash = "0xfailed";
    const provider = makeProvider({
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_call") return Promise.resolve("0x" + "0".repeat(64));
        if (method === "eth_sendTransaction") return Promise.resolve(txHash);
        if (method === "eth_getTransactionReceipt") return Promise.resolve({ status: "0x0" });
        return Promise.resolve(null);
      }),
    });

    walletStore.address = "0xaBC1230000000000000000000000000000000001";
    walletStore.provider = provider as never;

    await transactionStore.approve("spandex", mockSpandexQuote);

    expect(transactionStore.getApproveStatus("spandex")).toBe("failed");
  });

  it("approve transitions to idle when user rejects (code 4001)", async () => {
    const provider = makeProvider({
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_call") return Promise.resolve("0x" + "0".repeat(64));
        if (method === "eth_sendTransaction") return Promise.reject({ code: 4001 });
        return Promise.resolve(null);
      }),
    });

    walletStore.address = "0xaBC1230000000000000000000000000000000001";
    walletStore.provider = provider as never;

    await transactionStore.approve("spandex", mockSpandexQuote);

    expect(transactionStore.getApproveStatus("spandex")).toBe("idle");
    expect(walletStore.messageIsError).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // approve() — auto-refresh pause/resume
  // ---------------------------------------------------------------------------

  it("approve pauses auto-refresh during transaction", async () => {
    const pauseSpy = vi.spyOn(autoRefreshStore, "pause");
    const txHash = "0xhash";
    const provider = makeProvider({
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_call") return Promise.resolve("0x" + "0".repeat(64));
        if (method === "eth_sendTransaction") return Promise.resolve(txHash);
        if (method === "eth_getTransactionReceipt") return Promise.resolve({ status: "0x1" });
        return Promise.resolve(null);
      }),
    });

    walletStore.address = "0xaBC1230000000000000000000000000000000001";
    walletStore.provider = provider as never;

    await transactionStore.approve("spandex", mockSpandexQuote);

    expect(pauseSpy).toHaveBeenCalledOnce();
  });

  it("approve resumes auto-refresh after transaction", async () => {
    const resumeSpy = vi.spyOn(autoRefreshStore, "resume");
    const txHash = "0xhash";
    const provider = makeProvider({
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_call") return Promise.resolve("0x" + "0".repeat(64));
        if (method === "eth_sendTransaction") return Promise.resolve(txHash);
        if (method === "eth_getTransactionReceipt") return Promise.resolve({ status: "0x1" });
        return Promise.resolve(null);
      }),
    });

    walletStore.address = "0xaBC1230000000000000000000000000000000001";
    walletStore.provider = provider as never;

    await transactionStore.approve("spandex", mockSpandexQuote);

    expect(resumeSpy).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // swap() — confirmation modal flow
  // ---------------------------------------------------------------------------

  it("swap sets swapConfirmation when wallet connected", async () => {
    walletStore.address = "0xaBC1230000000000000000000000000000000001";
    walletStore.provider = makeProvider() as never;

    // Don't await — we need to check state while modal is showing
    const swapPromise = transactionStore.swap("spandex", mockSpandexQuote);

    // Modal should now be showing
    expect(transactionStore.swapConfirmation).not.toBeNull();
    expect(transactionStore.swapConfirmation?.routerName).toBe("spandex");

    // Cancel to resolve the promise
    transactionStore.cancelSwap();
    await swapPromise;
  });

  it("swap cancels without executing when cancelSwap called", async () => {
    const provider = makeProvider();
    walletStore.address = "0xaBC1230000000000000000000000000000000001";
    walletStore.provider = provider as never;

    const swapPromise = transactionStore.swap("spandex", mockSpandexQuote);

    transactionStore.cancelSwap();
    await swapPromise;

    expect(transactionStore.getSwapStatus("spandex")).toBe("idle");
    const calls = (provider.request as ReturnType<typeof vi.fn>).mock.calls;
    const txCalls = calls.filter(
      (c: unknown[]) => (c[0] as { method: string }).method === "eth_sendTransaction"
    );
    expect(txCalls).toHaveLength(0);
  });

  it("swap closes confirmation modal on cancel", async () => {
    walletStore.address = "0xaBC1230000000000000000000000000000000001";
    walletStore.provider = makeProvider() as never;

    const swapPromise = transactionStore.swap("spandex", mockSpandexQuote);

    transactionStore.cancelSwap();
    await swapPromise;

    expect(transactionStore.swapConfirmation).toBeNull();
  });

  it("swap transitions idle → pending → confirmed on success after confirm", async () => {
    const txHash = "0xswaptx";
    const provider = makeProvider({
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_sendTransaction") return Promise.resolve(txHash);
        if (method === "eth_getTransactionReceipt") return Promise.resolve({ status: "0x1" });
        return Promise.resolve(null);
      }),
    });

    walletStore.address = "0xaBC1230000000000000000000000000000000001";
    walletStore.provider = provider as never;

    const swapPromise = transactionStore.swap("spandex", mockSpandexQuote);

    // Confirm the swap
    transactionStore.confirmSwap();
    await swapPromise;

    expect(transactionStore.getSwapStatus("spandex")).toBe("confirmed");
  });

  it("swap transitions to failed when tx receipt is 0", async () => {
    const txHash = "0xfailed";
    const provider = makeProvider({
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_sendTransaction") return Promise.resolve(txHash);
        if (method === "eth_getTransactionReceipt") return Promise.resolve({ status: "0x0" });
        return Promise.resolve(null);
      }),
    });

    walletStore.address = "0xaBC1230000000000000000000000000000000001";
    walletStore.provider = provider as never;

    const swapPromise = transactionStore.swap("spandex", mockSpandexQuote);
    transactionStore.confirmSwap();
    await swapPromise;

    expect(transactionStore.getSwapStatus("spandex")).toBe("failed");
  });

  it("swap transitions to idle when user rejects (code 4001)", async () => {
    const provider = makeProvider({
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_sendTransaction") return Promise.reject({ code: 4001 });
        return Promise.resolve(null);
      }),
    });

    walletStore.address = "0xaBC1230000000000000000000000000000000001";
    walletStore.provider = provider as never;

    const swapPromise = transactionStore.swap("spandex", mockSpandexQuote);
    transactionStore.confirmSwap();
    await swapPromise;

    expect(transactionStore.getSwapStatus("spandex")).toBe("idle");
    expect(walletStore.messageIsError).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // swap() — auto-refresh pause/resume
  // ---------------------------------------------------------------------------

  it("swap pauses auto-refresh during transaction", async () => {
    const pauseSpy = vi.spyOn(autoRefreshStore, "pause");
    const txHash = "0xswaptx";
    const provider = makeProvider({
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_sendTransaction") return Promise.resolve(txHash);
        if (method === "eth_getTransactionReceipt") return Promise.resolve({ status: "0x1" });
        return Promise.resolve(null);
      }),
    });

    walletStore.address = "0xaBC1230000000000000000000000000000000001";
    walletStore.provider = provider as never;

    const swapPromise = transactionStore.swap("spandex", mockSpandexQuote);
    transactionStore.confirmSwap();
    await swapPromise;

    expect(pauseSpy).toHaveBeenCalledOnce();
  });

  it("swap resumes auto-refresh after transaction", async () => {
    const resumeSpy = vi.spyOn(autoRefreshStore, "resume");
    const txHash = "0xswaptx";
    const provider = makeProvider({
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_sendTransaction") return Promise.resolve(txHash);
        if (method === "eth_getTransactionReceipt") return Promise.resolve({ status: "0x1" });
        return Promise.resolve(null);
      }),
    });

    walletStore.address = "0xaBC1230000000000000000000000000000000001";
    walletStore.provider = provider as never;

    const swapPromise = transactionStore.swap("spandex", mockSpandexQuote);
    transactionStore.confirmSwap();
    await swapPromise;

    expect(resumeSpy).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // CurveQuote approve
  // ---------------------------------------------------------------------------

  it("approve works with CurveQuote (uses from as token address)", async () => {
    const txHash = "0xcurveapprove";
    const provider = makeProvider({
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_call") return Promise.resolve("0x" + "0".repeat(64));
        if (method === "eth_sendTransaction") return Promise.resolve(txHash);
        if (method === "eth_getTransactionReceipt") return Promise.resolve({ status: "0x1" });
        return Promise.resolve(null);
      }),
    });

    walletStore.address = "0xaBC1230000000000000000000000000000000001";
    walletStore.provider = provider as never;

    await transactionStore.approve("curve", mockCurveQuote);

    expect(transactionStore.getApproveStatus("curve")).toBe("confirmed");

    // Verify eth_call was made to the correct token address (from = USDC)
    const calls = (provider.request as ReturnType<typeof vi.fn>).mock.calls;
    const ethCallArgs = calls.find(
      (c: unknown[]) => (c[0] as { method: string }).method === "eth_call"
    )?.[0] as { params: [{ to: string }] } | undefined;
    expect(ethCallArgs?.params[0].to.toLowerCase()).toBe(mockCurveQuote.from?.toLowerCase());
  });

  // ---------------------------------------------------------------------------
  // Independent status per router
  // ---------------------------------------------------------------------------

  it("spandex and curve have independent approve status", async () => {
    const provider = makeProvider({
      request: vi.fn().mockImplementation(({ method }: { method: string }) => {
        if (method === "eth_call")
          return Promise.resolve("0x" + 999999999n.toString(16).padStart(64, "0"));
        return Promise.resolve(null);
      }),
    });

    walletStore.address = "0xaBC1230000000000000000000000000000000001";
    walletStore.provider = provider as never;

    await transactionStore.approve("spandex", mockSpandexQuote);
    // curve is still idle
    expect(transactionStore.getApproveStatus("spandex")).toBe("confirmed");
    expect(transactionStore.getApproveStatus("curve")).toBe("idle");
  });

  // ---------------------------------------------------------------------------
  // walletStore.requestMenu / ackMenuRequest
  // ---------------------------------------------------------------------------

  it("walletStore.requestMenu sets walletMenuRequested to true", () => {
    walletStore.requestMenu();
    expect(walletStore.walletMenuRequested).toBe(true);
  });

  it("walletStore.ackMenuRequest clears walletMenuRequested", () => {
    walletStore.requestMenu();
    walletStore.ackMenuRequest();
    expect(walletStore.walletMenuRequested).toBe(false);
  });
});
