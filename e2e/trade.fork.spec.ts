import { test, expect } from "@playwright/test";
import {
  createPublicClient,
  createWalletClient,
  createTestClient,
  http,
  erc20Abi,
  parseEther,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
import { mainnet, base } from "viem/chains";
import type { components } from "../packages/frontend/src/generated/api-types.js";
import { installWallet } from "./wallet.js";

const ACCOUNT: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const PREVIEW_ACCOUNT: Address = "0xEe7aE85f2Fe2239E27D9c1E23fFFe168D63b4055";
const networks = [
  {
    chain: mainnet,
    weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    provider: "curve",
  },
  {
    chain: base,
    weth: "0x4200000000000000000000000000000000000006",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    provider: "kyberswap",
  },
] as const;

for (const network of networks) {
  test(`${network.chain.name}: previews isolate account code and token balances`, async ({
    request,
  }) => {
    const url = process.env[`FORK_TEST_RPC_${network.chain.id}`];
    if (!url || new URL(url).hostname !== "127.0.0.1")
      throw new Error("Use an isolated local fork");
    const client = createPublicClient({ chain: network.chain, transport: http(url) });
    const control = createTestClient({ mode: "anvil", transport: http(url) });
    const snapshot = await control.snapshot();
    try {
      // This account cannot receive native output or spend native input without an override.
      await control.setCode({ address: PREVIEW_ACCOUNT, bytecode: "0x60006000fd" });
      await control.setBalance({ address: PREVIEW_ACCOUNT, value: 0n });
      for (const [from, to, amount, mode] of [
        [NATIVE, network.usdc, "0.01", "exactIn"],
        [network.weth, network.usdc, "0.01", "exactIn"],
        [network.usdc, network.weth, "10", "exactIn"],
        [network.weth, NATIVE, "0.01", "exactIn"],
        [network.usdc, network.weth, "0.005", "targetOut"],
      ] as const) {
        const before =
          from === NATIVE
            ? 0n
            : await client.readContract({
                address: from,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [PREVIEW_ACCOUNT],
              });
        const params = new URLSearchParams({
          chainId: String(network.chain.id),
          from,
          to,
          amount,
          mode,
        });
        await expect
          .poll(
            async () => {
              const response = await request.get(`http://127.0.0.1:3120/quote?${params}`, {
                timeout: 30_000,
              });
              expect(response.ok()).toBe(true);
              const result = (await response.json()) as components["schemas"]["QuoteResponse"];
              const successful = result.quotes;
              for (const quote of successful) {
                expect(quote.sender).toBeNull();
                expect(quote.execution).toBeNull();
                expect(BigInt(quote.output_amount_raw)).toBeGreaterThan(0n);
                if (mode === "targetOut")
                  expect(BigInt(quote.output_amount_raw)).toBeGreaterThanOrEqual(
                    parseEther(amount)
                  );
              }
              return successful.length;
            },
            { timeout: 60_000, intervals: [1_000, 2_000, 5_000] }
          )
          .toBeGreaterThan(0);
        if (from !== NATIVE)
          expect(
            await client.readContract({
              address: from,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [PREVIEW_ACCOUNT],
            })
          ).toBe(before);
      }
      expect(await client.getCode({ address: PREVIEW_ACCOUNT })).toBe("0x60006000fd");
      expect(await client.getBalance({ address: PREVIEW_ACCOUNT })).toBe(0n);
    } finally {
      await control.revert({ id: snapshot });
    }
  });
  for (const native of [false, true]) {
    test(`${network.chain.name}: ${native ? "native" : "approve ERC-20"} and swap via ${network.provider}`, async ({
      page,
      request,
    }, info) => {
      const url = process.env[`FORK_TEST_RPC_${network.chain.id}`];
      if (!url || new URL(url).hostname !== "127.0.0.1")
        throw new Error("Run pnpm test:fork to create isolated local Anvil nodes");
      const client = createPublicClient({ chain: network.chain, transport: http(url) });
      const wallet = createWalletClient({
        account: ACCOUNT,
        chain: network.chain,
        transport: http(url),
      });
      const control = createTestClient({ mode: "anvil", transport: http(url) });
      const snapshot = await control.snapshot();
      const hashes: Hex[] = [];
      let approvals = 0;
      try {
        await control.setBalance({ address: ACCOUNT, value: parseEther("100") });
        const wrapped = await wallet.sendTransaction({
          to: network.weth,
          data: "0xd0e30db0",
          value: parseEther("1"),
        });
        expect((await client.waitForTransactionReceipt({ hash: wrapped })).status).toBe("success");
        const from = native ? NATIVE : network.weth;
        const params = new URLSearchParams({
          chainId: String(network.chain.id),
          from,
          to: network.usdc,
          amount: "0.01",
          slippageBps: "100",
          sender: ACCOUNT,
        });
        // Warm the real API and Curve catalog before the browser's bounded quote request.
        await expect
          .poll(
            async () => {
              const result = await request.get(`http://127.0.0.1:3120/quote?${params}`, {
                timeout: 30_000,
              });
              if (!result.ok()) return false;
              const body = (await result.json()) as components["schemas"]["QuoteResponse"];
              return body.quotes.some((candidate) => candidate.provider === network.provider);
            },
            { timeout: 60_000, intervals: [1_000, 2_000, 5_000] }
          )
          .toBe(true);
        await installWallet(page, network.chain.id, ACCOUNT, async (method, rpcParams) => {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: rpcParams }),
          });
          const data = (await response.json()) as {
            result?: unknown;
            error?: { message: string; code: number };
          };
          if (data.error) throw new Error(data.error.message);
          if (method === "eth_sendTransaction") hashes.push(data.result as Hex);
          return data.result;
        });
        params.delete("sender");
        await page.goto(`/?${params}`);
        await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
        await page.getByRole("button", { name: "Connect with Local fork wallet" }).click();
        await expect(page.getByText(ACCOUNT, { exact: true }).first()).toBeVisible();
        const comparing = page.waitForResponse(
          (response) =>
            response.url().includes("/api/quote?") &&
            new URL(response.url()).searchParams.get("sender")?.toLowerCase() ===
              ACCOUNT.toLowerCase()
        );
        await page.getByRole("button", { name: "Compare Quotes", exact: true }).click();
        const data = (await (await comparing).json()) as components["schemas"]["QuoteResponse"];
        let quote = data.quotes.find((candidate) => candidate.provider === network.provider);
        const selectedProvider = quote?.provider;
        expect(
          quote,
          `No ${network.provider} quote returned: ${JSON.stringify(data.failures)}`
        ).toBeDefined();
        if (!quote?.execution) throw new Error("Quote has no execution payload");
        await page.getByText("Provider results", { exact: false }).click();
        await page.getByRole("button", { name: `Select ${selectedProvider}`, exact: true }).click();
        const outputBefore = await client.readContract({
          address: network.usdc,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [ACCOUNT],
        });
        const inputBefore = native
          ? await client.getBalance({ address: ACCOUNT })
          : await client.readContract({
              address: network.weth,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [ACCOUNT],
            });
        if (native) {
          await expect(page.getByRole("button", { name: "Approve token spending" })).toHaveCount(0);
        } else {
          // The refreshed best quote can use a different spender. Approve each
          // current identity and verify its allowance before attempting a swap.
          for (;;) {
            const approval = quote.execution.approval;
            if (!approval) throw new Error("ERC-20 quote is missing approval identity");
            const allowanceRequest = {
              address: network.weth,
              abi: erc20Abi,
              functionName: "allowance",
              args: [ACCOUNT, approval.spender as Address],
            } as const;
            const required = BigInt(quote.input_amount_raw);
            if ((await client.readContract(allowanceRequest)) >= required) {
              await expect(page.getByRole("button", { name: "Already approved" })).toBeVisible();
              break;
            }
            const refreshed = page.waitForResponse(
              (response) => response.url().includes("/api/quote?") && response.ok()
            );
            await page.getByRole("button", { name: "Approve token spending" }).click();
            approvals++;
            await expect(
              page.getByRole("status").filter({ hasText: /^Approval confirmed:/ })
            ).toBeVisible({ timeout: 30000 });
            quote = (
              (await (await refreshed).json()) as components["schemas"]["QuoteResponse"]
            ).quotes.find((candidate) => candidate.provider === selectedProvider);
            expect(await client.readContract(allowanceRequest)).toBeGreaterThanOrEqual(required);
            if (!quote?.execution) throw new Error("Post-approval quote has no execution payload");
            await expect(
              page.getByRole("button", { name: `Select ${selectedProvider}`, exact: true })
            ).toHaveAttribute("aria-pressed", "true");
          }
        }
        await page.getByRole("button", { name: "Execute swap" }).click();
        await expect(page.getByRole("dialog", { name: "Confirm Swap" })).toBeVisible();
        await page.getByRole("button", { name: "Confirm Swap", exact: true }).click();
        await expect(
          page.getByRole("status").filter({ hasText: /^Swap confirmed: 0x/ })
        ).toBeVisible({ timeout: 30_000 });
        expect(hashes).toHaveLength(approvals + 1);
        const receipts = await Promise.all(
          hashes.map((hash) => client.getTransactionReceipt({ hash }))
        );
        for (const receipt of receipts) expect(receipt.status).toBe("success");
        const outputAfter = await client.readContract({
          address: network.usdc,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [ACCOUNT],
        });
        const minimum =
          (BigInt(quote.output_amount_raw) * BigInt(10_000 - quote.slippage_bps)) / 10_000n;
        expect(outputAfter - outputBefore).toBeGreaterThanOrEqual(minimum);
        await expect(page.getByLabel("To token balance")).toContainText(
          formatUnits(outputAfter, 6)
        );
        if (!native) await expect(page.getByLabel("From token balance")).toContainText("0.99");
        const inputAfter = native
          ? await client.getBalance({ address: ACCOUNT })
          : await client.readContract({
              address: network.weth,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [ACCOUNT],
            });
        if (native)
          expect(inputBefore - inputAfter).toBeGreaterThanOrEqual(BigInt(quote.input_amount_raw));
        else expect(inputBefore - inputAfter).toBe(BigInt(quote.input_amount_raw));
        await info.attach("trade-evidence", {
          body: JSON.stringify(
            {
              chainId: network.chain.id,
              provider: quote.provider,
              hashes,
              inputSpent: String(inputBefore - inputAfter),
              outputReceived: String(outputAfter - outputBefore),
              minimumOutput: String(minimum),
            },
            null,
            2
          ),
          contentType: "application/json",
        });
      } finally {
        const receipts = await Promise.all(
          hashes.map((hash) => client.getTransactionReceipt({ hash }))
        );
        await info.attach("receipts", {
          body: JSON.stringify(
            receipts,
            (_key, value) => (typeof value === "bigint" ? String(value) : value),
            2
          ),
          contentType: "application/json",
        });
        for (const receipt of receipts) {
          if (receipt.status === "reverted") {
            const trace = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "debug_traceTransaction",
                params: [receipt.transactionHash, { tracer: "callTracer" }],
              }),
            }).then((r) => r.text());
            await info.attach("reverted-call-trace", {
              body: trace,
              contentType: "application/json",
            });
          }
        }
        await control.revert({ id: snapshot });
      }
    });
  }
}

