import type { Page } from "@playwright/test";
import { FROM, TO, makeComparison } from "../packages/frontend/src/__tests__/quote-fixture.js";
export async function fixture(page: Page) {
  const tokens = [
    { chainId: 1, address: FROM, name: "USD Coin", symbol: "USDC", decimals: 6 },
    { chainId: 1, address: TO, name: "Tether USD", symbol: "USDT", decimals: 6 },
  ];
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        chains: { "1": { name: "Ethereum", alchemySubdomain: "eth-mainnet" } },
        defaultTokens: { "1": { from: FROM, to: TO } },
        flags: { curve_enabled: true, compare_endpoint: true },
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
  await page.route("**/api/compare?**", (route) => {
    const comparison = makeComparison();
    if (!new URL(route.request().url()).searchParams.get("sender")) {
      for (const quote of [comparison.spandex, comparison.curve]) {
        if (quote) {
          quote.sender = null;
          quote.execution = null;
        }
      }
    }
    return route.fulfill({ json: comparison });
  });
}
