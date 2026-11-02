import { describe, expect, it } from "vitest";
import { formatQuoteRate } from "../lib/quote-rates.js";

describe("formatQuoteRate", () => {
  it("shows the full-purchase BAL price and its inverse", () => {
    expect(formatQuoteRate("1257.7", "10000")).toBe("0.12577");
    expect(formatQuoteRate("10000", "1257.7")).toBe("7.95102");
  });

  it("uses token amounts with different decimal scales", () => {
    expect(formatQuoteRate("3000.123456", "1.000000000000000001")).toBe("3000.12");
  });

  it("keeps small rates nonzero and supports very large rates", () => {
    expect(formatQuoteRate("0.000000000000000001", "1000000")).toBe("0.000000000000000000000001");
    expect(formatQuoteRate("1000000", "0.000000000000000001")).toBe("1000000000000000000000000");
  });

  it("rounds recurring fractions and carry boundaries", () => {
    expect(formatQuoteRate("1", "3")).toBe("0.333333");
    expect(formatQuoteRate("2", "3")).toBe("0.666667");
    expect(formatQuoteRate("0.9999999", "1")).toBe("1");
    expect(formatQuoteRate("9999999", "1")).toBe("10000000");
  });

  it("does not lose precision before rounding", () => {
    expect(formatQuoteRate("1234564999999999999999999", "1000000000000000000000000")).toBe(
      "1.23456"
    );
  });

  it.each(["0", "0.000", "-1", "", "NaN", "Infinity", "1e3"])(
    "rejects unavailable or invalid amounts: %s",
    (amount) => {
      expect(formatQuoteRate(amount, "1")).toBeNull();
      expect(formatQuoteRate("1", amount)).toBeNull();
    }
  );
});
