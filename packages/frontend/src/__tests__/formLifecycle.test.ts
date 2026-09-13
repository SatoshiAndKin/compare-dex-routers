import { beforeEach, describe, expect, it, vi } from "vitest";
import { formStore } from "../lib/stores/formStore.svelte.js";
import { configStore } from "../lib/stores/configStore.svelte.js";
import { comparisonStore } from "../lib/stores/comparisonStore.svelte.js";
import { tokenListStore } from "../lib/stores/tokenListStore.svelte.js";
import { tokensStore } from "../lib/stores/tokensStore.svelte.js";
import {
  applyDefaults,
  resolveSelectedTokens,
  selectChain,
} from "../lib/stores/formLifecycle.svelte.js";
import { applyUrlParamsToForm } from "../lib/stores/urlSync.svelte.js";
import { deferred, FROM, TO, makeQuote } from "./quote-fixture.js";
type TestResponse = {
  data: { name: string; symbol: string; decimals: number };
  response: Response;
};
const { get } = vi.hoisted(() => ({ get: vi.fn<(...args: unknown[]) => Promise<TestResponse>>() }));
vi.mock("../lib/api.js", () => ({ apiClient: { GET: get } }));
beforeEach(() => {
  localStorage.clear();
  get.mockReset();
  formStore.chainId = 1;
  formStore.fromToken = null;
  formStore.toToken = null;
  formStore.sellAmount = "1";
  formStore.receiveAmount = "";
  formStore.mode = "exactIn";
  formStore.isLoading = false;
  configStore.defaultTokens = { "1": { from: FROM, to: TO }, "8453": { from: TO, to: FROM } };
  tokensStore.allTokens = [];
  tokenListStore.lists = [];
  tokenListStore.localTokens = [];
  comparisonStore.invalidate();
});
describe("metadata gates and chain selection", () => {
  it.each(["defaults", "URL"])(
    "waits for real metadata for %s tokens, including zero decimals",
    async (source) => {
      if (source === "URL") applyUrlParamsToForm({ chainId: 1, from: FROM, to: TO, amount: "1" });
      else applyDefaults();
      expect(formStore.fromToken?.decimals).toBeNull();
      expect(formStore.canSubmit).toBe(false);
      get
        .mockResolvedValueOnce({
          data: { name: "Zero", symbol: "ZERO", decimals: 0 },
          response: new Response(),
        })
        .mockResolvedValueOnce({
          data: { name: "USDT", symbol: "USDT", decimals: 6 },
          response: new Response(),
        });
      expect(await resolveSelectedTokens()).toBeNull();
      expect(formStore.fromToken?.decimals).toBe(0);
      expect(formStore.toToken?.decimals).toBe(6);
      expect(formStore.canSubmit).toBe(true);
    }
  );
  it("uses loaded list metadata for configured defaults", async () => {
    tokensStore.allTokens = [
      { address: FROM, chainId: 1, decimals: 6, symbol: "USDC" },
      { address: TO, chainId: 1, decimals: 0, symbol: "ZERO" },
    ];
    applyDefaults();
    await resolveSelectedTokens();
    expect(formStore.fromToken?.decimals).toBe(6);
    expect(formStore.toToken?.decimals).toBe(0);
    expect(get).not.toHaveBeenCalled();
  });
  it("clears stale quotes and tokens when the chain changes", () => {
    applyDefaults();
    comparisonStore.spandexResult = makeQuote();
    selectChain(8453);
    expect(formStore.chainId).toBe(8453);
    expect(formStore.fromToken).toMatchObject({ address: TO, chainId: 8453, decimals: null });
    expect(comparisonStore.spandexResult).toBeNull();
    expect(formStore.canSubmit).toBe(false);
  });
  it("does not apply old metadata to a new chain or selection", async () => {
    const response = deferred<Awaited<ReturnType<typeof get>>>();
    get.mockReturnValue(response.promise);
    applyDefaults();
    const pending = resolveSelectedTokens();
    selectChain(8453);
    response.resolve({
      data: { name: "Old", symbol: "OLD", decimals: 18 },
      response: new Response(),
    });
    await pending;
    expect(formStore.fromToken).toMatchObject({ address: TO, chainId: 8453, decimals: null });
  });
  it("shares pending metadata reads, then allows a retry after failure", async () => {
    const response = deferred<Awaited<ReturnType<typeof get>>>();
    get.mockReturnValue(response.promise);
    applyDefaults();
    const first = resolveSelectedTokens();
    const second = resolveSelectedTokens();
    expect(get).toHaveBeenCalledTimes(2);
    response.reject(new Error("metadata unavailable"));
    await first;
    await second;
    expect(formStore.canSubmit).toBe(false);
    expect(formStore.fromToken?.decimals).toBeNull();
    get.mockResolvedValue({
      data: { name: "Token", symbol: "TOKEN", decimals: 6 },
      response: new Response(),
    });
    expect(await resolveSelectedTokens()).toBeNull();
    expect(formStore.canSubmit).toBe(true);
  });
});
