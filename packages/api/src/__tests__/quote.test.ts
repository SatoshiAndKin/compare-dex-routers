import { describe, it, expect } from "vitest";
import { parseQuoteParams, isValidAddress } from "../quote.js";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH_BASE = "0x4200000000000000000000000000000000000006";

function makeParams(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

describe("isValidAddress", () => {
  it("accepts valid checksummed address", () => {
    expect(isValidAddress(USDC_BASE)).toBe(true);
  });

  it("accepts valid lowercase address", () => {
    expect(isValidAddress(USDC_BASE.toLowerCase())).toBe(true);
  });

  it("accepts valid uppercase address", () => {
    expect(isValidAddress("0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913")).toBe(true);
  });

  it("rejects address without 0x prefix", () => {
    expect(isValidAddress("833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")).toBe(false);
  });

  it("rejects short address", () => {
    expect(isValidAddress("0x123")).toBe(false);
  });

  it("rejects long address", () => {
    expect(isValidAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA0291300")).toBe(false);
  });

  it("rejects address with invalid characters", () => {
    expect(isValidAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA0291G")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidAddress("")).toBe(false);
  });

  it("rejects token symbol", () => {
    expect(isValidAddress("USDC")).toBe(false);
  });
});

describe("parseQuoteParams", () => {
  it("parses valid params", () => {
    const result = parseQuoteParams(
      makeParams({
        chainId: "8453",
        from: USDC_BASE,
        to: WETH_BASE,
        amount: "1000",
        slippageBps: "100",
      })
    );
    expect(result).toEqual({
      success: true,
      data: {
        chainId: 8453,
        from: USDC_BASE,
        to: WETH_BASE,
        amount: "1000",
        slippageBps: 100,
        sender: undefined,
        mode: "exactIn",
      },
    });
  });

  it("uses default slippageBps of 50", () => {
    const result = parseQuoteParams(
      makeParams({ chainId: "8453", from: USDC_BASE, to: WETH_BASE, amount: "1" })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slippageBps).toBe(50);
    }
  });

  it("parses sender when provided", () => {
    const sender = "0xEe7aE85f2Fe2239E27D9c1E23fFFe168D63b4055";
    const result = parseQuoteParams(
      makeParams({
        chainId: "8453",
        from: USDC_BASE,
        to: WETH_BASE,
        amount: "1",
        sender,
      })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sender).toBe(sender);
    }
  });

  it("rejects missing chainId", () => {
    const result = parseQuoteParams(makeParams({ from: USDC_BASE, to: WETH_BASE, amount: "1" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("chainId");
    }
  });

  it("rejects invalid chainId", () => {
    const result = parseQuoteParams(
      makeParams({ chainId: "abc", from: USDC_BASE, to: WETH_BASE, amount: "1" })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Invalid chainId");
    }
  });

  it("rejects negative chainId", () => {
    const result = parseQuoteParams(
      makeParams({ chainId: "-1", from: USDC_BASE, to: WETH_BASE, amount: "1" })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Invalid chainId");
    }
  });

  it("rejects unsupported chainId", () => {
    const result = parseQuoteParams(
      makeParams({ chainId: "999", from: USDC_BASE, to: WETH_BASE, amount: "1" })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Unsupported chainId");
    }
  });

  it("rejects missing from param", () => {
    const result = parseQuoteParams(makeParams({ chainId: "8453", to: WETH_BASE, amount: "1" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Missing required params");
    }
  });

  it("rejects missing to param", () => {
    const result = parseQuoteParams(makeParams({ chainId: "8453", from: USDC_BASE, amount: "1" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Missing required params");
    }
  });

  it("rejects invalid from address", () => {
    const result = parseQuoteParams(
      makeParams({ chainId: "8453", from: "USDC", to: WETH_BASE, amount: "1" })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Invalid 'from' address");
    }
  });

  it("rejects invalid to address", () => {
    const result = parseQuoteParams(
      makeParams({ chainId: "8453", from: USDC_BASE, to: "WETH", amount: "1" })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Invalid 'to' address");
    }
  });

  it("rejects missing amount", () => {
    const result = parseQuoteParams(
      makeParams({ chainId: "8453", from: USDC_BASE, to: WETH_BASE })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Missing required param: amount");
    }
  });

  it("rejects negative amount", () => {
    const result = parseQuoteParams(
      makeParams({ chainId: "8453", from: USDC_BASE, to: WETH_BASE, amount: "-100" })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Invalid amount");
    }
  });

  it("rejects zero amount", () => {
    const result = parseQuoteParams(
      makeParams({ chainId: "8453", from: USDC_BASE, to: WETH_BASE, amount: "0" })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Invalid amount");
    }
  });

  it("rejects non-numeric amount", () => {
    const result = parseQuoteParams(
      makeParams({ chainId: "8453", from: USDC_BASE, to: WETH_BASE, amount: "abc" })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Invalid amount");
    }
  });

  it("accepts decimal amount", () => {
    const result = parseQuoteParams(
      makeParams({ chainId: "8453", from: USDC_BASE, to: WETH_BASE, amount: "0.5" })
    );
    expect(result).toEqual({
      success: true,
      data: {
        chainId: 8453,
        from: USDC_BASE,
        to: WETH_BASE,
        amount: "0.5",
        slippageBps: 50,
        sender: undefined,
        mode: "exactIn",
      },
    });
  });

  it("parses mode=targetOut", () => {
    const result = parseQuoteParams(
      makeParams({
        chainId: "8453",
        from: USDC_BASE,
        to: WETH_BASE,
        amount: "1",
        mode: "targetOut",
      })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("targetOut");
    }
  });

  it("defaults mode to exactIn", () => {
    const result = parseQuoteParams(
      makeParams({ chainId: "8453", from: USDC_BASE, to: WETH_BASE, amount: "1" })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("exactIn");
    }
  });

  it("ignores invalid mode and defaults to exactIn", () => {
    const result = parseQuoteParams(
      makeParams({
        chainId: "8453",
        from: USDC_BASE,
        to: WETH_BASE,
        amount: "1",
        mode: "invalid",
      })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("exactIn");
    }
  });

  it("rejects slippageBps over 10000", () => {
    const result = parseQuoteParams(
      makeParams({
        chainId: "8453",
        from: USDC_BASE,
        to: WETH_BASE,
        amount: "1",
        slippageBps: "10001",
      })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Invalid slippageBps");
    }
  });

  it("rejects negative slippageBps", () => {
    const result = parseQuoteParams(
      makeParams({
        chainId: "8453",
        from: USDC_BASE,
        to: WETH_BASE,
        amount: "1",
        slippageBps: "-1",
      })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Invalid slippageBps");
    }
  });

  it("rejects invalid sender address", () => {
    const result = parseQuoteParams(
      makeParams({
        chainId: "8453",
        from: USDC_BASE,
        to: WETH_BASE,
        amount: "1",
        sender: "notanaddress",
      })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Invalid sender address");
    }
  });
});
