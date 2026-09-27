import { describe, expect, it } from "vitest";
import { canQuoteWallet, mergePreview } from "../lib/quote-preview.js";
import { makeComparison, makeQuote, FROM, TO, SENDER } from "./quote-fixture.js";

describe("preview prices", () => {
  it.each([".", "1e3", "-1", "0"])(
    "keeps invalid input %s from crashing balance selection",
    (amount) => {
      expect(
        canQuoteWallet(
          {
            chainId: 1,
            from: FROM,
            to: TO,
            sender: SENDER,
            amount,
            mode: "exactIn",
            slippageBps: 50,
          },
          100000000n,
          6
        )
      ).toBe(false);
    }
  );
  it("compares native-sized quantities beyond Number precision without rounding", () => {
    const params = {
      chainId: 1,
      from: FROM,
      to: TO,
      sender: SENDER,
      amount: "9007199254740993.000000000000000001",
      mode: "exactIn" as const,
      slippageBps: 50,
    };
    const required = 9007199254740993000000000000000001n;
    expect(canQuoteWallet(params, required - 1n, 18)).toBe(false);
    expect(canQuoteWallet(params, required, 18)).toBe(true);
    expect(canQuoteWallet({ ...params, sender: undefined }, required, 18)).toBe(false);
  });
  it.each(["exactIn", "targetOut"] as const)(
    "ranks combined unverified %s prices using raw amounts",
    (mode) => {
      const preview = makeComparison({
        mode,
        quotes: [
          makeQuote({
            provider: "curve",
            sender: null,
            execution: null,
            simulation_status: "not_run",
            input_amount_raw: "9007199254740993",
            output_amount_raw: "9007199254740993",
          }),
        ],
      });
      const wallet = makeComparison({
        mode,
        quotes: [
          makeQuote({
            provider: "0x",
            execution: null,
            simulation_status: "failed",
            input_amount_raw: "9007199254740994",
            output_amount_raw: "9007199254740994",
          }),
        ],
      });
      const result = mergePreview(preview, wallet);
      expect(result.recommendation).toBe(mode === "exactIn" ? "0x" : "curve");
      expect(result.recommendation_basis).toBe("raw_amount");
      expect(result.recommendation_reason).toContain("unverified");
    }
  );
  it("prefers the wallet price even after simulation failure", () => {
    const result = mergePreview(
      makeComparison(),
      makeComparison({
        quotes: [
          makeQuote({ output_amount_raw: "42", simulation_status: "failed", execution: null }),
        ],
      })
    );
    expect(result.quotes.find((quote) => quote.provider === "0x")?.output_amount_raw).toBe("42");
  });
});

it("keeps server ordering for verified routes and raw ordering for all retained prices", () => {
  const wallet = makeComparison({
    mode: "targetOut",
    recommendation: "curve",
    quotes: [
      makeQuote({ provider: "curve", input_amount_raw: "30" }),
      makeQuote({ provider: "0x", input_amount_raw: "20" }),
      makeQuote({
        provider: "relay",
        simulation_status: "failed",
        execution: null,
        input_amount_raw: "10",
      }),
    ],
  });
  const preview = makeComparison({
    mode: "targetOut",
    quotes: [
      makeQuote({
        provider: "kyberswap",
        sender: null,
        execution: null,
        simulation_status: "not_run",
        input_amount_raw: "1",
      }),
    ],
  });
  const result = mergePreview(preview, wallet);
  expect(result.quotes.map((quote) => quote.provider)).toEqual([
    "curve",
    "0x",
    "kyberswap",
    "relay",
  ]);
  expect(result.recommendation).toBe("curve");
  expect(result.recommendation_basis).toBe("gas_adjusted");
});
