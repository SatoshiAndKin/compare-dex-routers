import { test, expect } from "@playwright/test";
import { FROM, TO, SENDER } from "../packages/frontend/src/__tests__/quote-fixture.js";

import { fixture } from "./fixtures.js";
import { installWallet } from "./wallet.js";

test("opens the chain dropdown and selects Base and Arbitrum", async ({ page, hasTouch }) => {
  await fixture(page);
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100`);
  const chain = page.getByRole("button", { name: /^(Ethereum|Base|Arbitrum) \(\d+\)$/ });
  const dropdown = page.getByRole("listbox", { name: "Supported chains" });
  const compare = page.getByRole("button", { name: "Compare Quotes", exact: true });
  await expect(compare).toBeEnabled();

  for (const network of ["Base (8453)", "Arbitrum (42161)"]) {
    const position = await compare.boundingBox();
    if (hasTouch) await chain.tap();
    else await chain.click();
    await expect(dropdown.getByRole("option")).toHaveCount(7);
    await expect(dropdown.getByRole("textbox", { name: "Search chains" })).toBeVisible();
    expect(await compare.boundingBox()).toEqual(position);
    const option = dropdown.getByRole("option", { name: network, exact: true });
    if (hasTouch) await option.tap();
    else await option.click();
    await expect(chain).toHaveAccessibleName(network);
    await expect(dropdown).toBeHidden();
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`retro trade form and settings work in ${theme} mode`, async ({ page }, info) => {
    await fixture(page);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100`);
    await expect(page.getByRole("heading", { name: "Compare DEX Routers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Compare Quotes", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Compare Quotes", exact: true }).click();
    await expect(page.getByText("Via 0x", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.screenshot({ path: info.outputPath(`trade-${theme}.png`), fullPage: true });
    await page.getByRole("button", { name: "Open settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(
      settings.getByText("Enabled lists update once per day while this page is open.")
    ).toBeVisible();
    await expect(settings.getByRole("button", { name: "Close settings" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(settings.getByRole("link", { name: "Read Flashbots Protect docs" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(settings.getByRole("button", { name: "Close settings" })).toBeFocused();
    await settings.getByRole("button", { name: "Refresh token lists" }).click();
    await expect(settings.getByText(/Last list update:/)).toBeVisible();
    await page.screenshot({ path: info.outputPath(`settings-${theme}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    expect(await page.locator("#sell-amount").inputValue()).toBe("100");
  });
}

for (const injected of [false, true]) {
  test(`embedded wallet menu supports regular wallets (injected: ${injected})`, async ({
    page,
  }) => {
    await fixture(page);
    if (injected) await installWallet(page, 1, SENDER, async () => "0x0");
    await page.route("**/test-host", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<iframe title="Trade app" src="/"></iframe>',
      })
    );
    await page.goto("/test-host");
    const app = page.frameLocator('iframe[title="Trade app"]');
    await app.getByRole("button", { name: /Connect Wallet/i, exact: true }).click();
    const providers = app.getByRole("list", { name: "Available wallet providers" });
    await expect(providers.getByRole("button")).toHaveCount(injected ? 1 : 0);
    if (injected) {
      await providers.getByRole("button", { name: "Connect with Local fork wallet" }).click();
      await expect(app.getByTitle("Connected wallet address")).toHaveText(SENDER);
    } else {
      await expect(
        providers.getByText(
          "No wallets detected. Install a browser wallet extension to get started."
        )
      ).toBeVisible();
    }
  });
}

test("native ETH precedes WETH and survives missing token lists", async ({ page }) => {
  await fixture(page);
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100`);
  await page.getByRole("textbox", { name: "From token", exact: true }).fill("eth");
  const options = page.getByRole("option");
  await expect(options.first()).toContainText("ETH");
  await expect(options.first()).toContainText("Native");
  await expect(options.filter({ hasText: "WETH" })).toBeVisible();
  await options.first().click();
  await expect(page.getByRole("textbox", { name: "From token", exact: true })).toHaveValue("ETH");
  await expect(page).toHaveURL(/from=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE/);
  await page.route("**/api/tokenlist", (route) =>
    route.fulfill({ json: { tokens: [], tokenlists: [] } })
  );
  await page.reload();
  await expect(page.getByRole("textbox", { name: "From token", exact: true })).toHaveValue("ETH");
});
