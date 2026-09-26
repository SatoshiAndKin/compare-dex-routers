import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = 1790461060000;
const fetchMock = vi.fn();
function reply(price: unknown = 2000, timestamp = NOW / 1000, asset = "ethereum") {
  return new Response(JSON.stringify({ coins: { [`coingecko:${asset}`]: { price, timestamp } } }));
}
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  fetchMock.mockReset().mockImplementation(async () => reply());
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("USD display price", () => {
  it.each([
    [1, "ethereum"],
    [10, "ethereum"],
    [8453, "ethereum"],
    [42161, "ethereum"],
    [56, "binancecoin"],
    [137, "polygon-ecosystem-token"],
    [43114, "avalanche-2"],
  ] as const)("uses the native asset for chain %s", async (chain, asset) => {
    fetchMock.mockResolvedValue(reply(123.45, NOW / 1000, asset));
    const { getNativeUsdConversion } = await import("../usd-price.js");
    expect(await getNativeUsdConversion(chain)).toEqual({
      native_price_usd: "123.45",
      source: "defillama",
      updated_at: NOW / 1000,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://coins.llama.fi/prices/current/coingecko:${asset}`
    );
  });
  it("shares concurrent requests and cached prices across chains with the same native asset", async () => {
    const { getNativeUsdConversion } = await import("../usd-price.js");
    const results = await Promise.all([getNativeUsdConversion(1), getNativeUsdConversion(8453)]);
    expect(results[0]).toEqual(results[1]);
    vi.setSystemTime(NOW + 59999);
    expect(await getNativeUsdConversion(10)).toEqual(results[0]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 60000);
    fetchMock.mockResolvedValue(reply(2100, (NOW + 60000) / 1000));
    expect((await getNativeUsdConversion(1))?.native_price_usd).toBe("2100");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([0, -1, "2000", null])("rejects invalid price %s", async (price) => {
    fetchMock.mockResolvedValue(reply(price));
    const { getNativeUsdConversion } = await import("../usd-price.js");
    expect(await getNativeUsdConversion(1)).toBeNull();
  });
  it.each([-601, 1])("rejects source timestamp offset %s seconds", async (offset) => {
    fetchMock.mockResolvedValue(reply(2000, NOW / 1000 + offset));
    const { getNativeUsdConversion } = await import("../usd-price.js");
    expect(await getNativeUsdConversion(1)).toBeNull();
  });
  it("expires the source timestamp even during the cache TTL", async () => {
    fetchMock.mockImplementation(async () => reply(2000, NOW / 1000 - 600));
    const { getNativeUsdConversion } = await import("../usd-price.js");
    expect(await getNativeUsdConversion(1)).not.toBeNull();
    vi.setSystemTime(NOW + 1000);
    expect(await getNativeUsdConversion(1)).toBeNull();
  });
  it.each(["missing", "http", "json", "network"])(
    "returns unavailable and recovers after %s failure",
    async (failure) => {
      if (failure === "missing") fetchMock.mockResolvedValue(new Response('{"coins":{}}'));
      if (failure === "http") fetchMock.mockResolvedValue(new Response("", { status: 429 }));
      if (failure === "json") fetchMock.mockResolvedValue(new Response("not JSON"));
      if (failure === "network") fetchMock.mockRejectedValue(new Error("offline"));
      const { getNativeUsdConversion } = await import("../usd-price.js");
      expect(await getNativeUsdConversion(1)).toBeNull();
      fetchMock.mockResolvedValue(reply());
      expect((await getNativeUsdConversion(1))?.native_price_usd).toBe("2000");
    }
  );
  it("aborts a stalled request after two seconds", async () => {
    fetchMock.mockImplementation(
      (_url, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason))
        )
    );
    const { getNativeUsdConversion } = await import("../usd-price.js");
    expect(await getNativeUsdConversion(1)).toBeNull();
    expect(fetchMock.mock.calls[0]?.[1].signal.aborted).toBe(true);
  });
  it("does not request unsupported native assets", async () => {
    const { getNativeUsdConversion } = await import("../usd-price.js");
    expect(await getNativeUsdConversion(999999)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("normalizes scientific notation and multiplies without losing decimal precision", async () => {
    fetchMock.mockResolvedValue(reply(1e-7));
    const { getNativeUsdConversion, nativeToUsd } = await import("../usd-price.js");
    const conversion = await getNativeUsdConversion(1);
    expect(conversion?.native_price_usd).toBe("0.0000001");
    expect(nativeToUsd("9007199254740993.000000000000000001", conversion)).toBe(
      "900719925.4740993000000000000000001"
    );
    expect(nativeToUsd("-0.00001", conversion)).toBe("-0.000000000001");
    expect(nativeToUsd("0", conversion)).toBe("0");
    expect(nativeToUsd(null, conversion)).toBeNull();
    expect(nativeToUsd("1", null)).toBeNull();
  });
});
