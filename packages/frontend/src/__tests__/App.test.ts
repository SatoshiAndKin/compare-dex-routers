import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.svelte";
import { formStore } from "../lib/stores/formStore.svelte.js";
import { configStore } from "../lib/stores/configStore.svelte.js";
import { tokenListStore } from "../lib/stores/tokenListStore.svelte.js";
import { tokensStore } from "../lib/stores/tokensStore.svelte.js";
import { walletStore } from "../lib/stores/walletStore.svelte.js";
import { deferred, FROM, TO, makeComparison } from "./quote-fixture.js";
const get = vi.hoisted(() => vi.fn());
vi.mock("../lib/api.js", () => ({ apiClient: { GET: get } }));
const tokens = [
  { address: FROM, symbol: "USDC", name: "USD Coin", chainId: 1, decimals: 6 },
  { address: TO, symbol: "ZERO", name: "Zero decimal token", chainId: 1, decimals: 0 },
];
beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
  formStore.fromToken = null;
  formStore.toToken = null;
  formStore.chainId = 1;
  formStore.isLoading = false;
  formStore.sellAmount = "";
  formStore.receiveAmount = "";
  formStore.mode = "exactIn";
  tokenListStore.lists = [];
  tokenListStore.localTokens = [];
  tokensStore.allTokens = [];
  walletStore.disconnect();
  configStore.defaultTokens = {};
  vi.spyOn(tokensStore, "fetchIfNeeded").mockResolvedValue();
  get.mockReset().mockImplementation(async (path, options) => {
    if (path === "/token-metadata")
      return { data: tokens.find((token) => token.address === options.params.query.address) };
    if (path === "/compare") return { data: makeComparison() };
    return { data: { tokens: [] } };
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("App startup", () => {
  it.each(["config first", "token list first"])(
    "resolves configured defaults with %s",
    async (order) => {
      const config = deferred<undefined>();
      const lists = deferred<undefined>();
      vi.spyOn(configStore, "init").mockImplementation(async () => {
        await config.promise;
        configStore.defaultTokens = { "1": { from: FROM, to: TO } };
      });
      vi.spyOn(tokenListStore, "init").mockImplementation(async () => {
        await lists.promise;
        tokenListStore.lists = [{ url: null, name: "Default", enabled: true, tokens }];
      });
      localStorage.setItem("compare-dex-settings", JSON.stringify({ mevEnabled: true }));
      const { getByText } = render(App);
      expect(getByText("Compare DEX Routers")).toBeTruthy();
      if (order === "config first") {
        config.resolve(undefined);
        await waitFor(() => expect(formStore.fromToken?.decimals).toBe(6));
        lists.resolve(undefined);
      } else {
        lists.resolve(undefined);
        await waitFor(() => expect(tokenListStore.allTokens).toHaveLength(2));
        config.resolve(undefined);
      }
      await waitFor(() => expect(formStore.canSubmit).toBe(true));
      expect(formStore.fromToken).toMatchObject({ address: FROM, decimals: 6 });
      expect(formStore.toToken).toMatchObject({ address: TO, decimals: 0 });
      expect(localStorage.getItem("compare-dex-settings")).toBeNull();
    }
  );
});
