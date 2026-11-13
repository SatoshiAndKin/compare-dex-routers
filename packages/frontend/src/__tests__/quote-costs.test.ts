import { describe, expect, it } from "vitest";
import { formatUsd, quoteCostFields } from "../lib/quote-costs.js";
import { makeQuote } from "./quote-fixture.js";

describe("USD display", () => {
  it.each([
    ["0", "$0.00"],
    ["0.000001", "<$0.01"],
    ["-0.000001", "−<$0.01"],
    ["-1.125", "−$1.13"],
    ["999.999", "$1,000.00"],
    ["0.01", "$0.01"],
    ["9007199254740993.01", "$9,007,199,254,740,993.01"],
    [null, "USD unavailable"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatUsd(value)).toBe(expected);
  });
  it.each(["exactIn", "targetOut"] as const)(
    "keeps the %s comparison row when USD becomes unavailable",
    (mode) => {
      const quote = makeQuote({ mode, net_value_usd: null, gas_cost_usd: null });
      expect(quoteCostFields(quote, "gas_adjusted", true)).toEqual([
        ["Estimated gas cost", "USD unavailable"],
        ["Required approval gas cost", "None needed"],
        [
          mode === "exactIn"
            ? "Estimated output value after gas"
            : "Estimated input cost including gas",
          "USD unavailable",
        ],
      ]);
    }
  );
  it("prompts for a wallet on preview-only gas rows while disconnected", () => {
    const quote = makeQuote({
      sender: null,
      simulation_status: "not_run",
      gas_cost_native: null,
      approval_gas_used: null,
      approval_gas_cost_native: null,
    });
    const costs = (connected: boolean) =>
      quoteCostFields(quote, "raw_amount", connected).map(([, value]) => value);
    expect(costs(false)).toEqual(["Connect wallet", "Connect wallet"]);
    expect(costs(true)).toEqual(["Unavailable", "Unavailable"]);
  });
});
