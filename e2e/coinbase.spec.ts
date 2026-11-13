import { parseUnits } from "viem";
import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./fixtures.js";
import { installWallet } from "./wallet.js";
import { FROM, TO, SENDER, deferred } from "../packages/frontend/src/__tests__/quote-fixture.js";

async function mockCoinbase(
  page: Page,
  afterFeeOutput = "99.9",
  beforeFeeOutput = "100",
  beforeReply?: () => Promise<unknown>
) {
  await page.route("**/api/coinbase-estimate?**", async (route) => {
    await beforeReply?.();
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
        output_amount: fee === null ? beforeFeeOutput : afterFeeOutput,
        input_amount_raw: "100000000",
        output_amount_raw: parseUnits(
          fee === null ? beforeFeeOutput : afterFeeOutput,
          6
        ).toString(),
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

async function saveOpenFee(page: Page, fee: string) {
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByLabel("Your taker fee (%)").fill(fee);
  await settings.getByRole("button", { name: "Save fee" }).click();
  await expect(settings.getByText("Coinbase fee saved.")).toBeVisible();
  await settings.getByRole("button", { name: "Close settings" }).click();
}

async function saveFee(page: Page, fee: string) {
  await page.getByRole("button", { name: "Open settings" }).click();
  await saveOpenFee(page, fee);
}

test("shows a fee-adjusted Coinbase estimate without changing the selected DEX", async ({
  page,
}) => {
  await fixture(page);
  await mockCoinbase(page);
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100&slippageBps=50`);
  const panel = page.getByRole("region", { name: "Coinbase Advanced estimate" });
  const feeButton = panel.getByRole("button", { name: /Before trading fees|Assumed fee/ });
  await expect(feeButton).toHaveText("Before trading fees");
  const dex = page.getByRole("region", { name: "DEX router quotes" });
  await expect(panel.getByRole("heading", { level: 3 })).toHaveText("Coinbase Advanced ⭐");
  await expect(dex.getByRole("heading", { level: 3 })).toHaveText("DEX routers");
  await expect(panel.getByText("Mobile trading not verified")).toBeHidden();
  await expect(panel.getByRole("img", { name: "Better quoted price" })).toHaveText("⭐");
  await expect(dex.getByText("0.02% less received", { exact: true })).toBeVisible();
  const boxes = await page.locator(".venue-card").evaluateAll((cards) =>
    cards.map((card) => {
      const rect = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        border: style.borderWidth,
        padding: style.padding,
      };
    })
  );
  expect(boxes).toHaveLength(2);
  expect(boxes[0]?.border).toBe("1px");
  expect(boxes[0]?.border).toBe(boxes[1]?.border);
  expect(boxes[0]?.padding).toBe(boxes[1]?.padding);
  expect(boxes[0]?.width).toBeCloseTo(boxes[1]?.width ?? 0, 0);
  const viewport = page.viewportSize();
  const [dexBox, coinbaseBox] = boxes;
  if (!viewport || !dexBox || !coinbaseBox) throw new Error("Missing comparison layout");
  if (viewport.width >= 600) expect(dexBox.y).toBe(coinbaseBox.y);
  else expect(coinbaseBox.y).toBeGreaterThan(dexBox.y);
  await expect(panel.getByRole("status")).toContainText("Limit only");
  const info = panel.getByRole("button", { name: "About the Coinbase estimate" });
  if (viewport.width >= 600) await info.hover();
  else await info.tap();
  await expect(panel.getByText("Mobile trading not verified")).toBeVisible();
  await expect(panel.getByText(/This market accepts limit orders only/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel.getByText("Mobile trading not verified")).toBeHidden();
  const feePosition = () =>
    feeButton.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y + window.scrollY, width: box.width, height: box.height };
    });
  const beforeFee = await feePosition();
  if (viewport.width >= 600) await feeButton.press("Enter");
  else await feeButton.tap();
  await expect(page.getByRole("dialog").getByLabel("Your taker fee (%)")).toBeFocused();
  await saveOpenFee(page, "0.1");
  await expect(feeButton).toHaveText("Assumed fee 0.1%");
  await expect(feeButton).toBeFocused();
  expect(await feePosition()).toEqual(beforeFee);
  await expect(dex.getByRole("img", { name: "Better quoted price" })).toHaveText("⭐");
  await expect(panel.getByRole("img", { name: "Better quoted price" })).toHaveCount(0);
  await expect(panel.getByText("0.08% less received", { exact: true })).toBeVisible();
  await expect(dex.getByText(/less received/)).toHaveCount(0);
  const link = panel.getByRole("link", { name: "Open Coinbase Advanced ↗" });
  await expect(link).toHaveAttribute(
    "href",
    "https://www.coinbase.com/advanced-trade/spot/USDT-USDC"
  );
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(panel.getByRole("button", { name: /swap|approve/i })).toHaveCount(0);
  await expect(page.getByText("Via 0x", { exact: true })).toBeVisible();
  await page.reload();
  await expect(feeButton).toHaveText("Assumed fee 0.1%");
  await expect(panel.getByRole("textbox")).toHaveCount(0);
  await expect(panel.getByRole("group", { name: "Coinbase average trade price" })).toContainText(
    "1 USDC = 0.999 USDT"
  );
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog").getByLabel("Your taker fee (%)")).toHaveValue("0.1");
  await page.getByRole("button", { name: "Close settings" }).click();
  await feeButton.click();
  await expect(page.getByRole("dialog").getByLabel("Your taker fee (%)")).toBeFocused();
  await expect(page.getByRole("dialog").getByLabel("Your taker fee (%)")).toHaveValue("0.1");
  await page.keyboard.press("Escape");
  await expect(feeButton).toBeFocused();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: test.info().outputPath("venue-dex-better.png"), fullPage: true });
});

test("highlights Coinbase when its fee-adjusted quote beats every DEX price", async ({ page }) => {
  await fixture(page);
  await mockCoinbase(page, "101");
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100&slippageBps=50`);
  await saveFee(page, "0.1");
  const panel = page.getByRole("region", { name: "Coinbase Advanced estimate" });
  await expect(panel.getByRole("img", { name: "Better quoted price" })).toHaveText("⭐");
  await expect(panel.getByText("Mobile trading not verified")).toBeHidden();
  await expect(
    page
      .getByRole("region", { name: "DEX router quotes" })
      .getByRole("img", { name: "Better quoted price" })
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("venue-coinbase-better.png"),
    fullPage: true,
  });
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
  await mockCoinbase(page, "101");
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
  await saveFee(page, "0.1");
  const panel = page.getByRole("region", { name: "Coinbase Advanced estimate" });
  await expect(panel.getByRole("img", { name: "Better quoted price" })).toHaveText("⭐");
  await expect(page.getByText("Via 0x", { exact: true })).toBeVisible();
});

test("keeps DEX expiry after refreshing Coinbase during a pending approval", async ({ page }) => {
  await page.clock.install();
  await fixture(page);
  const estimateRefresh = deferred<undefined>();
  let holdEstimate = false;
  await mockCoinbase(page, "99.9", "100", async () => {
    if (holdEstimate) await estimateRefresh.promise;
  });
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
    const dex = page.getByRole("region", { name: "DEX router quotes" });
    await expect(dex.getByRole("img", { name: "Better quoted price" })).toHaveText("⭐");
    const before = dexRequests;
    const refresh = panel.getByRole("button", { name: "Refresh estimate" });
    const tradeLink = panel.getByRole("link", { name: "Open Coinbase Advanced ↗" });
    const position = () =>
      page
        .locator(".quote-card")
        .or(panel)
        .or(refresh)
        .or(tradeLink)
        .evaluateAll((elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect();
            return {
              top: box.top + window.scrollY,
              left: box.left,
              width: box.width,
              height: box.height,
            };
          })
        );
    const beforeExpiry = await position();
    await page.clock.runFor(61_000);
    expect(await position()).toEqual(beforeExpiry);
    holdEstimate = true;
    await refresh.click();
    await expect(refresh).toBeDisabled();
    expect(await position()).toEqual(beforeExpiry);
    await expect(panel.getByRole("status")).toContainText("Refreshing estimate");
    await expect(tradeLink).toBeVisible();
    estimateRefresh.resolve(undefined);
    await expect(refresh).toBeEnabled();
    await expect(panel.getByText("Estimate expired.")).toHaveCount(0);
    await expect(panel).toContainText("DEX quotes expired.");
    await expect(page.getByRole("img", { name: "Better quoted price" })).toHaveCount(0);
    expect(dexRequests).toBe(before);
    expect(await position()).toEqual(beforeExpiry);
  } finally {
    estimateRefresh.resolve(undefined);
    release.resolve(`0x${"1".repeat(64)}`);
  }
});

