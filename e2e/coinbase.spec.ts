import { test, expect } from "@playwright/test";
import { fixture } from "./fixtures.js";
import { FROM, TO } from "../packages/frontend/src/__tests__/quote-fixture.js";

test("shows a fee-adjusted Coinbase estimate without changing the selected DEX", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/api/coinbase-estimate?**", (route) => {
    const fee = new URL(route.request().url()).searchParams.get("takerFeePercent");
    return route.fulfill({
      json: {
        status: "ready",
        product_id: "USDT-USDC",
        side: "BUY",
        input_symbol: "USDC",
        output_symbol: "USDT",
        input_amount: "100",
        output_amount: fee === null ? "100" : "99.9",
        input_amount_raw: "100000000",
        output_amount_raw: fee === null ? "100000000" : "99900000",
        input_decimals: 6,
        output_decimals: 6,
        fee_percent: fee,
        fee_amount: fee === null ? null : "0.1",
        fee_symbol: "USDC",
        as_of: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30000).toISOString(),
        limit_only: true,
        trade_url: "https://www.coinbase.com/advanced-trade/spot/USDT-USDC",
      },
    });
  });
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100&slippageBps=50`);
  const panel = page.getByRole("region", { name: "Coinbase Advanced estimate" });
  await expect(panel.getByText(/Before trading fees;/)).toBeVisible();
  await expect(panel).toContainText("This market accepts limit orders only.");
  await panel.getByLabel("Your taker fee (%)").fill("0.1");
  await panel.getByRole("button", { name: "Apply fee" }).click();
  await expect(panel).toContainText("Includes an assumed 0.1% fee");
  await expect(panel).toContainText(
    "0.08 USDT less output than the best DEX price before gas and transfers."
  );
  const link = panel.getByRole("link", { name: "Open Coinbase Advanced ↗" });
  await expect(link).toHaveAttribute(
    "href",
    "https://www.coinbase.com/advanced-trade/spot/USDT-USDC"
  );
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(panel.getByRole("button", { name: /swap|approve/i })).toHaveCount(0);
  await expect(page.getByText("Via 0x", { exact: true })).toBeVisible();
  await page.reload();
  await expect(panel.getByLabel("Your taker fee (%)")).toHaveValue("0.1");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(overflow).toBe(false);
});
