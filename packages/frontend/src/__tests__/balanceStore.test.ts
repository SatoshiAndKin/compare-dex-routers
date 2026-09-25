import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  balanceStore as store,
  fetchTokenBalance,
  formatBalance,
} from "../lib/stores/balanceStore.svelte.js";
import { exactAmount, NATIVE_TOKEN } from "../lib/native.js";
import { deferred, FROM, SENDER, TO } from "./quote-fixture.js";
const request = vi.fn<(args: { method: string; params?: unknown[] }) => Promise<unknown>>();
const provider = { request };
beforeEach(() => {
  store.clear();
  store.clearCache();
  request
    .mockReset()
    .mockImplementation(async ({ method }) => (method === "eth_chainId" ? "0x1" : "0x0"));
});
describe("exact balance state", () => {
  it.each([0, 6, 18, 255])("retains exact integer precision with %i decimals", (decimals) => {
    const raw = 9007199254740993n * 10n ** BigInt(decimals) + (decimals > 0 ? 1n : 0n);
    expect(exactAmount(raw, decimals)).toBe(
      `9007199254740993${decimals > 0 ? `.${"0".repeat(decimals - 1)}1` : ""}`
    );
    expect(formatBalance(raw, decimals)).toMatch(/^9,007,199,254,740,993/);
  });
  it("distinguishes zero, loading, unavailable, and disconnected balances", async () => {
    const pending = deferred<unknown>();
    request.mockImplementation(async ({ method }) =>
      method === "eth_chainId" ? "0x1" : pending.promise
    );
    const read = store.fetchBalances(provider, SENDER, 1, { address: FROM, decimals: 6 }, null);
    expect(store.from.status).toBe("loading");
    pending.resolve("0x0");
    await read;
    expect(store.from).toEqual({ status: "ready", raw: 0n, decimals: 6 });
    expect(store.fromBalance).toBe("0");
    store.clearCache();
    request.mockRejectedValue(new Error("offline"));
    await store.fetchBalances(provider, SENDER, 1, { address: FROM, decimals: 6 }, null);
    expect(store.from.status).toBe("unavailable");
    store.clear();
    expect(store.from.status).toBe("idle");
  });
  it("uses eth_getBalance for native assets and preserves raw values", async () => {
    request.mockResolvedValue("0x20000000000001");
    expect(await fetchTokenBalance(provider, NATIVE_TOKEN, SENDER, 18, 1)).toBe(9007199254740993n);
    expect(request).toHaveBeenCalledWith({ method: "eth_getBalance", params: [SENDER, "latest"] });
  });
  it("reads ERC-20 balances with the exact account and rejects malformed responses", async () => {
    expect(await fetchTokenBalance(provider, FROM, SENDER, 6, 1)).toBe(0n);
    expect(request).toHaveBeenCalledWith({
      method: "eth_call",
      params: [{ to: FROM, data: `0x70a08231${SENDER.slice(2).padStart(64, "0")}` }, "latest"],
    });
    store.clearCache();
    request.mockResolvedValue("garbage");
    expect(await fetchTokenBalance(provider, FROM, SENDER, 6, 1)).toBeNull();
  });
  it("does not query token balances on a mismatched network", async () => {
    request.mockResolvedValue("0x2105");
    await store.fetchBalances(
      provider,
      SENDER,
      1,
      { address: FROM, decimals: 6 },
      { address: TO, decimals: 6 }
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(store.from.status).toBe("wrong_network");
    expect(store.to.raw).toBeNull();
  });
  it("discards old wallet requests after replacement and disconnect", async () => {
    const old = deferred<unknown>();
    let first = true;
    request.mockImplementation(async ({ method }) => {
      if (method === "eth_chainId") return "0x1";
      if (first) {
        first = false;
        return old.promise;
      }
      return "0x9";
    });
    const pending = store.fetchBalances(provider, SENDER, 1, { address: FROM, decimals: 0 }, null);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await store.fetchBalances(provider, TO, 1, { address: FROM, decimals: 0 }, null);
    old.resolve("0x7");
    await pending;
    expect(store.from.raw).toBe(9n);
    const late = deferred<unknown>();
    store.clearCache();
    request.mockReturnValue(late.promise);
    const disconnected = store.fetchBalances(
      provider,
      SENDER,
      1,
      { address: FROM, decimals: 0 },
      null
    );
    store.clear();
    late.resolve("0x1");
    await disconnected;
    expect(store.from.raw).toBeNull();
  });
});
