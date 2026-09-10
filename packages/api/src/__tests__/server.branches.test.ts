import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  decimals: vi.fn(),
  symbol: vi.fn(),
  name: vi.fn(),
  metrics: true,
}));
vi.mock("../config.js", async (original) => ({
  ...(await original<typeof import("../config.js")>()),
  getTokenDecimals: mocks.decimals,
  getTokenSymbol: mocks.symbol,
  getTokenName: mocks.name,
}));
vi.mock("../quotes.js", () => ({ compareQuotes: vi.fn(), singleQuote: vi.fn() }));
vi.mock("../feature-flags.js", () => ({
  isEnabled: () => mocks.metrics,
  getAllFlags: () => ({ metrics_endpoint: mocks.metrics }),
}));
let server: http.Server;
let base: string;
function request(
  path: string,
  options: http.RequestOptions = {}
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http
      .get(`${base}${path}`, options, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (part: string) => {
          body += part;
        });
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body, headers: response.headers })
        );
      })
      .on("error", reject);
  });
}
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.metrics = true;
  mocks.decimals.mockResolvedValue(6);
  mocks.symbol.mockResolvedValue("USDC");
  mocks.name.mockResolvedValue("USD Coin");
  const { handleRequest } = await import("../server.js");
  server = http.createServer(handleRequest);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const metadata = "/token-metadata?chainId=1&address=0x1111111111111111111111111111111111111111";
describe("HTTP boundaries", () => {
  it.each(["[", "host:bad", "user:secret@example.test", "host/path", "host?query"])(
    "rejects malformed Host %s and keeps serving requests",
    async (host) => {
      const response = await request("/health", { headers: { host } });
      expect(response.status).toBe(400);
      expect(JSON.parse(response.body).code).toBe("INVALID_REQUEST");
      expect((await request("/health")).status).toBe(200);
    }
  );
  it("replaces unsafe request identifiers", async () => {
    const response = await request("/health", {
      headers: { "x-request-id": "secret in a very long untrusted request id" },
    });
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("retains safe request identifiers in errors", async () => {
    const response = await request("/missing", { headers: { "x-request-id": "client-123" } });
    expect(JSON.parse(response.body)).toEqual({
      error: "Not found",
      code: "NOT_FOUND",
      requestId: "client-123",
    });
  });
  it("returns 204 for OPTIONS", async () => {
    expect((await request("/compare", { method: "OPTIONS" })).status).toBe(204);
  });
  it.each(["/openapi.json", "/openapi.yaml"])(
    "%s publishes the current quote contract",
    async (path) => {
      const response = await request(path);
      expect(response.status).toBe(200);
      const spec = JSON.parse(response.body);
      expect(spec.components.schemas.Quote.properties.execution).toBeDefined();
      expect(spec.components.schemas.Quote.properties.router_address).toBeUndefined();
      expect(spec.components.schemas.CompareResult.properties.recommendation_basis).toBeDefined();
    }
  );
  it("docs resolve their schema through the same API prefix", async () => {
    const response = await request("/docs");
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain('url: "./openapi.json"');
  });
  it("builds the Farcaster manifest from the request origin", async () => {
    const response = await request("/.well-known/farcaster.json", {
      headers: { host: "dex.example", "x-forwarded-proto": "https" },
    });
    expect(JSON.parse(response.body).miniapp.homeUrl).toBe("https://dex.example/?miniApp=true");
  });
  it("serves metrics only when enabled", async () => {
    expect((await request("/metrics")).body).toContain("spandex_requests_total");
    mocks.metrics = false;
    expect((await request("/metrics")).status).toBe(404);
  });
  it("returns full token metadata including zero decimals and empty optional names", async () => {
    mocks.decimals.mockResolvedValue(0);
    mocks.symbol.mockResolvedValue("");
    mocks.name.mockResolvedValue("");
    const response = await request(metadata);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ name: "", symbol: "", decimals: 0 });
  });
  it.each(["execution reverted", "returned no data", "not a contract"])(
    "returns 404 for invalid tokens: %s",
    async (message) => {
      mocks.decimals.mockRejectedValue(new Error(message));
      expect((await request(metadata)).status).toBe(404);
    }
  );
  it.each(["timeout", "ECONNREFUSED", "unexpected failure"])(
    "does not disclose RPC error details: %s",
    async (message) => {
      mocks.decimals.mockRejectedValue(
        new Error(`${message} https://user:secret@rpc.example/v2/key?apiKey=secret-value`)
      );
      const response = await request(metadata);
      expect(response.status).toBe(500);
      expect(JSON.parse(response.body)).toMatchObject({
        error: "Token metadata is unavailable. Please try again.",
        code: "UPSTREAM_ERROR",
      });
    }
  );
  it.each(["1junk", "1.5", "1e0", "", "-1", "0"])(
    "rejects malformed metadata chain IDs: %s",
    async (chain) => {
      expect((await request(metadata.replace("chainId=1", `chainId=${chain}`))).status).toBe(400);
      expect(mocks.decimals).not.toHaveBeenCalled();
    }
  );
});
