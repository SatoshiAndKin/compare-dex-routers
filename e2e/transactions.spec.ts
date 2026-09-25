import { test, expect } from "@playwright/test";
import { fixture } from "./fixtures.js";
import { installWallet } from "./wallet.js";
import { FROM, TO, SENDER } from "../packages/frontend/src/__tests__/quote-fixture.js";

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
        await expect(page.getByRole("button", { name: "Execute swap" })).toBeDisabled();
      else {
        await page.getByRole("button", { name: "Execute swap" }).click();
        await expect(dialog).toContainText("0x3333333333333333333333333333333333333333");
        expect(sent).toEqual([]);
      }
    }
  });
}

for (const native of [false, true]) {
  test(`sell balance fills exact ${native ? "native less gas" : "ERC-20"} amount`, async ({
    page,
  }) => {
    await fixture(page);
    const token = native ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" : FROM;
    const raw = native ? 1234567890123456789n : 123456789n;
    await installWallet(page, 1, SENDER, async (method, params) => {
      if (method === "eth_getBalance") return `0x${(native ? raw : 10n ** 18n).toString(16)}`;
      if (method === "eth_gasPrice") return "0x4a817c800";
      if (method === "eth_call")
        return (params[0] as { data: string }).data.startsWith("0x70a08231")
          ? `0x${raw.toString(16)}`
          : "0x0";
      throw new Error(`Unexpected wallet method ${method}`);
    });
    await page.goto(`/?chainId=1&from=${token}&to=${TO}&amount=1&mode=targetOut`);
    await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
    await page.getByRole("button", { name: "Connect with Local fork wallet" }).click();
    const balance = page.getByRole("button", { name: "From token balance", exact: true });
    await expect(balance).toBeEnabled();
    await balance.click();
    await expect(page.locator("#sell-amount")).toHaveValue(
      native ? "1.231687890123456789" : "123.456789"
    );
    await expect(page).not.toHaveURL(/mode=targetOut/);
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
  await expect(page.getByText("Insufficient USDC balance.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Execute swap" })).toBeDisabled();
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
