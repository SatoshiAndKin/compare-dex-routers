import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import SettingsModal from "../lib/components/SettingsModal.svelte";
import { settingsStore } from "../lib/stores/settingsStore.svelte.js";
import CoinbaseEstimate from "../lib/components/CoinbaseEstimate.svelte";
import type { CompareParams } from "../lib/stores/comparisonStore.svelte.js";
import { deferred, makeQuote } from "./quote-fixture.js";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../lib/api.js", () => ({ apiClient: { GET: get } }));
const params: CompareParams = {
  chainId: 1,
  from: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  amount: "2",
  mode: "exactIn",
  slippageBps: 50,
};
function reply(fee: string | null = null) {
  return {
    data: {
      status: "ready",
      product_id: "ETH-USDC",
      side: "SELL",
      input_symbol: "ETH",
      output_symbol: "USDC",
      input_amount: "2",
      output_amount: fee === null ? "3900" : "3861",
      input_amount_raw: "2000000000000000000",
      output_amount_raw: fee === null ? "3900000000" : "3861000000",
      input_decimals: 18,
      output_decimals: 6,
      fee_percent: fee,
      fee_amount: fee === null ? null : "39",
      fee_symbol: "USDC",
      as_of: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30000).toISOString(),
      limit_only: false,
      trade_url: "https://www.coinbase.com/advanced-trade/spot/ETH-USDC",
    },
  };
}
const quote = () =>
  makeQuote({ from: params.from, to: params.to, amount: "2", output_amount_raw: "3800000000" });
