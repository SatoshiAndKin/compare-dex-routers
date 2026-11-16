import { test, expect } from "@playwright/test";
import { FROM, TO, SENDER } from "../packages/frontend/src/__tests__/quote-fixture.js";

import { fixture } from "./fixtures.js";
import { installWallet } from "./wallet.js";

test("uses one trailing chevron for pickers and disclosures", async ({ page }) => {
  await fixture(page, (comparison) => {
    comparison.failures.push({
      provider: "velora",
      stage: "quote",
      error: { name: "Error", message: "Test quote unavailable", code: "UNAVAILABLE" },
    });
  });
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100`);
  const assertChevron = async (trigger: ReturnType<typeof page.locator>, open: boolean) => {
    const icon = trigger.locator(".disclosure-chevron");
    await expect(icon).toHaveCount(1);
    await expect(icon.locator("path")).toHaveAttribute("d", "m4 6 4 4 4-4");
    await expect(icon).toHaveCSS("transform", open ? "matrix(-1, 0, 0, -1, 0, 0)" : "none");
    const bounds = await trigger.boundingBox();
    const arrow = await icon.boundingBox();
    if (!bounds || !arrow) throw new Error("Missing disclosure control");
    expect(bounds.x + bounds.width - (arrow.x + arrow.width)).toBeLessThanOrEqual(16);
  };

  const routeDetails = page.getByRole("button", { name: "Details", exact: true });
  const providers = page.locator(".provider-list > summary");
  const failure = page.locator(".provider-failure > summary");
  await expect(providers).toHaveCSS("list-style-type", "none");
  const chain = page.locator(".chain-button");
  await assertChevron(chain, false);
  await chain.press("Enter");
  await expect(chain).toHaveAttribute("aria-expanded", "true");
  await assertChevron(chain, true);
  await page.keyboard.press("Escape");
  await assertChevron(chain, false);

  for (const disclosure of [routeDetails, providers, failure]) {
    await assertChevron(disclosure, false);
    await disclosure.press("Enter");
    await assertChevron(disclosure, true);
    if (disclosure !== providers) {
      await disclosure.press("Enter");
      await assertChevron(disclosure, false);
    }
  }
  await providers.press("Enter");
  await assertChevron(providers, false);

  const token = page.getByRole("combobox", { name: "From token" });
  const tokenPicker = page.locator(".token-input-field").filter({ has: token });
  await assertChevron(tokenPicker, false);
  await token.fill("eth");
  await expect(page.getByRole("option").first()).toBeVisible();
  await assertChevron(tokenPicker, true);
  await token.press("Escape");
  await assertChevron(tokenPicker, false);
});

test("filters the chain dropdown immediately and keeps it inside a short viewport", async ({
  page,
  hasTouch,
}) => {
  await page.setViewportSize({ width: hasTouch ? 320 : 860, height: 440 });
  await fixture(page);
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100`);
  const chain = page.getByRole("button", { name: /^(Ethereum|Base|Arbitrum)$/ });
  const search = page.getByRole("combobox", { name: "Search chains" });
  const dropdown = page.getByRole("listbox", { name: "Supported chains" });
  const compare = page.getByRole("button", { name: "Compare Quotes", exact: true });
  await expect(compare).toBeEnabled();

  for (const [name, id, query] of [
    ["Base", "8453", "8453"],
    ["Arbitrum", "42161", "arbi"],
  ]) {
    await expect(chain).toBeInViewport({ ratio: 1 });
    const scrollY = await page.evaluate(() => window.scrollY);
    const position = await compare.boundingBox();
    if (hasTouch) await chain.tap();
    else await chain.click();
    await expect(search).toBeFocused();
    await expect(dropdown.getByRole("option")).toHaveCount(7);
    await expect(page.locator(".chain-selector .dropdown-panel")).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("ArrowUp");
    const last = dropdown.getByRole("option").last();
    await expect(last).toBeInViewport({ ratio: 0.97 });
    await expect(search).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
    expect(await compare.boundingBox()).toEqual(position);
    await page.keyboard.type(query);
    const option = dropdown.getByRole("option", { name: `${name} (${id})`, exact: true });
    await expect(dropdown.getByRole("option")).toHaveCount(1);
    if (hasTouch) await option.tap();
    else await page.keyboard.press("Enter");
    await expect(chain).toHaveAccessibleName(name);
    await expect(dropdown).toBeHidden();
  }

  await chain.click();
  await page.keyboard.type("8453");
  await page.keyboard.press("Tab");
  await expect(dropdown).toBeHidden();
  await expect(chain).toHaveAccessibleName("Arbitrum");
});

test("both token dropdowns filter immediately from the selected label", async ({
  page,
  hasTouch,
}) => {
  await fixture(page);
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100`);

  for (const [label, listLabel, query, symbol] of [
    ["From token", "Sell tokens", "wrapped", "WETH"],
    ["To token", "Receive tokens", "usd coin", "USDC"],
  ]) {
    const input = page.getByRole("combobox", { name: label });
    const list = page.getByRole("listbox", { name: listLabel });
    if (hasTouch) await input.tap();
    else await input.click();
    await expect(input).toBeFocused();
    await expect(list.getByRole("option").first()).toBeVisible();
    await page.keyboard.type(query);
    await expect(input).toHaveValue(query);
    await expect(list.getByRole("option")).toHaveCount(1);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(input).toHaveValue(symbol);
    await expect(list).toBeHidden();
  }

  const input = page.getByRole("combobox", { name: "To token" });
  await input.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await input.press("ArrowDown");
  await page.keyboard.press("Tab");
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await expect(input).toHaveValue("USDC");
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
  await page.getByRole("combobox", { name: "From token", exact: true }).fill("eth");
  const options = page.getByRole("option");
  await expect(options.first()).toContainText("ETH");
  await expect(options.first()).toContainText("Native");
  await expect(options.filter({ hasText: "WETH" })).toBeVisible();
  await options.first().click();
  await expect(page.getByRole("combobox", { name: "From token", exact: true })).toHaveValue("ETH");
  await expect(page).toHaveURL(/from=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE/);
  await page.route("**/api/tokenlist", (route) =>
    route.fulfill({ json: { tokens: [], tokenlists: [] } })
  );
  await page.reload();
  await expect(page.getByRole("combobox", { name: "From token", exact: true })).toHaveValue("ETH");
});
