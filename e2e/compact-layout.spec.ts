import { test, expect } from "@playwright/test";
import { fixture } from "./fixtures.js";
import { deferred } from "../packages/frontend/src/__tests__/quote-fixture.js";

const CRV = "0xD533a949740bb3306d119CC777fa900bA034cd52";
const CRVUSD = "0xf939e0a03fb07f59a73314e73794be0e57ac1b4e";
const amount = "4161.636507410085088097";
const output = "1454.297535508463832644";
const sellSymbol = "WRAPPED-LONG-STAKE-CRV";
const buySymbol = "VAULT-LONG-STAKE-crvUSD";

test("keeps precise input and output together through metadata and quote loading", async ({
  page,
}, info) => {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("The responsive layout check requires a viewport");
  if (viewport.width < 600) await page.setViewportSize({ width: 320, height: viewport.height });
  const metadata = deferred<boolean>();
  await fixture(page, (comparison) => {
    for (const quote of comparison.quotes) {
      quote.from_symbol = sellSymbol;
      quote.to_symbol = buySymbol;
      quote.input_amount = amount;
      quote.output_amount = output;
      quote.input_amount_raw = "4161636507410085088097";
      quote.output_amount_raw = "1454297535508463832644";
    }
  });
  const tokens = [
    { chainId: 1, address: CRV, symbol: sellSymbol, name: "Curve", decimals: 18 },
    { chainId: 1, address: CRVUSD, symbol: buySymbol, name: "Curve USD", decimals: 18 },
  ];
  await page.route("**/api/tokenlist", async (route) => {
    await metadata.promise;
    await route.fulfill({ json: { tokens, tokenlists: [{ name: "Default", tokens }] } });
  });
  await page.route("**/api/token-metadata?**", async (route) => {
    await metadata.promise;
    const address = new URL(route.request().url()).searchParams.get("address");
    await route.fulfill({
      json: tokens.find((token) => token.address.toLowerCase() === address?.toLowerCase()),
    });
  });
  await page.goto(`/?chainId=1&from=${CRV}&to=${CRVUSD}&amount=${amount}&slippageBps=3`);
  const sell = page.locator("#sell-amount");
  const receive = page.locator("#receive-amount");
  await expect(sell).toHaveValue(amount);
  const positions = () =>
    page
      .locator(
        ".amount-fields, .trade-options button, .amount-group, .swap-tokens, .swap-summary, .swap-actions button"
      )
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return [rect.left, rect.top + window.scrollY, rect.width, rect.height];
        })
      );
  const before = await positions();
  metadata.resolve(true);
  await expect(receive).toHaveValue(output);
  expect(await positions()).toEqual(before);
  const sellPanel = page.locator(".amount-group").nth(0);
  const buyPanel = page.locator(".amount-group").nth(1);
  const swap = page.getByRole("button", { name: "Swap tokens" });
  const sellBox = await sellPanel.boundingBox();
  const buyBox = await buyPanel.boundingBox();
  const swapBox = await swap.boundingBox();
  if (!sellBox || !buyBox || !swapBox) throw new Error("Missing swap panel");
  expect(sellBox.x).toBe(buyBox.x);
  expect(sellBox.width).toBe(buyBox.width);
  expect(buyBox.y - sellBox.y - sellBox.height).toBeLessThanOrEqual(4);
  expect(swapBox.y).toBeGreaterThanOrEqual(buyBox.y + buyBox.height);
  expect(swapBox.width).toBeGreaterThanOrEqual(44);
  expect(swapBox.height).toBeGreaterThanOrEqual(44);
  expect(sellBox.height).toBe(90);
  expect(buyBox.height).toBe(90);
  expect(swapBox.y - buyBox.y - buyBox.height).toBeLessThanOrEqual(4);
  expect((await page.locator(".swap-summary").boundingBox())?.height).toBe(44);
  for (const [panel, side, symbol] of [
    [sellPanel, "From", sellSymbol],
    [buyPanel, "To", buySymbol],
  ] as const) {
    const value = await panel.getByRole("spinbutton").boundingBox();
    const token = await panel.getByRole("textbox", { name: `${side} token` }).boundingBox();
    if (!value || !token) throw new Error("Missing amount or token picker");
    expect(value.y).toBeGreaterThanOrEqual(token.y + token.height);
    expect(value.width).toBeGreaterThan(token.width);
    expect(value.height).toBeGreaterThanOrEqual(44);
    expect(token.height).toBeGreaterThanOrEqual(44);
    const label = panel.locator(".selected-symbol");
    await expect(label).toHaveText(symbol);
    expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true
    );
  }
  const connect = page.getByRole("button", { name: "Connect wallet", exact: true });
  await expect(connect).toBeInViewport({ ratio: 1 });
  expect(await connect.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true
  );
  const chainText = page.locator(".chain-button-text");
  expect(await chainText.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true
  );
  const rate = page.getByRole("group", { name: "Exchange rate", exact: true });
  await expect(rate).toBeVisible();
  await expect(rate).toHaveText(`1 ${sellSymbol} ≈ 0.349453 ${buySymbol}`);
  await expect(rate.getByRole("button")).toHaveCount(0);
  expect(await positions()).toEqual(before);
  const slippage = page.getByRole("button", { name: "Edit slippage" });
  await slippage.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("spinbutton", { name: "Custom slippage in basis points" })
  ).toBeVisible();
  expect(await positions()).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(slippage).toBeFocused();
  await expect(
    page.getByRole("spinbutton", { name: "Custom slippage in basis points" })
  ).toBeHidden();
  const dex = page.getByRole("region", { name: "DEX router quotes" });
  for (const [index, value, symbol] of [
    [0, amount, sellSymbol],
    [1, output, buySymbol],
  ] as const) {
    const total = dex.locator(".amounts strong").nth(index);
    await expect(total).toHaveText(`${value} ${symbol}`);
    const valueBox = await total.getByText(value, { exact: true }).boundingBox();
    const symbolBox = await total.getByText(symbol, { exact: true }).boundingBox();
    if (!valueBox || !symbolBox) throw new Error("Missing quote amount or symbol");
    expect(symbolBox.y).toBeGreaterThanOrEqual(valueBox.y + valueBox.height);
  }
  const rates = dex.getByRole("group", { name: "DEX average trade price" });
  await expect(rates).toContainText(`1 ${sellSymbol} = 0.349453 ${buySymbol}`);
  const route = page.getByRole("region", { name: "Selected DEX route" });
  await expect(route.getByText(output, { exact: true })).toHaveCount(0);
  await expect(route.getByRole("group", { name: /trade price/ })).toHaveCount(0);
  const totalsBox = await dex.locator(".amounts").boundingBox();
  const ratesBox = await rates.boundingBox();
  if (!totalsBox || !ratesBox) throw new Error("Quote totals and rates must be visible");
  expect(ratesBox.y).toBeGreaterThanOrEqual(totalsBox.y + totalsBox.height);
  const next = deferred<boolean>();
  await page.route("**/api/quote?**", async (route) => {
    await next.promise;
    await route.fallback();
  });
  const dexControls = () =>
    dex
      .getByRole("button", { name: "About DEX prices" })
      .or(dex.getByRole("button", { name: "Refresh DEX quotes" }))
      .or(dex.getByRole("link", { name: "Review DEX route ↓" }))
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return [rect.left, rect.top + window.scrollY, rect.width, rect.height];
        })
      );
  const controlsBeforeRefresh = await dexControls();
  expect(controlsBeforeRefresh).toHaveLength(3);
  const refresh = dex.getByRole("button", { name: "Refresh DEX quotes" });
  const status = dex.getByRole("status", { name: "Quote loading status" });
  const timer = dex.getByRole("timer", { name: "DEX auto-refresh" });
  await refresh.click();
  await expect(status).toHaveText("Refreshing…");
  await expect(refresh).toBeDisabled();
  await expect(timer).toHaveText("…");
  await expect(receive).toHaveValue(output);
  expect(await positions()).toEqual(before);
  expect(await dexControls()).toEqual(controlsBeforeRefresh);
  next.resolve(true);
  await expect(timer).toHaveText(/^\d+s$/);
  await expect(refresh).toBeEnabled();
  expect(await dexControls()).toEqual(controlsBeforeRefresh);
  await expect(page.getByRole("button", { name: "Compare Quotes", exact: true })).toBeEnabled();
  await page.locator("details.provider-list summary").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.screenshot({ path: info.outputPath("compact-trade.png"), fullPage: true });
});
