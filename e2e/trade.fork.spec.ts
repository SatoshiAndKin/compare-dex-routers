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
    provider: "spandex",
  },
] as const;

for (const network of networks) {
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
              const result = await request.get(
                `http://127.0.0.1:3120/${network.provider === "curve" ? "quote-curve" : "quote"}?${params}`,
                { timeout: 30_000 }
              );
              return result.ok();
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
            response.url().includes("/api/compare?") &&
            new URL(response.url()).searchParams.get("sender")?.toLowerCase() ===
              ACCOUNT.toLowerCase()
        );
        await page.getByRole("button", { name: "Compare Quotes", exact: true }).click();
        const data = (await (await comparing).json()) as components["schemas"]["CompareResult"];
        let quote = data[network.provider];
        expect(quote, `No ${network.provider} quote returned`).not.toBeNull();
        if (!quote?.execution) throw new Error("Quote has no execution payload");
        await page
          .getByRole("tab", { name: network.provider === "curve" ? /Curve/ : /Spandex/ })
          .click();
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
          const approval = quote.execution.approval;
          if (!approval) throw new Error("ERC-20 quote is missing approval identity");
          const refreshed = page.waitForResponse(
            (response) => response.url().includes("/api/compare?") && response.ok()
          );
          await page.getByRole("button", { name: "Approve token spending" }).click();
          quote = ((await (await refreshed).json()) as components["schemas"]["CompareResult"])[
            network.provider
          ];
          if (!quote?.execution) throw new Error("Post-approval quote has no execution payload");
          await expect(
            page.getByRole("tab", { name: network.provider === "curve" ? /Curve/ : /Spandex/ })
          ).toHaveAttribute("aria-selected", "true");
          await expect(page.getByRole("button", { name: "Already approved" })).toBeVisible();
          const allowance = await client.readContract({
            address: network.weth,
            abi: erc20Abi,
            functionName: "allowance",
            args: [ACCOUNT, approval.spender as Address],
          });
          expect(allowance).toBeGreaterThanOrEqual(BigInt(quote.input_amount_raw));
        }
        await page.getByRole("button", { name: "Execute swap" }).click();
        await expect(page.getByRole("dialog", { name: "Confirm Swap" })).toBeVisible();
        await page.getByRole("button", { name: "Confirm Swap", exact: true }).click();
        await expect(
          page.getByRole("status").filter({ hasText: /^Swap confirmed: 0x/ })
        ).toBeVisible({ timeout: 30_000 });
        expect(hashes).toHaveLength(native ? 1 : 2);
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
