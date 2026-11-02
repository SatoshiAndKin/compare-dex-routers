import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CoinbaseEstimateSchema } from "../coinbase.js";
const { estimate } = vi.hoisted(() => ({ estimate: vi.fn() }));
vi.mock("../coinbase.js", async (original) => ({
  ...(await original<typeof import("../coinbase.js")>()),
  getCoinbaseEstimate: estimate,
}));
let server: http.Server;
let url: string;
beforeAll(async () => {
  const { handleRequest } = await import("../server.js");
  server = http.createServer(handleRequest);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing listener");
  url = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  estimate.mockReset();
  estimate.mockResolvedValue({ status: "unavailable", reason: "Unsupported market." });
});
function call(fee?: string, overrides: Record<string, string> = {}) {
  const query = new URLSearchParams({
    chainId: "1",
    from: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    amount: "1",
    ...overrides,
  });
  if (fee !== undefined) query.set("takerFeePercent", fee);
  return fetch(`${url}/coinbase-estimate?${query}`);
}
describe("Coinbase HTTP endpoint", () => {
  it.each([undefined, "0", "0.125"])("passes the explicit fee assumption %s", async (fee) => {
    const response = await call(fee);
    expect(response.status).toBe(200);
    expect(CoinbaseEstimateSchema.parse(await response.json())).toMatchObject({
      status: "unavailable",
    });
    expect(estimate).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 1, amount: "1" }),
      fee ?? null
    );
  });
  it.each(["100", "-1", "0.00001", "NaN", ""])(
    "rejects invalid fees %s before requesting data",
    async (fee) => {
      expect((await call(fee)).status).toBe(400);
      expect(estimate).not.toHaveBeenCalled();
    }
  );
  it("uses the common trade validation", async () => {
    expect((await call(undefined, { from: "bad" })).status).toBe(400);
    expect(estimate).not.toHaveBeenCalled();
  });
});
