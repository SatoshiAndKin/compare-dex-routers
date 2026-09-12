import { test, expect } from "@playwright/test";
import { FROM, TO } from "../packages/frontend/src/__tests__/quote-fixture.js";

import { fixture } from "./fixtures.js";

for (const theme of ["light", "dark"] as const) {
  test(`retro trade form and settings work in ${theme} mode`, async ({ page }, info) => {
    await fixture(page);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100`);
    await expect(page.getByRole("heading", { name: "Compare DEX Routers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Compare Quotes", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Compare Quotes", exact: true }).click();
    await expect(page.getByRole("tab", { name: /Spandex/ })).toBeVisible();
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

test("Farcaster loads its local bundle and explains missing host context", async ({ page }) => {
  await fixture(page);
  const remoteScripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script" && !request.url().startsWith("http://127.0.0.1:5180/"))
      remoteScripts.push(request.url());
  });
  await page.route("**/test-host", (route) =>
    route.fulfill({ contentType: "text/html", body: '<iframe title="Mini App" src="/"></iframe>' })
  );
  await page.goto("/test-host");
  const app = page.frameLocator('iframe[title="Mini App"]');
  await app.getByRole("button", { name: /Connect Wallet/i, exact: true }).click();
  await app.getByRole("button", { name: /Connect with Farcaster/ }).click();
  await expect(app.getByText(/Open this app in Farcaster to use its wallet/)).toBeVisible();
  expect(remoteScripts).toEqual([]);
});
