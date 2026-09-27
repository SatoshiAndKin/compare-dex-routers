import { test, expect } from "@playwright/test";
import { fixture } from "./fixtures.js";
import { deferred } from "../packages/frontend/src/__tests__/quote-fixture.js";

const CRV = "0xD533a949740bb3306d119CC777fa900bA034cd52";
const CRVUSD = "0xf939e0a03fb07f59a73314e73794be0e57ac1b4e";
const amount = "4161.636507410085088097";
const output = "1454.297535508463832644";

test("keeps precise input and output together through metadata and quote loading", async ({
  page,
}, info) => {
  const metadata = deferred<boolean>();
  await fixture(page, (comparison) => {
    for (const quote of comparison.quotes) {
      quote.from_symbol = "CRV";
      quote.to_symbol = "crvUSD";
      quote.input_amount = amount;
      quote.output_amount = output;
      quote.input_amount_raw = "4161636507410085088097";
      quote.output_amount_raw = "1454297535508463832644";
    }
  });
  const tokens = [
    { chainId: 1, address: CRV, symbol: "CRV", name: "Curve", decimals: 18 },
    { chainId: 1, address: CRVUSD, symbol: "crvUSD", name: "Curve USD", decimals: 18 },
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
    page.locator(".amount-fields").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top + window.scrollY, width: rect.width, height: rect.height };
    });
  const before = await positions();
  metadata.resolve(true);
  await expect(receive).toHaveValue(output);
  expect(await positions()).toEqual(before);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("The responsive layout check requires a viewport");
  for (const selector of [".token-pair", ".amount-fields", ".quote-amounts"]) {
    const groups = page.locator(
      `${selector} > ${selector === ".amount-fields" ? ".amount-group" : "div"}`
    );
    const first = await groups.nth(0).boundingBox();
    const second = await groups.nth(1).boundingBox();
    if (!first || !second) throw new Error(`Both fields in ${selector} must be visible`);
    if (viewport.width <= 600) {
      expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
      expect(second.x).toBe(first.x);
      expect(first.width).toBeGreaterThan(viewport.width * 0.8);
    } else {
      expect(second.y).toBe(first.y);
      expect(second.x).toBeGreaterThanOrEqual(first.x + first.width);
      expect(second.x - first.x - first.width).toBeLessThanOrEqual(16);
    }
  }
  await expect(page.locator(".input-amount")).toHaveText(`${amount} CRV`);
  await expect(page.locator(".output-amount")).toHaveText(`${output} crvUSD`);
  const next = deferred<boolean>();
  await page.route("**/api/quote?**", async (route) => {
    await next.promise;
    await route.fallback();
  });
  await page.getByRole("button", { name: "Compare Quotes", exact: true }).click();
  await expect(page.getByRole("status", { name: "Quote loading status" })).toContainText(
    "Refreshing quotes"
  );
  await expect(receive).toHaveValue(output);
  expect(await positions()).toEqual(before);
  next.resolve(true);
  await expect(page.getByRole("button", { name: "Compare Quotes", exact: true })).toBeEnabled();
  await page.locator("details.provider-list summary").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.screenshot({ path: info.outputPath("compact-trade.png"), fullPage: true });
});
