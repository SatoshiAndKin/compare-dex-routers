import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createManagedServer } from "../shutdown.js";

const servers: http.Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

async function listen(
  handler: http.RequestListener,
  options?: Parameters<typeof createManagedServer>[1]
) {
  const app = createManagedServer(handler, options);
  const { server } = app;
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test listener");
  return { ...app, url: `http://127.0.0.1:${address.port}` };
}

describe("graceful HTTP shutdown", () => {
  it("finishes an accepted response before flushing and closing", async () => {
    let response!: http.ServerResponse;
    let accepted!: () => void;
    const started = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    const flush = vi.fn(async () => true);
    const { server, url, shutdown } = await listen(
      (_req, res) => {
        response = res;
        accepted();
      },
      { drainTimeoutMs: 500, flush }
    );
    const request = fetch(url).then((result) => result.text());
    await started;
    const stopped = shutdown();
    expect(shutdown()).toBe(stopped);
    expect(flush).not.toHaveBeenCalled();
    response.end("complete quote");
    expect(await request).toBe("complete quote");
    expect(await stopped).toBe(true);
    expect(flush).toHaveBeenCalledExactlyOnceWith(5_000);
    expect(server.listening).toBe(false);
  });

  it("closes a stalled request at the deadline and still flushes", async () => {
    let accepted!: () => void;
    const started = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    const flush = vi.fn(async () => true);
    const { url, shutdown } = await listen(() => accepted(), { drainTimeoutMs: 25, flush });
    const request = fetch(url).catch(() => "closed");
    await started;
    expect(await shutdown()).toBe(false);
    expect(await request).toBe("closed");
    expect(flush).toHaveBeenCalledOnce();
  });

  it("bounds a telemetry flush that never resolves", async () => {
    const { shutdown } = await listen((_req, res) => res.end(), {
      flushTimeoutMs: 25,
      flush: () => new Promise<boolean>(() => {}),
    });
    expect(await shutdown()).toBe(false);
  });
});
