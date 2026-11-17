import { test, expect } from "@playwright/test";
import { fixture } from "./fixtures.js";
import { installWallet } from "./wallet.js";
import { deferred, FROM, TO, SENDER } from "../packages/frontend/src/__tests__/quote-fixture.js";

test("approval retains its provider through refresh, then cancellation follows the recommendation", async ({
  page,
}) => {
  let approved = false;
  await fixture(page);
  await installWallet(page, 1, SENDER, async (method, params) => {
    if (method === "eth_call")
      return (params[0] as { data: string }).data.startsWith("0x70a08231")
        ? "0x5f5e100"
        : approved
          ? `0x${"f".repeat(64)}`
          : "0x0";
    if (method === "eth_getBalance") return "0x8ac7230489e80000";
    if (method === "eth_gasPrice") return "0x4a817c800";
    if (method === "eth_estimateGas") return "0x1d4c0";
    if (method === "eth_sendTransaction") {
      approved = true;
      return `0x${"1".repeat(64)}`;
    }
    if (method === "eth_getTransactionReceipt") return { status: "0x1" };
    throw new Error(`Unexpected wallet method: ${method}`);
  });
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100&slippageBps=50`);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
  await page.getByRole("button", { name: "Connect with Local fork wallet" }).click();
  await expect(page.getByRole("button", { name: "Approve token spending" })).toBeEnabled();
  await page.locator("details.provider-list summary").click();
  await page.getByRole("button", { name: "Select curve" }).click();
  await page.getByRole("button", { name: "Approve token spending" }).click();
  await expect(page.getByRole("button", { name: "Execute swap" })).toBeEnabled();
  await expect(page.getByText("Via curve", { exact: true })).toBeVisible();
  await expect(page.getByText("Recommended: 0x", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Compare Quotes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Execute swap" })).toBeEnabled();
  await expect(page.getByText("Via curve", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Execute swap" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm Swap" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Use recommended route" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Select 0x" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("Via 0x", { exact: true })).toBeVisible();
  await expect(page.getByText("Selected for approval / swap: curve")).toHaveCount(0);
});

test("a worse refreshed DeFiLlama price warns before the wallet receives the swap", async ({
  page,
}) => {
  let shortfallBps = 0;
  let sends = 0;
  await fixture(page, (comparison) => {
    for (const quote of comparison.quotes) {
      quote.defillama_price_check = {
        worse_than_reference: shortfallBps > 0,
        shortfall_bps: shortfallBps,
      };
    }
  });
  await installWallet(page, 1, SENDER, async (method, params) => {
    if (method === "eth_call")
      return (params[0] as { data: string }).data.startsWith("0x70a08231")
        ? "0x5f5e100"
        : `0x${"f".repeat(64)}`;
    if (method === "eth_getBalance") return "0x8ac7230489e80000";
    if (method === "eth_gasPrice") return "0x4a817c800";
    if (method === "eth_estimateGas") return "0x1d4c0";
    if (method === "eth_sendTransaction") {
      sends++;
      return `0x${"1".repeat(64)}`;
    }
    if (method === "eth_getTransactionReceipt") return { status: "0x1" };
    throw new Error(`Unexpected wallet method: ${method}`);
  });
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100&slippageBps=50`);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
  await page.getByRole("button", { name: "Connect with Local fork wallet" }).click();
  const swap = page.getByRole("button", { name: "Execute swap" });
  await expect(swap).toBeEnabled();
  shortfallBps = 50;
  await swap.click();
  const dialog = page.getByRole("dialog", { name: "Confirm Swap" });
  const warning = dialog.getByRole("alert");
  await expect(warning).toContainText("worse price than DeFiLlama");
  await expect(warning).toContainText("0.50% below");
  expect(sends).toBe(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(sends).toBe(0);

  await page.getByRole("button", { name: "Open settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const threshold = settings.getByLabel("DeFiLlama warning threshold (%)");
  await expect(threshold).toHaveValue("0.50");
  await threshold.fill("0.75");
  await settings.getByRole("button", { name: "Save threshold" }).click();
  await expect(settings.getByText("Warning threshold saved.")).toBeVisible();
  await settings.getByRole("button", { name: "Close settings" }).click();
  await page.reload();
  await expect(swap).toBeEnabled();
  await swap.click();
  await expect(dialog.getByRole("button", { name: "Confirm Swap", exact: true })).toBeVisible();
  await expect(warning).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  shortfallBps = 75;
  await swap.click();
  await expect(warning).toContainText("0.75% below");
  await dialog.getByRole("button", { name: "Swap Anyway", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Swap confirmed ·" })).toBeVisible();
  expect(sends).toBe(1);
});

for (const scenario of [
  "reject approval",
  "reverted swap",
  "account change",
  "chain change",
] as const) {
  test(`transaction boundary: ${scenario}`, async ({ page }) => {
    await fixture(page);
    const sent: unknown[][] = [];
    await installWallet(page, 1, SENDER, async (method, params) => {
      if (method === "eth_call")
        return (params[0] as { data: string }).data.startsWith("0x70a08231")
          ? "0x5f5e100"
          : scenario === "reject approval"
            ? "0x0"
            : `0x${"f".repeat(64)}`;
      if (method === "eth_getBalance") return "0x8ac7230489e80000";
      if (method === "eth_gasPrice") return "0x4a817c800";
      if (method === "eth_estimateGas") return "0x1d4c0";
      if (method === "eth_sendTransaction") {
        sent.push(params);
        return `0x${"1".repeat(64)}`;
      }
      if (method === "eth_getTransactionReceipt") return { status: "0x0" };
      throw new Error(`Unexpected wallet method: ${method}`);
    });
    await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100&slippageBps=50`);
    await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
    await page.getByRole("button", { name: "Connect with Local fork wallet" }).click();
    await expect(page.getByText("Via 0x", { exact: true })).toBeVisible();
    await expect(page.locator(".quote-card")).toContainText(
      "Simulation passed. Wallet checks required."
    );
    if (scenario === "reject approval") {
      await page.evaluate(() =>
        (
          window as unknown as { testWallet: { rejectNextTransaction(): void } }
        ).testWallet.rejectNextTransaction()
      );
      await page.getByRole("button", { name: "Approve token spending" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Transaction canceled" })
      ).toBeVisible();
      expect(sent).toEqual([]);
      await expect(page.getByRole("button", { name: "Execute swap" })).toBeDisabled();
      return;
    }
    await page.getByRole("button", { name: "Execute swap" }).click();
    const dialog = page.getByRole("dialog", { name: "Confirm Swap" });
    await expect(dialog).toBeVisible();
    if (scenario === "reverted swap") {
      await dialog.getByRole("button", { name: "Confirm Swap", exact: true }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Transaction failed on chain" })
      ).toBeVisible();
      expect(sent).toHaveLength(1);
      await expect(page.getByText(/^Swap confirmed/)).toHaveCount(0);
    } else {
      await page.evaluate((scenario) => {
        const wallet = (
          window as unknown as {
            testWallet: { changeAccount(account: string): void; changeChain(chain: number): void };
          }
        ).testWallet;
        if (scenario === "account change")
          wallet.changeAccount("0x3333333333333333333333333333333333333333");
        else wallet.changeChain(8453);
      }, scenario);
      await expect(dialog).toBeHidden();
      expect(sent).toEqual([]);
      if (scenario === "chain change")
        await expect(page.getByRole("button", { name: "Execute swap" })).toHaveCount(0);
      else {
        await page.getByRole("button", { name: "Execute swap" }).click();
        await expect(dialog).toContainText("0x3333333333333333333333333333333333333333");
        expect(sent).toEqual([]);
      }
    }
  });
}

for (const native of [false, true]) {
  test(`sell balance shortcuts fill exact ${native ? "native" : "ERC-20"} amounts`, async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 320, height: 844 });
    await fixture(page);
    const token = native ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" : FROM;
    const raw = native ? 1234567890123456789n : 123456789n;
    let pendingBalance: Promise<undefined> | undefined;
    await installWallet(page, 1, SENDER, async (method, params) => {
      if (method === "eth_getBalance") {
        if (native) await pendingBalance;
        return `0x${(native ? raw : 10n ** 18n).toString(16)}`;
      }
      if (method === "eth_gasPrice") return "0x4a817c800";
      if (method === "eth_call") {
        if (!(params[0] as { data: string }).data.startsWith("0x70a08231")) return "0x0";
        if (!native) await pendingBalance;
        return `0x${raw.toString(16)}`;
      }
      throw new Error(`Unexpected wallet method ${method}`);
    });
    await page.goto(`/?chainId=1&from=${token}&to=${TO}&amount=1&mode=targetOut`);
    await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
    await page.getByRole("button", { name: "Connect with Local fork wallet" }).click();
    const balance = page.getByRole("button", { name: "From token balance", exact: true });
    const shortcut = (percent: number) =>
      page.getByRole("button", { name: `Use ${percent}% of sell balance`, exact: true });
    const [useQuarter, useHalf, useThreeQuarters] = [shortcut(25), shortcut(50), shortcut(75)];
    const positions = () =>
      Promise.all(
        [balance, useQuarter, useHalf, useThreeQuarters].map((button) => button.boundingBox())
      );
    const sell = page.locator("#sell-amount");
    const [quarter, half, threeQuarters] = native
      ? (["0.308641972530864197", "0.617283945061728394", "0.925925917592592591"] as const)
      : (["30.864197", "61.728394", "92.592591"] as const);
    await expect(useQuarter).toBeEnabled();
    const initial = await positions();
    const delayed = deferred<undefined>();
    pendingBalance = delayed.promise;
    try {
      await useQuarter.click();
      await expect(useHalf).toBeDisabled();
      await expect(balance).toBeDisabled();
      expect(await positions()).toEqual(initial);
    } finally {
      pendingBalance = undefined;
      delayed.resolve(undefined);
    }
    await expect(sell).toHaveValue(quarter);
    await expect(useQuarter).toBeEnabled();
    expect(await positions()).toEqual(initial);
    await useHalf.click();
    await expect(sell).toHaveValue(half);
    await useThreeQuarters.click();
    await expect(sell).toHaveValue(threeQuarters);
    await expect(page).not.toHaveURL(/mode=targetOut/);

    await balance.click();
    await expect(sell).toHaveValue(native ? "1.231687890123456789" : "123.456789");
    await expect(page.getByLabel("To token balance")).toBeVisible();
    expect(await page.getByLabel("To token balance").evaluate((el) => el.tagName)).toBe("SPAN");
    if (native) await expect(page.getByText(/estimated gas reserve was deducted/)).toBeVisible();
  });
}

test("zero balances keep prices visible and block an unfunded wallet", async ({ page }) => {
  await fixture(page);
  await installWallet(page, 1, SENDER, async (method) => {
    if (method === "eth_getBalance" || method === "eth_call") return "0x0";
    throw new Error(`Unexpected wallet method ${method}`);
  });
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100`);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
  await page.getByRole("button", { name: "Connect with Local fork wallet" }).click();
  await expect(page.getByText("Via 0x", { exact: true })).toBeVisible();
  await expect(page.getByLabel("From token balance")).toContainText("Balance: 0 USDC");
  await expect(page.getByLabel("To token balance")).toContainText("Balance: 0 USDT");
  await expect(
    page
      .locator(".quote-card .execution-status")
      .getByText("Insufficient USDC balance.", { exact: true })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Execute swap" })).toHaveCount(0);
});

test("missing native fee data prevents automatic balance entry", async ({ page }) => {
  await fixture(page);
  await installWallet(page, 1, SENDER, async (method) => {
    if (method === "eth_getBalance") return "0xde0b6b3a7640000";
    if (method === "eth_call") return "0x0";
    throw new Error("Fee data unavailable");
  });
  await page.goto(
    `/?chainId=1&from=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE&to=${TO}&amount=0.01`
  );
  await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
  await page.getByRole("button", { name: "Connect with Local fork wallet" }).click();
  await page.getByRole("button", { name: "From token balance" }).click();
  await expect(page.getByText("Cannot fill balance: Fee data unavailable")).toBeVisible();
  await expect(page.locator("#sell-amount")).toHaveValue("0.01");
});

test("transaction links follow saved explorer preferences and retain the submitted chain", async ({
  page,
}) => {
  await fixture(page);
  await installWallet(page, 1, SENDER, async (method, params) => {
    if (method === "eth_call")
      return (params[0] as { data: string }).data.startsWith("0x70a08231")
        ? "0x5f5e100"
        : `0x${"f".repeat(64)}`;
    if (method === "eth_getBalance") return "0x8ac7230489e80000";
    if (method === "eth_gasPrice") return "0x4a817c800";
    if (method === "eth_estimateGas") return "0x1d4c0";
    if (method === "eth_sendTransaction") return `0x${"a".repeat(64)}`;
    if (method === "eth_getTransactionReceipt") return { status: "0x1" };
    throw new Error(`Unexpected wallet method: ${method}`);
  });
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100`);
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  expect((await settings.getByLabel(/Block explorer for/).boundingBox())?.width).toBeGreaterThan(
    200
  );
  await settings.getByLabel(/Block explorer for/).fill("https://eth.blockscout.com/");
  await settings.getByRole("button", { name: "Save explorer" }).click();
  await expect(settings.getByText("Explorer preference saved.")).toBeVisible();
  await settings.getByRole("button", { name: "Close settings" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
  await page.getByRole("button", { name: "Connect with Local fork wallet" }).click();
  await page.getByRole("button", { name: "Execute swap" }).click();
  await page
    .getByRole("dialog", { name: "Confirm Swap" })
    .getByRole("button", { name: "Confirm Swap", exact: true })
    .click();
  const status = page.locator(".wallet-message");
  await expect(status).toContainText("Swap confirmed");
  const link = status.getByRole("link");
  const hash = `0x${"a".repeat(64)}`;
  await expect(link).toHaveAttribute("href", `https://eth.blockscout.com/tx/${hash}`);
  await expect(link).toHaveAttribute("target", "_blank");
  const summary = status.locator("summary").filter({ hasText: "Transaction details" });
  const chevron = summary.locator(".disclosure-chevron");
  await expect(chevron).toHaveCSS("transform", "none");
  await summary.click();
  await expect(chevron).toHaveCSS("transform", "matrix(-1, 0, 0, -1, 0, 0)");
  await expect(status.getByText(hash, { exact: true })).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { testWallet: { changeChain(chain: number): void } }
    ).testWallet.changeChain(8453)
  );
  await expect(link).toHaveAttribute("href", `https://eth.blockscout.com/tx/${hash}`);
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await settings.getByRole("button", { name: "Use chain default" }).click();
  await settings.getByRole("button", { name: "Close settings" }).click();
  await expect(link).toHaveAttribute("href", `https://etherscan.io/tx/${hash}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
