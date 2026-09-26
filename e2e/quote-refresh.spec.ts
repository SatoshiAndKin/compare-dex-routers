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
      await expect(page.locator(".quote-card")).toContainText(
        "Simulated with your wallet’s token balance."
      );
    }
    expect(await position()).toEqual(before);
    release.resolve(true);
    await expect(status.locator(".spinner")).toHaveCount(0);
    await expect(status).toContainText("Refreshing in");
    await expect(page.getByText("Via 0x", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Select curve" })).toContainText("200 USDC");
    await expect(providers).toHaveAttribute("open", "");
  });
}

for (const mode of ["exactIn", "targetOut"] as const) {
  test(`follows recommendation changes and shows ${mode} comparison costs`, async ({ page }) => {
    let recommendation = "curve";
    let raw = false;
    await fixture(page, (comparison) => {
      comparison.recommendation = recommendation;
      comparison.recommendation_basis = raw ? "raw_amount" : "gas_adjusted";
      comparison.recommendation_reason = raw
        ? "Gas comparison unavailable."
        : "Comparable gas estimates available.";
      for (const quote of comparison.quotes) {
        quote.net_value_native =
          quote.provider === "curve"
            ? mode === "exactIn"
              ? "0.497"
              : "0.503"
            : mode === "exactIn"
              ? "0.4976"
              : "0.5024";
        quote.net_value_usd =
          quote.provider === "curve"
            ? mode === "exactIn"
              ? "994"
              : "1006"
            : mode === "exactIn"
              ? "995.2"
              : "1004.8";
        quote.gas_cost_usd = quote.provider === "curve" ? "6" : "4.8";
        quote.approval_gas_cost_usd = quote.provider === "curve" ? "1.2" : "0";
        quote.approval_gas_used = quote.provider === "curve" ? "30000" : "0";
        quote.approval_gas_cost_native = quote.provider === "curve" ? "0.0006" : "0";
        quote.gas_cost_native = quote.provider === "curve" ? "0.003" : "0.0024";
      }
    });
    await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100&mode=${mode}`);
    await expect(page.getByText("Via curve", { exact: true })).toBeVisible();
    await page.locator("details.provider-list summary").click();
    const label =
      mode === "exactIn"
        ? "Estimated output value after gas"
        : "Estimated input cost including gas";
    const value = mode === "exactIn" ? "$994.00" : "$1,006.00";
    await expect(page.locator(".quote-card .quote-costs")).toContainText(`${label}: ${value}`);
    for (const provider of ["0x", "curve"]) {
      const row = page.getByRole("button", { name: `Select ${provider}` });
      await expect(row).toContainText(
        `Estimated gas cost: ${provider === "curve" ? "$6.00" : "$4.80"}`
      );
      await expect(row).toContainText(
        `Required approval gas cost: ${provider === "curve" ? "$1.20 (included above)" : "None needed"}`
      );
      await expect(row).toContainText(
        `${label}: ${provider === "curve" ? value : mode === "exactIn" ? "$995.20" : "$1,004.80"}`
      );
    }
    recommendation = "0x";
    await page.getByRole("button", { name: "Compare Quotes", exact: true }).click();
    await expect(page.getByText("Via 0x", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Select curve" }).click();
    await expect(page.getByText("SELECTED", { exact: true })).toBeVisible();
    await expect(page.getByText("Recommended: 0x", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Compare Quotes", exact: true }).click();
    await expect(page.getByText("Via 0x", { exact: true })).toBeVisible();
    raw = true;
    await page.getByRole("button", { name: "Compare Quotes", exact: true }).click();
    await expect(page.getByText(/Ranking by raw/)).toBeVisible();
    await page.getByRole("button", { name: /Details/ }).click();
    await expect(page.getByText(new RegExp(label))).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Select curve" })).toContainText(
      "Estimated gas cost (excluded from ranking): $6.00"
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
  });
}

test("keeps unfunded provider prices visible until a funded refresh can simulate", async ({
  page,
}) => {
  let funded = false;
  let sends = 0;
  await fixture(page, (comparison) => {
    if (funded && comparison.quotes[0]?.sender) return;
    comparison.recommendation_basis = "raw_amount";
    for (const quote of comparison.quotes) {
      quote.simulation_status = "not_run";
      quote.simulation_reason = quote.sender
        ? "Insufficient USDC balance. Fund your wallet and refresh to simulate this route."
        : "Connect a funded wallet to simulate this route.";
      quote.execution = null;
      quote.gas_used = null;
      quote.gas_cost_native = null;
      quote.gas_cost_usd = null;
      quote.net_value_native = null;
      quote.net_value_usd = null;
    }
  });
  await installWallet(page, 1, SENDER, async (method, params) => {
    if (method === "eth_sendTransaction") sends++;
    if (method === "eth_call")
      return (params[0] as { data: string }).data.startsWith("0x70a08231")
        ? funded
          ? "0x5f5e100"
          : "0x0"
        : `0x${"f".repeat(64)}`;
    if (method === "eth_getBalance") return "0x8ac7230489e80000";
    if (method === "eth_gasPrice") return "0x4a817c800";
    throw new Error(`Unexpected wallet method: ${method}`);
  });
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100&slippageBps=50`);
  const card = page.locator(".quote-card");
  await expect(card).toContainText("Not simulated. Connect a funded wallet");
  await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
  await page.getByRole("button", { name: "Connect with Local fork wallet" }).click();
  await expect(card).toContainText("Not simulated. Insufficient USDC balance.");
  await expect(card.locator(".input-amount")).toHaveText("100 USDC");
  await expect(card.locator(".output-amount")).toHaveText("99.95 USDT");
  await expect(page.getByRole("button", { name: "Execute swap" })).toHaveCount(0);
  await expect(card.getByText(/Estimated output value after gas/)).toHaveCount(0);
  await page.locator("details.provider-list summary").click();
  await expect(page.getByRole("button", { name: "Select curve" })).toContainText("Not simulated.");
  const position = () =>
    card.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top + window.scrollY, height: rect.height, width: rect.width };
    });
  const before = await position();
  const release = deferred<boolean>();
  await page.route("**/api/quote?**", async (route) => {
    await release.promise;
    await route.fallback();
  });
  funded = true;
  await page.getByRole("button", { name: "Compare Quotes", exact: true }).click();
  await expect(page.getByRole("status", { name: "Quote loading status" })).toHaveText(
    "Refreshing quotes…"
  );
  expect(await position()).toEqual(before);
  await expect(card).toContainText("Not simulated.");
  await expect(page.getByRole("button", { name: "Execute swap" })).toHaveCount(0);
  release.resolve(true);
  await expect(card).toContainText("Simulated with your wallet’s token balance.");
  await expect(page.getByRole("button", { name: "Execute swap" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Select curve" })).toContainText(
    "Simulated with your wallet’s token balance."
  );
  expect(sends).toBe(0);
});
