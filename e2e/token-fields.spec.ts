import { test, expect } from "@playwright/test";
import { parseUnits } from "viem";
import { fixture } from "./fixtures.js";
import { deferred, FROM, TO } from "../packages/frontend/src/__tests__/quote-fixture.js";

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
  await expect(page.getByRole("textbox", { name: "From token", exact: true })).toHaveValue("USDC");
  await expect(page.getByRole("textbox", { name: "To token", exact: true })).toHaveValue("YFI");
  for (const [side, address] of [
    ["from", FROM],
    ["to", YFI],
  ] as const) {
    if (browserName === "chromium") await page.mouse.move(0, 0);
    await expect(page.getByText(address, { exact: true })).toBeHidden();
    await page
      .getByRole("button", { name: side === "from" ? "Sell token details" : "Buy token details" })
      .click();
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
    await page.keyboard.press("Escape");
  }
  if ((page.viewportSize()?.width ?? 0) <= 600) {
    await page.setViewportSize({ width: 320, height: 844 });
    for (const [side, address] of [
      ["Sell", FROM],
      ["Buy", YFI],
    ] as const) {
      const trigger = page.getByRole("button", { name: `${side} token details` });
      await page.keyboard.press("Escape");
      await trigger.click();
      const text = page.getByText(address, { exact: true });
      await expect(text).toBeVisible();
      expect(await text.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true
      );
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const mode of ["exactIn", "targetOut"] as const) {
  test(`swaps tokens and the displayed ${mode} amounts while the reverse quote loads`, async ({
    page,
  }) => {
    const sellAmount = mode === "exactIn" ? "150" : "150.25";
    const buyAmount = mode === "exactIn" ? "149.75" : "150";
    const reverseQuote = deferred<undefined>();
    await fixture(page, (comparison) => {
      for (const quote of comparison.quotes) {
        if (quote.from === FROM) {
          quote.input_amount = sellAmount;
          quote.output_amount = buyAmount;
        } else {
          quote.input_amount = mode === "exactIn" ? "150.5" : buyAmount;
          quote.output_amount = mode === "targetOut" ? "150.75" : sellAmount;
        }
        quote.input_amount_raw = parseUnits(quote.input_amount, 6).toString();
        quote.output_amount_raw = parseUnits(quote.output_amount, 6).toString();
      }
    });
    await page.route("**/api/quote?**", async (route) => {
      if (new URL(route.request().url()).searchParams.get("from") === TO)
        await reverseQuote.promise;
      await route.fallback();
    });
    await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=150&mode=${mode}`);
    const from = page.getByRole("textbox", { name: "From token", exact: true });
    const to = page.getByRole("textbox", { name: "To token", exact: true });
    const swap = page.getByRole("button", { name: "Swap tokens", exact: true });
    await expect(from).toHaveValue("USDC");
    await expect(to).toHaveValue("USDT");
    const sell = page.locator("#sell-amount");
    const buy = page.locator("#receive-amount");
    await expect(sell).toHaveValue(sellAmount);
    await expect(buy).toHaveValue(buyAmount);
    const compare = page.getByRole("button", { name: "Compare Quotes", exact: true });
    const position = () =>
      Promise.all([swap.boundingBox(), page.locator(".submit-btn").boundingBox()]);
    const before = await position();

    const reversedQuote = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === "/api/quote" &&
        url.searchParams.get("from") === TO &&
        url.searchParams.get("to") === FROM
      );
    });
    try {
      await swap.click();
      await expect(from).toHaveValue("USDT");
      await expect(to).toHaveValue("USDC");
      await expect(sell).toHaveValue(buyAmount);
      await expect(buy).toHaveValue(sellAmount);
      await expect(page.getByText("Previous amount", { exact: true })).toBeVisible();
      expect(await position()).toEqual(before);
      const params = new URL((await reversedQuote).url()).searchParams;
      expect(params.get("amount")).toBe("150");
      expect(params.get("mode")).toBe(mode === "exactIn" ? "targetOut" : "exactIn");
    } finally {
      reverseQuote.resolve(undefined);
    }
    await expect(sell).toHaveValue(mode === "exactIn" ? "150.5" : buyAmount);
    await expect(buy).toHaveValue(mode === "targetOut" ? "150.75" : sellAmount);
    await expect(page.getByText("Previous amount", { exact: true })).toHaveCount(0);
    await expect(compare).toBeEnabled();
    expect(await position()).toEqual(before);

    await page.getByRole("button", { name: "Buy token details" }).click();
    await page.getByRole("button", { name: "Clear to token", exact: true }).click();
    await expect(swap).toBeDisabled();
  });
}

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
    if (await page.getByRole("button", { name: "Sell token details" }).isVisible()) {
      await page.getByRole("button", { name: "Sell token details" }).click();
      await page.getByRole("button", { name: "Clear from token", exact: true }).click();
    }
    if (await page.getByRole("button", { name: "Buy token details" }).isVisible())
      await page.getByRole("button", { name: "Buy token details" }).click();
    if (await page.getByRole("button", { name: "Clear to token", exact: true }).isVisible())
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
    if (await page.getByRole("button", { name: "Sell token details" }).isVisible()) {
      await page.getByRole("button", { name: "Sell token details" }).click();
      await page.getByRole("button", { name: "Clear from token", exact: true }).click();
    }
    expect(await positions()).toEqual(empty);
    if (await page.getByRole("button", { name: "Buy token details" }).isVisible())
      await page.getByRole("button", { name: "Buy token details" }).click();
    if (await page.getByRole("button", { name: "Clear to token", exact: true }).isVisible())
      await page.getByRole("button", { name: "Clear to token", exact: true }).click();
    expect(await positions()).toEqual(empty);

    // Restore both fields before checking the next viewport.
    await from.fill("USDC");
    await page.getByRole("option").filter({ hasText: FROM }).click();
    await to.fill("USDT");
    await page.getByRole("option").filter({ hasText: TO }).click();
  }
});