test("Ethereum: unfunded 1,000 USDC to crvUSD retains prices and blocks submission", async ({
  page,
  request,
}, info) => {
  const url = process.env.FORK_TEST_RPC_1;
  if (!url) throw new Error("Missing Ethereum fork");
  if (new URL(url).hostname !== "127.0.0.1") throw new Error("Use an isolated local fork");
  const account: Address = "0x56f63e8e92a743b9e6a1f459d2c3870e15b4a062";
  const usdc: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const crvusd = "0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E";
  const client = createPublicClient({ chain: mainnet, transport: http(url) });
  const control = createTestClient({ mode: "anvil", transport: http(url) });
  const snapshot = await control.snapshot();
  let sends = 0;
  try {
    await control.setBalance({ address: account, value: 0n });
    expect(
      await client.readContract({
        address: usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
      })
    ).toBe(0n);
    const params = new URLSearchParams({
      chainId: "1",
      from: usdc,
      to: crvusd,
      amount: "1000",
      sender: account,
    });
    const response = await request.get(`http://127.0.0.1:3120/quote?${params}`, { timeout: 60000 });
    expect(response.ok()).toBe(true);
    const prices = (await response.json()) as components["schemas"]["QuoteResponse"];
    expect(prices.quotes.some((quote) => quote.provider === "curve")).toBe(true);
    expect(prices.simulation_basis).toBe("temporary_funding");
    for (const quote of prices.quotes) expect(quote.sender).toBe(account);
    await info.attach("unfunded-price-simulations", {
      body: JSON.stringify(prices, null, 2),
      contentType: "application/json",
    });
    await installWallet(page, 1, account, async (method, params) => {
      if (method === "eth_sendTransaction") sends++;
      const data = (await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }).then((r) => r.json())) as { result?: unknown; error?: { message: string } };
      if (data.error) throw new Error(data.error.message);
      return data.result;
    });
    params.delete("sender");
    await page.goto(`/?${params}`);
    await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
    await page.getByRole("button", { name: "Connect with Local fork wallet" }).click();
    await expect(page.getByLabel("From token balance")).toContainText("Balance: 0 USDC");
    await expect(page.getByText("Insufficient USDC balance.", { exact: true })).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByRole("button", { name: "Execute swap" })).toBeDisabled();
    await expect(page.getByText(/Price simulations use temporary funding/)).toBeVisible();
    expect(sends).toBe(0);
    expect(await client.getBalance({ address: account })).toBe(0n);
    await page.screenshot({ path: info.outputPath("unfunded-usdc-crvusd.png"), fullPage: true });
  } finally {
    await control.revert({ id: snapshot });
  }
});
