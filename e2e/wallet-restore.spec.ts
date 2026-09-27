import { test, expect } from "@playwright/test";
import { fixture } from "./fixtures.js";
import { installWallet } from "./wallet.js";
import { FROM, TO, SENDER } from "../packages/frontend/src/__tests__/quote-fixture.js";

for (const approved of [false, true]) {
  test(`restores wallet on reload after ${approved ? "existing" : "new"} approval`, async ({
    page,
  }) => {
    await fixture(page);
    await installWallet(
      page,
      1,
      SENDER,
      async (method, params) => {
        if (method === "eth_call")
          return (params[0] as { data: string }).data.startsWith("0x70a08231") ? "0x5f5e100" : "0x";
        if (method === "eth_getBalance") return "0x8ac7230489e80000";
        return "0x0";
      },
      approved
    );
    await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100`);
    if (!approved) {
      await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
      await page.getByRole("button", { name: "Connect with Local fork wallet" }).click();
    }
    await expect(page.getByTitle("Connected wallet address")).toHaveText(SENDER);
    await page.reload();
    await expect(page.getByTitle("Connected wallet address")).toHaveText(SENDER);
    await expect(page.getByRole("dialog", { name: "Select wallet provider" })).toHaveCount(0);
    const requests = () =>
      page.evaluate(
        () =>
          (window as unknown as { testWallet: { accountRequests: string[] } }).testWallet
            .accountRequests
      );
    expect(await requests()).toEqual(["eth_accounts"]);
    await expect(page.getByLabel("From token balance")).toContainText("100");
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
    expect(await requests()).toEqual([]);
  });
}
