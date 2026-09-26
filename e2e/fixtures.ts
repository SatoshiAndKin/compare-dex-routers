import { parseUnits } from "viem";
import type { Page } from "@playwright/test";
import { FROM, TO, makeComparison } from "../packages/frontend/src/__tests__/quote-fixture.js";
export async function fixture(
  page: Page,
  transform?: (comparison: ReturnType<typeof makeComparison>) => void
) {
  const tokens = [
    { chainId: 1, address: FROM, name: "USD Coin", symbol: "USDC", decimals: 6 },
    { chainId: 1, address: TO, name: "Tether USD", symbol: "USDT", decimals: 6 },
    {
      chainId: 1,
      address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      name: "Wrapped Ether",
      symbol: "WETH",
      decimals: 18,
    },
  ];
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        chains: { "1": { name: "Ethereum", alchemySubdomain: "eth-mainnet" } },
        defaultTokens: { "1": { from: FROM, to: TO } },
        flags: { curve_enabled: true, metrics_enabled: false },
        nativeAssets: {
          "1": {
            chainId: 1,
            address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
            symbol: "ETH",
            name: "Ether",
            decimals: 18,
          },
        },
        walletConnectProjectId: "",
      },
    })
  );
  await page.route("**/api/tokenlist", (route) =>
    route.fulfill({ json: { name: "Default", tokens, tokenlists: [{ name: "Default", tokens }] } })
  );
  await page.route("https://tokens.uniswap.org/**", (route) =>
    route.fulfill({ json: { name: "Uniswap", tokens: [] } })
  );
  await page.route("**/api/token-metadata?**", (route) => {
    const address = new URL(route.request().url()).searchParams.get("address");
    return route.fulfill({
      json: tokens.find((token) => token.address.toLowerCase() === address?.toLowerCase()),
    });
  });
  await page.route("**/api/quote?**", (route) => {
    const comparison = makeComparison();
    const params = new URL(route.request().url()).searchParams;
    for (const quote of comparison.quotes) {
      quote.from = params.get("from") ?? FROM;
      quote.to = params.get("to") ?? TO;
      quote.amount = params.get("amount") ?? "100";
      quote.mode = params.get("mode") === "targetOut" ? "targetOut" : "exactIn";
      comparison.mode = quote.mode;
      quote.sender = params.get("sender");
      const native = quote.from.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
      quote.from_symbol = native ? "ETH" : "USDC";
      quote.input_amount = quote.amount;
      quote.input_amount_raw = parseUnits(quote.amount, native ? 18 : 6).toString();
      if (quote.execution) {
        quote.execution.value = native ? quote.input_amount_raw : "0";
        if (native) quote.execution.approval = null;
      }
    }
    if (!new URL(route.request().url()).searchParams.get("sender")) {
      for (const quote of comparison.quotes) {
        if (quote) {
          quote.sender = null;
          quote.execution = null;
        }
      }
    }
    transform?.(comparison);
    return route.fulfill({ json: comparison });
  });
}
