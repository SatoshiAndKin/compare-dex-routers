import { parentPort } from "node:worker_threads";
import { CurveAggregator, type SwapOptions, type SwapParams } from "@spandex/core";
import type { CurveReply, CurveWork } from "./curve-worker-provider.js";
import { redact, redactText } from "./redaction.js";

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
    const failure = error instanceof Error ? error : new Error(String(error));
    // Structured clone discards custom Error fields, including QuoteError.details.
    // Send plain diagnostic data and scrub nested errors before crossing the boundary.
    port.postMessage({
      id,
      error: {
        name: redactText(failure.name),
        message: redactText(failure.message),
        stack: failure.stack ? redactText(failure.stack) : undefined,
        cause: redact(failure.cause),
        details: redact("details" in failure ? failure.details : undefined),
      },
    } satisfies CurveReply);
  }
});
