import { cleanup, fireEvent, render, within } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { formatUnits } from "viem";
import SettingsModal from "../lib/components/SettingsModal.svelte";
import { settingsStore } from "../lib/stores/settingsStore.svelte.js";
import VenueComparison from "../lib/components/VenueComparison.svelte";
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
  const feeRaw = (3900000000n * BigInt(Math.round(Number(fee) * 10_000))) / 1_000_000n;
  const outputRaw = 3900000000n - feeRaw;
  return {
    data: {
      status: "ready",
      product_id: "ETH-USDC",
      side: "SELL" as const,
      input_symbol: "ETH",
      output_symbol: "USDC",
      input_amount: "2",
      output_amount: formatUnits(outputRaw, 6),
      input_amount_raw: "2000000000000000000",
      output_amount_raw: outputRaw.toString(),
      input_decimals: 18,
      output_decimals: 6,
      fee_percent: fee,
      fee_amount: fee === null ? null : formatUnits(feeRaw, 6),
      fee_symbol: "USDC",
      as_of: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30000).toISOString(),
      limit_only: false,
      trade_url: "https://www.coinbase.com/advanced-trade/spot/ETH-USDC",
    },
  };
}
const quote = () =>
  makeQuote({
    from: params.from,
    to: params.to,
    amount: "2",
    from_symbol: "ETH",
    to_symbol: "USDC",
    input_amount: "2",
    input_amount_raw: "2000000000000000000",
    output_amount: "3800",
    output_amount_raw: "3800000000",
  });
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

