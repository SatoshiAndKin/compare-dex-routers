import { test, expect } from "@playwright/test";
import { fixture } from "./fixtures.js";
import { installWallet } from "./wallet.js";
import { FROM, TO, SENDER, deferred } from "../packages/frontend/src/__tests__/quote-fixture.js";

for (const connected of [false, true]) {
  test(`keeps ${connected ? "funded" : "preview"} quotes in place while refreshing`, async ({
    page,
  }) => {
    await fixture(page);
    if (connected) {
      await installWallet(page, 1, SENDER, async (method, params) => {
        if (method === "eth_call")
          return (params[0] as { data: string }).data.startsWith("0x70a08231")
            ? "0x5f5e100"
            : `0x${"f".repeat(64)}`;
        if (method === "eth_getBalance") return "0x8ac7230489e80000";
        if (method === "eth_gasPrice") return "0x4a817c800";
        throw new Error(`Unexpected wallet method: ${method}`);
      });
    }
    await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100&slippageBps=50`);
    if (connected) {
      await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
      await page.getByRole("button", { name: "Connect with Local fork wallet" }).click();
      await expect(page.getByRole("button", { name: "Execute swap" })).toBeEnabled();
    }
    const amount = page.locator(".output-amount");
    await expect(amount).toHaveText("99.95 USDT");
    const providers = page.locator("details.provider-list");
    await providers.locator("summary").click();
    await page.getByRole("button", { name: "Select curve" }).click();
    await expect(amount).toHaveText("99.98 USDT");
    if (connected) await expect(page.getByRole("button", { name: "Execute swap" })).toBeEnabled();
    const card = page.locator(".quote-card");
    const position = () =>
      card.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top + window.scrollY, width: rect.width, height: rect.height };
      });
    const before = await position();
    const release = deferred<boolean>();
    await page.route("**/api/quote?**", async (route) => {
      await release.promise;
      await route.fallback();
    });
    const requested = page.waitForRequest((request) => request.url().includes("/api/quote?"));
    await page.locator("#sell-amount").fill("200");
    const status = page.getByRole("status", { name: "Quote loading status" });
    await expect(status).toHaveText("Refreshing quotes…");
    await expect(status.locator(".spinner")).toBeVisible();
    await requested;
    await expect(amount).toHaveText("99.98 USDT");
    await expect(providers).toHaveAttribute("open", "");
    await expect(page.getByRole("button", { name: "Select curve" })).toBeDisabled();
    if (connected) {
      await expect(page.getByRole("button", { name: "Execute swap" })).toBeDisabled();
      await expect(page.getByText(/Price simulations use temporary funding/)).toHaveCount(0);
    }
    expect(await position()).toEqual(before);
    release.resolve(true);
    await expect(status).toBeEmpty();
    await expect(page.getByText("Via curve", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Select curve" })).toContainText("200 USDC");
    await expect(providers).toHaveAttribute("open", "");
  });
}
