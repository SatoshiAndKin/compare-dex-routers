import { parentPort, workerData } from "node:worker_threads";
import type { SuccessfulQuote } from "@spandex/core";
import type { CurveWork } from "../../curve-worker-provider.js";

const { blockMs, action } = workerData as { blockMs: number; action: string };
parentPort?.on("message", ({ id, swap }: CurveWork) => {
  if (action === "crash") throw new Error("Curve worker crashed");
  if (action === "exit") process.exit(0);
  if (action === "error") {
    parentPort?.postMessage({ id, error: new Error("Curve route unavailable") });
    return;
  }
  // Deliberately block this thread, as Curve catalog construction does in production.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, blockMs);
  const inputAmount = swap.mode === "exactIn" ? swap.inputAmount : swap.outputAmount;
  const quote: SuccessfulQuote = {
    success: true,
    provider: "curve",
    details: {
      route: [],
      inputAmount: String(inputAmount),
      outputAmount: String(inputAmount * 2n),
    },
    inputChainId: swap.chainId,
    outputChainId: swap.chainId,
    execution: "atomic",
    inputAmount,
    outputAmount: inputAmount * 2n,
    networkFee: 0n,
    latency: 0,
    txData: { to: swap.outputToken, data: "0x1234", value: 0n },
  };
  parentPort?.postMessage({ id, quote });
});