beforeEach(() => {
  localStorage.clear();
  settingsStore.closeSettings();
  get.mockReset();
  get.mockImplementation((_path, options) =>
    Promise.resolve(reply(options.params.query.takerFeePercent ?? null))
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Coinbase estimate panel", () => {
  it("shows a before-fee estimate and an external link without wallet actions", async () => {
    const view = render(CoinbaseEstimate, {
      params,
      quotes: [quote()],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    const link = await view.findByRole("link", { name: "Open Coinbase Advanced ↗" });
    expect(link).toHaveAttribute("href", "https://www.coinbase.com/advanced-trade/spot/ETH-USDC");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(view.getByText(/Before trading fees;/)).toBeVisible();
    expect(view.getByText("2 ETH → 3900 USDC")).toBeVisible();
    expect(view.getByRole("group", { name: "Coinbase average trade price" })).toHaveTextContent(
      "1 ETH = 1950 USDC"
    );
    expect(view.getByRole("group")).toHaveTextContent("1 USDC = 0.000512821 ETH");
    expect(view.queryByRole("textbox")).toBeNull();
    expect(view.getByText(/Excludes deposits, withdrawals/)).toBeVisible();
    expect(view.queryByText(/than the best DEX/)).toBeNull();
    expect(view.queryByRole("button", { name: /swap|approve/i })).toBeNull();
  });
  it("applies and saves a fee and compares amounts without transfer-cost claims", async () => {
    const view = render(CoinbaseEstimate, {
      params,
      quotes: [quote()],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    await view.findByRole("link");
    settingsStore.openSettings();
    const settings = render(SettingsModal);
    await fireEvent.input(settings.getByLabelText("Your taker fee (%)"), {
      target: { value: "1" },
    });
    await fireEvent.click(settings.getByRole("button", { name: "Save fee" }));
    await fireEvent.click(settings.getByRole("button", { name: "Close settings" }));
    expect(
      await view.findByText("61 USDC more output than the best DEX price before gas and transfers.")
    ).toBeVisible();
    expect(view.getByText("Includes an assumed 1% fee (39 USDC).")).toBeVisible();
    expect(
      JSON.parse(localStorage.getItem("compare-dex-preferences") ?? "{}").coinbaseTakerFeePercent
    ).toBe("1");
    await view.rerender({
      params,
      quotes: [quote()],
      stale: true,
      dexExpiresAt: Date.now() + 30_000,
    });
    expect(view.queryByText(/than the best DEX/)).toBeNull();
  });
  it("compares input costs for a target-output buy", async () => {
    const target = {
      ...params,
      from: params.to,
      to: params.from,
      amount: "1",
      mode: "targetOut" as const,
    };
    const response = reply("1");
    Object.assign(response.data, {
      input_symbol: "USDC",
      output_symbol: "ETH",
      input_amount: "4343",
      output_amount: "1",
      input_amount_raw: "4343000000",
      output_amount_raw: "1000000000000000000",
      input_decimals: 6,
      output_decimals: 18,
    });
    get.mockResolvedValueOnce(response);
    const view = render(CoinbaseEstimate, {
      params: target,
      quotes: [makeQuote({ ...target, input_amount_raw: "4300000000" })],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    expect(
      await view.findByText(
        "43 USDC more input required than the best DEX price before gas and transfers."
      )
    ).toBeVisible();
    expect(view.getByRole("group")).toHaveTextContent("1 ETH = 4343 USDC");
  });
  it.each(["exactIn", "targetOut"] as const)(
    "excludes failed simulations from the %s DEX comparison",
    async (mode) => {
      localStorage.setItem(
        "compare-dex-preferences",
        JSON.stringify({ chains: {}, coinbaseTakerFeePercent: "1" })
      );
      const trade = { ...params, mode, amount: mode === "exactIn" ? "2" : "3861" };
      const working = makeQuote({
        ...trade,
        output_amount_raw: "3800000000",
        input_amount_raw: "2100000000000000000",
        simulation_status: "succeeded",
      });
      const failed = makeQuote({
        ...trade,
        provider: "reverted",
        output_amount_raw: "4000000000",
        input_amount_raw: "1900000000000000000",
        simulation_status: "failed",
        simulation_reason: "execution reverted",
        execution: null,
      });
      const view = render(CoinbaseEstimate, {
        params: trade,
        quotes: [working, failed],
        stale: false,
        dexExpiresAt: Date.now() + 30_000,
      });
      const expected =
        mode === "exactIn"
          ? "61 USDC more output than the best DEX price before gas and transfers."
          : "0.1 ETH less input required than the best DEX price before gas and transfers.";
      expect(await view.findByText(expected)).toBeVisible();
    }
  );
  it("does not compare Coinbase with a set containing only failed simulations", async () => {
    get.mockResolvedValueOnce(reply("1"));
    const view = render(CoinbaseEstimate, {
      params,
      quotes: [makeQuote({ ...quote(), simulation_status: "failed", execution: null })],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    await view.findByRole("link");
    expect(view.queryByText(/than the best DEX/)).toBeNull();
  });
  it("shows unsupported pairs and upstream outages without hiding DEX data", async () => {
    get.mockResolvedValueOnce({
      data: { status: "unavailable", reason: "No supported direct market." },
    });
    const view = render(CoinbaseEstimate, {
      params,
      quotes: [quote()],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    expect(await view.findByText("No supported direct market.")).toBeVisible();
    get.mockRejectedValueOnce(new Error("offline"));
    await fireEvent.click(view.getByRole("button", { name: "Refresh estimate" }));
    expect(await view.findByText("Coinbase estimate unavailable. Refresh to retry.")).toBeVisible();
    expect(view.queryByRole("link")).toBeNull();
  });
  it("discards old requests after a trade change and cancels on invalidation", async () => {
    const old = deferred<ReturnType<typeof reply>>();
    get.mockReturnValueOnce(old.promise);
    const view = render(CoinbaseEstimate, {
      params,
      quotes: [],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    await tick();
    const signal = get.mock.calls[0]?.[1].signal as AbortSignal;
    await view.rerender({
      params: { ...params, amount: "3" },
      quotes: [],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    await view.findByRole("link");
    expect(signal.aborted).toBe(true);
    const late = reply();
    late.data.output_amount = "9999";
    old.resolve(late);
    await tick();
    expect(view.queryByText(/9999/)).toBeNull();
    await view.rerender({
      params: null,
      quotes: [],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    expect(view.queryByRole("region")).toBeNull();
    expect(get.mock.lastCall?.[1].signal.aborted).toBe(true);
  });
  it("keeps expired DEX quotes out of the comparison when only Coinbase refreshes", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    localStorage.setItem(
      "compare-dex-preferences",
      JSON.stringify({ chains: {}, coinbaseTakerFeePercent: "1" })
    );
    const dexExpiresAt = Date.now() + 30_000;
    const quotes = [quote()];
    const view = render(CoinbaseEstimate, { params, quotes, stale: false, dexExpiresAt });
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(
      view.getByText("61 USDC more output than the best DEX price before gas and transfers.")
    ).toBeVisible();
    await vi.advanceTimersByTimeAsync(61_000);
    await fireEvent.click(view.getByRole("button", { name: "Refresh estimate" }));
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(get).toHaveBeenCalledTimes(2);
    expect(view.getByText("Includes an assumed 1% fee (39 USDC).")).toBeVisible();
    expect(view.queryByText("Estimate expired. Refresh before comparing prices.")).toBeNull();
    expect(view.queryByText(/than the best DEX/)).toBeNull();
    expect(view.getByText("DEX quotes expired. Refresh quotes to compare prices.")).toBeVisible();
    await view.rerender({ params, quotes, stale: false, dexExpiresAt: Date.now() + 30_000 });
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(
      view.getByText("61 USDC more output than the best DEX price before gas and transfers.")
    ).toBeVisible();
    expect(view.queryByText("DEX quotes expired. Refresh quotes to compare prices.")).toBeNull();
  });
  it("marks expired estimates and removes their price comparison", async () => {
    const expired = reply("1");
    expired.data.expires_at = new Date(Date.now() - 1000).toISOString();
    get.mockResolvedValueOnce(expired);
    const view = render(CoinbaseEstimate, {
      params,
      quotes: [quote()],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    expect(
      await view.findByText("Estimate expired. Refresh before comparing prices.")
    ).toBeVisible();
    expect(view.queryByText(/than the best DEX/)).toBeNull();
  });
});
