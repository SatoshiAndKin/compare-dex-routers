import { test, expect } from "@playwright/test";
import { fixture } from "./fixtures.js";
import { FROM } from "../packages/frontend/src/__tests__/quote-fixture.js";

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
    const sections = [...pair.children].map((node) => node.getBoundingClientRect());
    const first = sections[0];
    const second = sections[1];
    const last = pair.lastElementChild?.getBoundingClientRect();
    const toggle = document.querySelector(".mode-toggle-row")?.getBoundingClientRect();
    if (!first || !second || !last || !toggle) throw new Error("Missing token fields");
    return {
      between: second.y - first.bottom,
      beforeAmounts: toggle.y - last.bottom,
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
  if ((page.viewportSize()?.width ?? 0) <= 600) expect(spacing.between).toBeLessThanOrEqual(16);
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