test("counts down to the scheduled Coinbase refresh and updates the price in place", async ({
  page,
}) => {
  await page.clock.install();
  await fixture(page);
  await mockCoinbase(page);
  await page.goto(`/?chainId=1&from=${FROM}&to=${TO}&amount=100&slippageBps=50`);
  const panel = page.getByRole("region", { name: "Coinbase Advanced estimate" });
  const refresh = panel.getByRole("button", { name: "Refresh estimate" });
  const timer = panel.getByRole("timer", { name: "Coinbase auto-refresh" });
  const rates = panel.getByRole("group", { name: "Coinbase average trade price" });
  await expect(rates).toContainText("1 USDC = 1 USDT");
  await expect(timer).toHaveText("15s");
  await expect(
    panel.locator("header").getByRole("button", { name: "Refresh estimate" })
  ).toBeVisible();
  await expect(refresh).toHaveText("");
  const positions = () =>
    Promise.all([
      panel.boundingBox(),
      refresh.boundingBox(),
      panel.getByRole("link", { name: "Open Coinbase Advanced ↗" }).boundingBox(),
      page.locator(".quote-card").boundingBox(),
    ]);
  const before = await positions();
  await page.clock.runFor(6_000);
  await expect(timer).toHaveText("9s");
  expect(await positions()).toEqual(before);
  const pending = deferred<undefined>();
  try {
    await mockCoinbase(page, "99.9", "99.999999", () => pending.promise);
    await page.clock.runFor(9_000);
    await expect(refresh).toBeDisabled();
    await expect(rates).toContainText("1 USDC = 1 USDT");
    expect(await positions()).toEqual(before);
    pending.resolve(undefined);
    await expect(panel).toContainText("99.999999 USDT");
    await expect(timer).toHaveText("15s");
    expect(await positions()).toEqual(before);
  } finally {
    pending.resolve(undefined);
  }
});
