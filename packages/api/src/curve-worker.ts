import { parentPort } from "node:worker_threads";
import { CurveAggregator, type SwapOptions, type SwapParams } from "@spandex/core";
import type { CurveReply, CurveWork } from "./curve-worker-provider.js";

class LocalCurve extends CurveAggregator {
  quote(swap: SwapParams, options: SwapOptions) {
    return this.tryFetchQuote(swap, options);
  }
}

const port = parentPort;
if (!port) throw new Error("Curve quote worker requires a parent port");
const providers = new Map<string, LocalCurve>();

port.on("message", async ({ id, swap, options, rpcUrl, supportedChains }: CurveWork) => {
  try {
    const key = `${swap.chainId}:${rpcUrl}`;
    let provider = providers.get(key);
    if (!provider) {
      provider = new LocalCurve({ rpcUrlLookup: () => rpcUrl, supportedChains });
      providers.set(key, provider);
    }
    const quote = await provider.quote(swap, options);
    port.postMessage({ id, quote } satisfies CurveReply);
  } catch (error) {
    port.postMessage({
      id,
      error: error instanceof Error ? error : new Error(String(error)),
    } satisfies CurveReply);
  }
});
