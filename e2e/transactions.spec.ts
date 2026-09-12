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
        return scenario === "reject approval" ? "0x0" : `0x${"f".repeat(64)}`;
      if (method === "eth_getBalance") return "0x0";
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
    await expect(page.getByRole("tab", { name: "Spandex" })).toBeVisible();
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
      await expect(page.getByRole("button", { name: "Execute swap" })).toBeDisabled();
    }
  });
}
