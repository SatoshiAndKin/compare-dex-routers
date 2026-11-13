import { test, expect } from "@playwright/test";
import { fixture } from "./fixtures.js";
import { FROM, TO } from "../packages/frontend/src/__tests__/quote-fixture.js";

const YFI = "0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e";

test("keeps token fields compact with one full address and a working copy button", async ({
  page,
  context,
  browserName,
}, info) => {
  const tokens = [
    { chainId: 1, address: FROM, name: "USD Coin", symbol: "USDC", decimals: 6 },
    { chainId: 1, address: YFI, name: "yearn.finance", symbol: "YFI", decimals: 18 },
  ];
  await fixture(page, (comparison) => {
    for (const quote of comparison.quotes) {
      quote.to_symbol = "YFI";
      quote.output_amount = "0.75";
      quote.output_amount_raw = "750000000000000000";
    }
  });
  await page.route("**/api/tokenlist", (route) =>
    route.fulfill({ json: { tokens, tokenlists: [{ name: "Default", tokens }] } })
  );
  await page.route("**/api/token-metadata?**", (route) =>
    route.fulfill({
      json: tokens.find(
        (token) =>
          token.address.toLowerCase() ===
          new URL(route.request().url()).searchParams.get("address")?.toLowerCase()
      ),
    })
  );
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  } else {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            sessionStorage.setItem("copied-token-address", text);
          },
        },
      });
    });
  }
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto(`/?chainId=1&from=${FROM}&to=${YFI}&amount=1500&slippageBps=50`);
  await expect(page.locator("#receive-amount")).toHaveValue("0.75");
  await page.screenshot({ path: info.outputPath("token-fields.png"), fullPage: true });
  const spacing = await page.locator(".token-pair").evaluate((pair) => {
    const sections = [...pair.querySelectorAll(":scope > .form-section")].map((node) =>
      node.getBoundingClientRect()
    );
    const first = sections[0];
    const second = sections[1];
    const swap = pair.querySelector(".swap-tokens")?.getBoundingClientRect();
    const toggle = document.querySelector(".mode-toggle-row")?.getBoundingClientRect();
    if (!first || !second || !swap || !toggle) throw new Error("Missing token controls");
    return {
      gaps: [swap.top - first.bottom, second.top - swap.bottom],
      beforeAmounts: toggle.y - second.bottom,
      fields: sections.map((rect) => rect.height),
    };
  });
  await info.attach("token-spacing", {
    body: JSON.stringify(spacing),
    contentType: "application/json",
  });
  await expect(page.getByRole("textbox", { name: "From token", exact: true })).toHaveValue("USDC");
  await expect(page.getByRole("textbox", { name: "To token", exact: true })).toHaveValue("YFI");
  for (const [side, address] of [
    ["from", FROM],
    ["to", YFI],
  ] as const) {
    const button = page.getByRole("button", { name: `Copy ${side} token address`, exact: true });
    const row = button.locator("..");
    await expect(row.locator(".selected-token-address")).toHaveText(address);
    await expect(page.locator(".token-pair").getByText(address, { exact: true })).toHaveCount(1);
    const size = await button.boundingBox();
    if (!size) throw new Error("Missing copy button");
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
    await button.click();
    await expect(button).toHaveText("Copied");
    const clipboard = await page.evaluate(
      async (native) =>
        native ? navigator.clipboard.readText() : sessionStorage.getItem("copied-token-address"),
      browserName === "chromium"
    );
    expect(clipboard).toBe(address);
  }
  expect(Math.max(...spacing.fields)).toBeLessThanOrEqual(132);
  expect(spacing.beforeAmounts).toBeLessThanOrEqual(16);
  if ((page.viewportSize()?.width ?? 0) <= 600) {
    expect(Math.min(...spacing.gaps)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...spacing.gaps)).toBeLessThanOrEqual(16);
  }
  await expect(page.locator(".balance-slot")).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 0) <= 600) {
    await page.setViewportSize({ width: 320, height: 844 });
    for (const address of [FROM, YFI]) {
      const text = page.locator(".selected-token-address").filter({ hasText: address });
      expect(await text.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true
      );
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("swaps the selected tokens and requests a quote for the reverse pair", async ({ page }) => {
  await fixture(page);
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=150&mode=targetOut`);
  const from = page.getByRole("textbox", { name: "From token", exact: true });
  const to = page.getByRole("textbox", { name: "To token", exact: true });
  const swap = page.getByRole("button", { name: "Swap tokens", exact: true });
  await expect(from).toHaveValue("USDC");
  await expect(to).toHaveValue("USDT");
  await expect(page.getByRole("button", { name: "Compare Quotes", exact: true })).toBeEnabled();

  const reversedQuote = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/api/quote" &&
      url.searchParams.get("from") === TO &&
      url.searchParams.get("to") === FROM
    );
  });
  await swap.click();
  await expect(from).toHaveValue("USDT");
  await expect(to).toHaveValue("USDC");
  await expect(page.getByRole("spinbutton", { name: "YOU RECEIVE USDC" })).toHaveValue("150");
  const params = new URL((await reversedQuote).url()).searchParams;
  expect(params.get("amount")).toBe("150");
  expect(params.get("mode")).toBe("targetOut");

  await page.getByRole("button", { name: "Clear to token", exact: true }).click();
  await expect(swap).toBeDisabled();
});

test("keeps fields and amounts fixed when addresses appear and clear", async ({ page }, info) => {
  await fixture(page);
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}`);
  const from = page.getByRole("textbox", { name: "From token", exact: true });
  const to = page.getByRole("textbox", { name: "To token", exact: true });
  await expect(from).toHaveValue("USDC");
  await expect(to).toHaveValue("USDT");
  await page.evaluate(() => document.fonts.ready);

  const positions = () =>
    page.locator(".compare-form").evaluate((form) =>
      [...form.querySelectorAll(".token-pair > div, .mode-toggle-row, .amount-fields")].map(
        (element) => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top + window.scrollY, height: rect.height };
        }
      )
    );
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("The address layout check requires a viewport");
  for (const width of viewport.width <= 600 ? [viewport.width, 320] : [viewport.width]) {
    await page.setViewportSize({ width, height: viewport.height });
    await page.getByRole("button", { name: "Clear from token", exact: true }).click();
    await page.getByRole("button", { name: "Clear to token", exact: true }).click();
    await expect(from).toHaveValue("");
    await expect(to).toHaveValue("");
    const empty = await positions();
    expect(empty).toHaveLength(4);
    await page.screenshot({ path: info.outputPath(`empty-addresses-${width}.png`) });

    for (const [input, symbol, address] of [
      [from, "USDC", FROM],
      [to, "USDT", TO],
    ] as const) {
      await input.fill(symbol);
      await page.getByRole("option").filter({ hasText: address }).click();
      await expect(input).toHaveValue(symbol);
      expect(await positions()).toEqual(empty);
    }
    await page.screenshot({ path: info.outputPath(`selected-addresses-${width}.png`) });
    await page.getByRole("button", { name: "Clear from token", exact: true }).click();
    expect(await positions()).toEqual(empty);
    await page.getByRole("button", { name: "Clear to token", exact: true }).click();
    expect(await positions()).toEqual(empty);

    // Restore both fields before checking the next viewport.
    await from.fill("USDC");
    await page.getByRole("option").filter({ hasText: FROM }).click();
    await to.fill("USDT");
    await page.getByRole("option").filter({ hasText: TO }).click();
  }
});
