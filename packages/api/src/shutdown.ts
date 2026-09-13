import http from "node:http";
import { logger } from "./logger.js";
import { flushTelemetry } from "./sentry.js";

interface ShutdownOptions {
  drainTimeoutMs?: number;
  flushTimeoutMs?: number;
  flush?: (timeoutMs: number) => Promise<boolean>;
}

/** Track response completion before listening, so keep-alive sockets close after draining. */
export function createManagedServer(
  handler: (
    request: http.IncomingMessage,
    response: http.ServerResponse,
    draining: boolean
  ) => void,
  options: ShutdownOptions = {}
) {
  let draining = false;
  let stopped: Promise<boolean> | undefined;
  const server = http.createServer((request, response) => {
    response.once("finish", () => {
      if (draining) setImmediate(() => server.closeIdleConnections());
    });
    handler(request, response, draining);
  });
  return {
    server,
    shutdown() {
      draining = true;
      stopped ??= drainServer(server, options);
      return stopped;
    },
  };
}

/** Drain requests, then reporting, within Docker's stop deadline. */
async function drainServer(
  server: http.Server,
  { drainTimeoutMs = 25_000, flushTimeoutMs = 5_000, flush = flushTelemetry }: ShutdownOptions
): Promise<boolean> {
  const drained = await new Promise<boolean>((resolve) => {
    const deadline = setTimeout(() => {
      logger.warn("Shutdown deadline reached; closing remaining HTTP connections");
      server.closeAllConnections();
      resolve(false);
    }, drainTimeoutMs);
    server.close((error) => {
      clearTimeout(deadline);
      resolve(!error);
    });
  });
  logger.info({ drained }, "HTTP server stopped");
  const flushed = await new Promise<boolean>((resolve) => {
    const deadline = setTimeout(() => resolve(false), flushTimeoutMs);
    void flush(flushTimeoutMs)
      .then(resolve, () => resolve(false))
      .finally(() => clearTimeout(deadline));
  });
  return drained && flushed;
}
