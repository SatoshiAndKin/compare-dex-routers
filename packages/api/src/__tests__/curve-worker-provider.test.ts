import { createServer, type Server } from "node:http";
import type { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuccessfulQuote, SwapParams } from "@spandex/core";

const state = vi.hoisted(() => ({
  workers: [] as Worker[],
  blockMs: 0,
  action: "quote",
  url: "",
}));

vi.mock("node:worker_threads", async (original) => {
  const actual = await original<typeof import("node:worker_threads")>();
  return {
    ...actual,
    Worker: class extends actual.Worker {
      constructor(_filename: URL, options: ConstructorParameters<typeof Worker>[1]) {
        super(new URL("./fixtures/curve-worker.ts", import.meta.url), {
          ...options,
          workerData: { blockMs: state.blockMs, action: state.action },
        });
        state.workers.push(this);
      }
    },
  };
});

vi.mock("@spandex/core", async (original) => {
  const actual = await original<typeof import("@spandex/core")>();
  class NetworkProvider extends actual.KyberAggregator {
    protected override async tryFetchQuote(): Promise<SuccessfulQuote> {
      const response = await fetch(state.url);
      expect(await response.text()).toBe("quote");
      return fixture("kyberswap");
    }
  }
  class BlockingCurve extends actual.CurveAggregator {
    protected override async tryFetchQuote(): Promise<SuccessfulQuote> {
      await new Promise((resolve) => setTimeout(resolve, 0));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_000);
      return fixture("curve");
    }
  }
  return {
    ...actual,
    kyberswap: () => new NetworkProvider({ clientId: "quote-worker-test" }),
    curve: () => new BlockingCurve({ rpcUrlLookup: () => "http://unused.test" }),
  };
});

import { prepareQuotes } from "@spandex/core";
import { getSpandexConfig } from "../config.js";
import { curveInWorker } from "../curve-worker-provider.js";

const swap: SwapParams = {
  chainId: 1,
  inputToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  outputToken: "0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E",
  swapperAccount: "0xEe7aE85f2Fe2239E27D9c1E23fFFe168D63b4055",
  inputAmount: 1000000000n,
  slippageBps: 50,
  mode: "exactIn",
};

function fixture(provider: "curve" | "kyberswap"): SuccessfulQuote {
  const common = {
    success: true,
    inputChainId: 1,
    outputChainId: 1,
    execution: "atomic",
    inputAmount: 1000000000n,
    outputAmount: 1000000000000000000000n,
    networkFee: 0n,
    latency: 0,
    txData: { to: swap.outputToken, data: "0x1234", value: 0n },
  } as const;
  return provider === "curve"
    ? {
        ...common,
        provider,
        details: { route: [], inputAmount: "1000", outputAmount: "1000" },
      }
    : {
        ...common,
        provider,
        details: {
          inputAmount: String(common.inputAmount),
          outputAmount: String(common.outputAmount),
          totalGas: 100000,
          gasPriceGwei: "1",
          gasUsd: 1,
          amountInUsd: 1000,
          amountOutUsd: 1000,
          receivedUsd: 999,
          swaps: [],
          tokens: {},
          encodedSwapData: common.txData.data,
          routerAddress: common.txData.to,
        },
      };
}

let server: Server | undefined;
afterEach(async () => {
  await Promise.all(state.workers.splice(0).map((worker) => worker.terminate()));
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
  state.blockMs = 0;
  state.action = "quote";
});

describe("Curve worker provider", () => {
  it("keeps network provider quotes alive while Curve blocks its thread", async () => {
    state.blockMs = 2_000;
    server = createServer((_request, response) => response.end("quote"));
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test listener");
    state.url = `http://127.0.0.1:${address.port}`;
    const config = getSpandexConfig();
    config.aggregators = config.aggregators.filter((p) =>
      ["kyberswap", "curve"].includes(p.name())
    );
    config.options = { deadlineMs: 500, numRetries: 0 };
    const quotes = await Promise.all(
      await prepareQuotes({ config, swap, mapFn: async (quote) => quote })
    );
    expect(quotes.find((quote) => quote.provider === "kyberswap")).toMatchObject({
      ...fixture("kyberswap"),
      latency: expect.any(Number),
    });
    expect(quotes.find((quote) => quote.provider === "curve")).toMatchObject({
      success: false,
      error: { message: "MetaAggregator deadline exceeded after 500ms" },
    });
  });

  it("preserves bigint quote data and correlates concurrent replies on one worker", async () => {
    const provider = curveInWorker({ rpcUrlLookup: () => "http://unused.test" });
    const quotes = await Promise.all(
      [1000000000n, 9007199254740993n].map((inputAmount) =>
        provider.fetchQuote({ ...swap, mode: "exactIn", inputAmount }, { numRetries: 0 })
      )
    );
    for (const [index, inputAmount] of [1000000000n, 9007199254740993n].entries()) {
      expect(quotes[index]).toMatchObject({
        success: true,
        provider: "curve",
        inputAmount,
        outputAmount: inputAmount * 2n,
        txData: { to: swap.outputToken, data: "0x1234", value: 0n },
      });
    }
    expect(state.workers).toHaveLength(1);
  });

  it("returns a failed quote when the worker reports a provider error", async () => {
    state.action = "error";
    const provider = curveInWorker({ rpcUrlLookup: () => "http://unused.test" });
    expect(await provider.fetchQuote(swap, { numRetries: 0 })).toMatchObject({
      success: false,
      provider: "curve",
      error: { message: "Curve route unavailable" },
    });
  });

  it.each(["crash", "exit"])(
    "settles pending requests after worker %s and restarts on demand",
    async (action) => {
      state.action = action;
      const provider = curveInWorker({ rpcUrlLookup: () => "http://unused.test" });
      const failures = await Promise.all([
        provider.fetchQuote(swap, { numRetries: 0 }),
        provider.fetchQuote(swap, { numRetries: 0 }),
      ]);
      for (const quote of failures) {
        expect(quote).toMatchObject({
          success: false,
          provider: "curve",
          error: {
            message:
              action === "crash" ? "Curve worker crashed" : "Curve worker exited with code 0",
          },
        });
      }
      state.action = "quote";
      expect(await provider.fetchQuote(swap, { numRetries: 0 })).toMatchObject({
        success: true,
        inputAmount: 1000000000n,
        outputAmount: 2000000000n,
      });
      expect(state.workers).toHaveLength(2);
    }
  );
});
