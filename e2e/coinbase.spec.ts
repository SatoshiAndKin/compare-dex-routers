import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./fixtures.js";
import { installWallet } from "./wallet.js";
import { FROM, TO, SENDER, deferred } from "../packages/frontend/src/__tests__/quote-fixture.js";

async function mockCoinbase(page: Page) {
  await page.route("**/api/coinbase-estimate?**", async (route) => {
    const now = await page.evaluate(() => Date.now());
    const fee = new URL(route.request().url()).searchParams.get("takerFeePercent");
    return route.fulfill({
      json: {
        status: "ready",
        product_id: "USDT-USDC",
        side: "BUY",
        input_symbol: "USDC",
        output_symbol: "USDT",
        input_amount: "100",
        output_amount: fee === null ? "100" : "99.9",
        input_amount_raw: "100000000",
        output_amount_raw: fee === null ? "100000000" : "99900000",
        input_decimals: 6,
        output_decimals: 6,
        fee_percent: fee,
        fee_amount: fee === null ? null : "0.1",
        fee_symbol: "USDC",
        as_of: new Date(now).toISOString(),
        expires_at: new Date(now + 30000).toISOString(),
        limit_only: true,
        trade_url: "https://www.coinbase.com/advanced-trade/spot/USDT-USDC",
      },
    });
  });
}

async function saveFee(page: Page, fee: string) {
  await page.getByRole("button", { name: "Open settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByLabel("Your taker fee (%)").fill(fee);
  await settings.getByRole("button", { name: "Save fee" }).click();
  await expect(settings.getByText("Coinbase fee saved.")).toBeVisible();
  await settings.getByRole("button", { name: "Close settings" }).click();
}

test("shows a fee-adjusted Coinbase estimate without changing the selected DEX", async ({
  page,
}) => {
  await fixture(page);
  await mockCoinbase(page);
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100&slippageBps=50`);
  const panel = page.getByRole("region", { name: "Coinbase Advanced estimate" });
  await expect(panel.getByText(/Before trading fees;/)).toBeVisible();
  await expect(panel).toContainText("This market accepts limit orders only.");
  await saveFee(page, "0.1");
  await expect(panel).toContainText("Includes an assumed 0.1% fee");
  await expect(panel).toContainText(
    "0.08 USDT less output than the best DEX price before gas and transfers."
  );
  const link = panel.getByRole("link", { name: "Open Coinbase Advanced ↗" });
  await expect(link).toHaveAttribute(
    "href",
    "https://www.coinbase.com/advanced-trade/spot/USDT-USDC"
  );
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(panel.getByRole("button", { name: /swap|approve/i })).toHaveCount(0);
  await expect(page.getByText("Via 0x", { exact: true })).toBeVisible();
  await page.reload();
  await expect(panel).toContainText("Includes an assumed 0.1% fee");
  await expect(panel.getByRole("textbox")).toHaveCount(0);
  await expect(panel.getByRole("group", { name: "Coinbase average trade price" })).toContainText(
    "1 USDC = 0.999 USDT"
  );
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog").getByLabel("Your taker fee (%)")).toHaveValue("0.1");
  await page.getByRole("button", { name: "Close settings" }).click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(overflow).toBe(false);
});

test("compares Coinbase with a working route instead of a reverted quote", async ({ page }) => {
  await fixture(page, (comparison) => {
    if (comparison.quotes[0]?.sender)
      comparison.quotes.push({
        ...comparison.quotes[0],
        provider: "reverted",
        output_amount: "1000",
        output_amount_raw: "1000000000",
        simulation_status: "failed",
        simulation_reason: "execution reverted",
        execution: null,
      });
  });
  await mockCoinbase(page);
  await installWallet(page, 1, SENDER, async (method, args) => {
    if (method === "eth_call")
      return (args[0] as { data: string }).data.startsWith("0x70a08231")
        ? "0x5f5e100"
        : `0x${"f".repeat(64)}`;
    if (method === "eth_getBalance") return "0x8ac7230489e80000";
    if (method === "eth_gasPrice") return "0x4a817c800";
    throw new Error(`Unexpected wallet method: ${method}`);
  });
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100&slippageBps=50`);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
  await page.getByRole("button", { name: "Connect with Local fork wallet" }).click();
  await expect(page.getByRole("button", { name: "Execute swap" })).toBeEnabled();
  const panel = page.getByRole("region", { name: "Coinbase Advanced estimate" });
  await saveFee(page, "0.1");
  await expect(panel).toContainText(
    "0.08 USDT less output than the best DEX price before gas and transfers."
  );
  await expect(page.getByText("Via 0x", { exact: true })).toBeVisible();
});

test("keeps DEX expiry after refreshing Coinbase during a pending approval", async ({ page }) => {
  await page.clock.install();
  await fixture(page);
  await mockCoinbase(page);
  const release = deferred<string>();
  let waiting = false;
  let approved = false;
  let dexRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/quote?")) dexRequests++;
  });
  await installWallet(page, 1, SENDER, async (method, args) => {
    if (method === "eth_call")
      return (args[0] as { data: string }).data.startsWith("0x70a08231")
        ? "0x5f5e100"
        : approved
          ? `0x${"f".repeat(64)}`
          : "0x0";
    if (method === "eth_getBalance") return "0x8ac7230489e80000";
    if (method === "eth_gasPrice") return "0x4a817c800";
    if (method === "eth_estimateGas") return "0x1d4c0";
    if (method === "eth_sendTransaction") {
      waiting = true;
      const hash = await release.promise;
      approved = true;
      return hash;
    }
    if (method === "eth_getTransactionReceipt") return { status: "0x1" };
    throw new Error(`Unexpected wallet method: ${method}`);
  });
  try {
    await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100&slippageBps=50`);
    await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
    await page.getByRole("button", { name: "Connect with Local fork wallet" }).click();
    const panel = page.getByRole("region", { name: "Coinbase Advanced estimate" });
    await saveFee(page, "0.1");
    await page.getByRole("button", { name: "Approve token spending" }).click();
    await expect.poll(() => waiting).toBe(true);
    await expect(panel).toContainText(
      "0.08 USDT less output than the best DEX price before gas and transfers."
    );
    const before = dexRequests;
    await page.clock.runFor(61_000);
    await panel.getByRole("button", { name: "Refresh estimate" }).click();
    await expect(panel).toContainText("Includes an assumed 0.1% fee");
    await expect(panel.getByText("Estimate expired. Refresh before comparing prices.")).toHaveCount(
      0
    );
    await expect(panel).toContainText("DEX quotes expired. Refresh quotes to compare prices.");
    await expect(panel.locator(".difference")).toHaveCount(0);
    expect(dexRequests).toBe(before);
  } finally {
    release.resolve(`0x${"1".repeat(64)}`);
  }
});
