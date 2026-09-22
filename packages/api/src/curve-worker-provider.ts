import { Worker } from "node:worker_threads";
import {
  CurveAggregator,
  type SuccessfulQuote,
  type SwapOptions,
  type SwapParams,
} from "@spandex/core";

type CurveConfig = ConstructorParameters<typeof CurveAggregator>[0];

export interface CurveWork {
  id: number;
  swap: SwapParams;
  options: SwapOptions;
  rpcUrl: string;
  supportedChains?: number[];
}

export type CurveReply =
  | { id: number; quote: SuccessfulQuote }
  | {
      id: number;
      error: {
        name: string;
        message: string;
        stack?: string;
        cause: unknown;
        details: unknown;
      };
    };

type Pending = {
  resolve: (quote: SuccessfulQuote) => void;
  reject: (error: Error) => void;
};

/** Keep Curve's catalog and route computation off the HTTP/provider event loop. */
class CurveWorkerProvider extends CurveAggregator {
  private worker?: Worker;
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./curve-worker.ts", import.meta.url), {
      execArgv: ["--import", "tsx"],
    });
    this.worker = worker;
    const fail = (error: Error) => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    worker.on("message", (reply: CurveReply) => {
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id);
      if ("error" in reply) {
        pending.reject(Object.assign(new Error(reply.error.message), reply.error));
      } else pending.resolve(reply.quote);
      if (this.pending.size === 0) worker.unref();
    });
    worker.once("error", fail);
    worker.once("messageerror", (error: Error) => {
      fail(error);
      void worker.terminate();
    });
    worker.once("exit", (code) => fail(new Error(`Curve worker exited with code ${code}`)));
    worker.unref();
    return worker;
  }

  protected override tryFetchQuote(swap: SwapParams, options: SwapOptions) {
    const rpcUrl = this.config.rpcUrlLookup(swap.chainId);
    if (!rpcUrl) throw new Error(`No Curve RPC configured for chain ${swap.chainId}`);
    const worker = this.getWorker();
    const id = ++this.sequence;
    return new Promise<SuccessfulQuote>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.ref();
      try {
        worker.postMessage({
          id,
          swap,
          options,
          rpcUrl,
          supportedChains: this.config.supportedChains,
        } satisfies CurveWork);
      } catch (error) {
        this.pending.delete(id);
        if (this.pending.size === 0) worker.unref();
        reject(error);
      }
    });
  }
}

export function curveInWorker(config: CurveConfig): CurveAggregator {
  return new CurveWorkerProvider(config);
}