describe("Venue price comparison", () => {
  it("shows a before-fee estimate and an external link without wallet actions when the fee is cleared", async () => {
    localStorage.setItem(
      "compare-dex-preferences",
      JSON.stringify({ chains: {}, coinbaseTakerFeePercent: "" })
    );
    const view = render(VenueComparison, {
      params,
      quotes: [quote()],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    const link = await view.findByRole("link", { name: "Open Coinbase Advanced ↗" });
    expect(link).toHaveAttribute("href", "https://www.coinbase.com/advanced-trade/spot/ETH-USDC");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(view.getByText("Before trading fees")).toBeVisible();
    expect(view.getByText(/Excludes deposits, withdrawals/)).not.toBeVisible();
    await fireEvent.click(view.getByRole("button", { name: "About the Coinbase estimate" }));
    expect(view.getByRole("region", { name: "Coinbase Advanced estimate" })).toHaveTextContent(
      /Sell\s*2 ETH Buy\s*3900 USDC/
    );
    expect(view.getByRole("group", { name: "Coinbase average trade price" })).toHaveTextContent(
      "1 ETH = 1950 USDC"
    );
    expect(view.getByText("1 USDC = 0.000512821 ETH")).toBeVisible();
    expect(view.queryByRole("textbox")).toBeNull();
    expect(view.getByText(/Excludes deposits, withdrawals/)).toBeVisible();
    expect(view.getByRole("img", { name: "Better quoted price" })).toHaveTextContent("⭐");
    expect(view.queryByRole("button", { name: /swap|approve/i })).toBeNull();
  });
  it("applies and saves a fee and clears the star when quotes become stale", async () => {
    const view = render(VenueComparison, {
      params,
      quotes: [quote()],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    await view.findByRole("link", { name: "Open Coinbase Advanced ↗" });
    settingsStore.openSettings();
    const settings = render(SettingsModal);
    await fireEvent.input(settings.getByLabelText("Your taker fee (%)"), {
      target: { value: "1" },
    });
    await fireEvent.click(settings.getByRole("button", { name: "Save fee" }));
    await fireEvent.click(settings.getByRole("button", { name: "Close settings" }));
    expect(await view.findByText("Assumed fee 1%")).toBeVisible();
    expect(view.getByRole("img", { name: "Better quoted price" })).toBeVisible();
    expect(
      JSON.parse(localStorage.getItem("compare-dex-preferences") ?? "{}").coinbaseTakerFeePercent
    ).toBe("1");
    await view.rerender({
      params,
      quotes: [quote()],
      stale: true,
      dexExpiresAt: Date.now() + 30_000,
    });
    expect(view.queryByRole("img", { name: /^(Better|Tied) quoted price$/ })).toBeNull();
    expect(view.queryByText("% less received", { exact: false })).toBeNull();
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
    const view = render(VenueComparison, {
      params: target,
      quotes: [makeQuote({ ...target, input_amount_raw: "4300000000" })],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    const dex = view.getByRole("region", { name: "DEX router quotes" });
    expect(await within(dex).findByRole("img", { name: "Better quoted price" })).toBeVisible();
    expect(view.getByRole("group", { name: "Coinbase average trade price" })).toHaveTextContent(
      "1 ETH = 4343 USDC"
    );
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
      const view = render(VenueComparison, {
        params: trade,
        quotes: [working, failed],
        stale: false,
        dexExpiresAt: Date.now() + 30_000,
      });
      const coinbase = view.getByRole("region", { name: "Coinbase Advanced estimate" });
      expect(
        await within(coinbase).findByRole("img", { name: "Better quoted price" })
      ).toBeVisible();
    }
  );
  it("does not compare Coinbase with a set containing only failed simulations", async () => {
    get.mockResolvedValueOnce(reply("1"));
    const view = render(VenueComparison, {
      params,
      quotes: [makeQuote({ ...quote(), simulation_status: "failed", execution: null })],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    await view.findByRole("link", { name: "Open Coinbase Advanced ↗" });
    expect(view.queryByRole("img", { name: /^(Better|Tied) quoted price$/ })).toBeNull();
  });
  it("shows unsupported pairs and upstream outages without hiding DEX data", async () => {
    get.mockResolvedValueOnce({
      data: { status: "unavailable", reason: "No supported direct market." },
    });
    const view = render(VenueComparison, {
      params,
      quotes: [quote()],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    expect(await view.findByText("No supported direct market.")).toBeVisible();
    get.mockRejectedValueOnce(new Error("offline"));
    await fireEvent.click(view.getByRole("button", { name: "Refresh estimate" }));
    expect(await view.findByText("Coinbase estimate unavailable.")).toBeVisible();
    expect(view.queryByRole("link")).toBeNull();
  });
  it("keeps the last estimate visible when its refresh fails", async () => {
    const view = render(VenueComparison, {
      params,
      quotes: [quote()],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    const link = await view.findByRole("link", { name: "Open Coinbase Advanced ↗" });
    expect(view.getByRole("img", { name: "Better quoted price" })).toBeVisible();
    get.mockResolvedValueOnce({
      data: { status: "unavailable", reason: "Coinbase market data is unavailable." },
    });
    await fireEvent.click(view.getByRole("button", { name: "Refresh estimate" }));
    expect(await view.findByText("Refresh failed · Previous estimate")).toBeVisible();
    expect(link).toBeVisible();
    expect(view.getByText("1 ETH = 1932.45 USDC")).toBeVisible();
    expect(view.queryByRole("img", { name: /^(Better|Tied) quoted price$/ })).toBeNull();
  });
  it("discards old requests after a trade change and cancels on invalidation", async () => {
    const old = deferred<ReturnType<typeof reply>>();
    get.mockReturnValueOnce(old.promise);
    const view = render(VenueComparison, {
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
    await view.findByRole("link", { name: "Open Coinbase Advanced ↗" });
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
    const view = render(VenueComparison, { params, quotes, stale: false, dexExpiresAt });
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(view.getByRole("img", { name: "Better quoted price" })).toBeVisible();
    await vi.advanceTimersByTimeAsync(61_000);
    await fireEvent.click(view.getByRole("button", { name: "Refresh estimate" }));
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(get).toHaveBeenCalledTimes(2);
    await fireEvent.click(view.getByRole("button", { name: "About the Coinbase estimate" }));
    expect(view.getByText("Includes an assumed 1% fee (39 USDC).")).toBeVisible();
    expect(view.queryByText("Estimate expired.")).toBeNull();
    expect(view.queryByRole("img", { name: /^(Better|Tied) quoted price$/ })).toBeNull();
    expect(view.getByText("DEX quotes expired.")).toBeVisible();
    await view.rerender({ params, quotes, stale: false, dexExpiresAt: Date.now() + 30_000 });
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(view.getByRole("img", { name: "Better quoted price" })).toBeVisible();
    expect(view.queryByText("DEX quotes expired.")).toBeNull();
  });
});

describe("Venue price winners and mobile availability", () => {
  it.each([
    ["exactIn", "4000000000", "Coinbase Advanced", "5% less received"],
    ["exactIn", "3700000000", "DEX routers", "2.63% less received"],
    ["exactIn", "3799999999", "DEX routers", "<0.01% less received"],
    ["targetOut", "1900000000000000000", "Coinbase Advanced", "5.26% more paid"],
    ["targetOut", "2100000000000000000", "DEX routers", "5% more paid"],
  ] as const)(
    "marks the better %s price when Coinbase quotes %s",
    async (mode, amount, venue, difference) => {
      const response = reply("0");
      if (mode === "exactIn") {
        response.data.output_amount_raw = amount;
        response.data.output_amount = formatUnits(BigInt(amount), 6);
      } else {
        response.data.input_amount_raw = amount;
        response.data.input_amount = formatUnits(BigInt(amount), 18);
      }
      get.mockResolvedValueOnce(response);
      const trade = { ...params, mode };
      const view = render(VenueComparison, {
        params: trade,
        quotes: [
          makeQuote({
            ...quote(),
            ...trade,
            input_amount_raw: "2000000000000000000",
            output_amount_raw: "3800000000",
          }),
        ],
        stale: false,
        dexExpiresAt: Date.now() + 30_000,
      });
      const star = await view.findByRole("img", { name: "Better quoted price" });
      expect(star).toHaveTextContent("⭐");
      expect(view.getByRole("heading", { name: `${venue} Better quoted price` })).toContainElement(
        star
      );
      const dex = view.getByRole("region", { name: "DEX router quotes" });
      const coinbase = view.getByRole("region", { name: "Coinbase Advanced estimate" });
      expect(dex.parentElement).toBe(coinbase.parentElement);
      const [better, worse] = venue === "DEX routers" ? [dex, coinbase] : [coinbase, dex];
      expect(within(worse).getByText(difference)).toBeVisible();
      expect(within(better).queryByText(difference)).toBeNull();
    }
  );
  it("marks both venue headings when prices tie", async () => {
    const response = reply("0");
    response.data.output_amount_raw = "3800000000";
    response.data.output_amount = "3800";
    get.mockResolvedValueOnce(response);
    const view = render(VenueComparison, {
      params,
      quotes: [quote()],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    expect(await view.findAllByRole("img", { name: "Tied quoted price" })).toHaveLength(2);
    expect(view.queryByText("% less received", { exact: false })).toBeNull();
    for (const venue of ["DEX routers", "Coinbase Advanced"]) {
      const heading = view.getByRole("heading", { name: `${venue} Tied quoted price` });
      expect(within(heading).getByRole("img", { name: "Tied quoted price" })).toHaveTextContent(
        "⭐"
      );
    }
  });
  it("does not claim mobile trading support from a ready public book", async () => {
    const response = reply();
    Object.assign(response.data, { product_id: "YFI-USDC", side: "BUY", output_symbol: "YFI" });
    get.mockResolvedValueOnce(response);
    const view = render(VenueComparison, {
      params,
      quotes: [quote()],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    await view.findByRole("link", { name: "Open Coinbase Advanced ↗" });
    await fireEvent.click(view.getByRole("button", { name: "About the Coinbase estimate" }));
    expect(view.getByText("Mobile trading not verified")).toBeVisible();
    expect(
      view.getByText(/does not confirm that your account can buy YFI in the YFI-USDC market/)
    ).toBeVisible();
    expect(
      view.getByRole("link", { name: "About Advanced in the Coinbase app ↗" })
    ).toHaveAttribute("href", expect.stringContaining("help.coinbase.com"));
  });
  it.each([
    { chainId: 8453 },
    { from: "0x1111111111111111111111111111111111111111" },
    { to: "0x1111111111111111111111111111111111111111" },
    { mode: "targetOut" as const },
    { amount: "3" },
  ])("does not compare a retained DEX quote from another request: %o", async (mismatch) => {
    get.mockResolvedValueOnce(reply("0"));
    const view = render(VenueComparison, {
      params,
      quotes: [makeQuote({ ...quote(), ...mismatch })],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    await view.findByRole("link", { name: "Open Coinbase Advanced ↗" });
    expect(view.queryByRole("img", { name: /^(Better|Tied) quoted price$/ })).toBeNull();
  });

  it("marks expired estimates and removes their price comparison", async () => {
    const expired = reply("1");
    expired.data.expires_at = new Date(Date.now() - 1000).toISOString();
    get.mockResolvedValueOnce(expired);
    const view = render(VenueComparison, {
      params,
      quotes: [quote()],
      stale: false,
      dexExpiresAt: Date.now() + 30_000,
    });
    expect(await view.findByText("Estimate expired.")).toBeVisible();
    expect(view.queryByRole("img", { name: /^(Better|Tied) quoted price$/ })).toBeNull();
  });
});
