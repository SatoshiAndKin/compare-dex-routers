import type { Page } from "@playwright/test";

export async function installWallet(
  page: Page,
  chainId: number,
  account: string,
  request: (method: string, params: unknown[]) => Promise<unknown>
) {
  await page.exposeBinding(
    "testWalletRpc",
    (_source, args: { method: string; params?: unknown[] }) =>
      request(args.method, args.params ?? [])
  );
  await page.addInitScript(
    ({ chainId, account }) => {
      let rejectNext = false;
      const events = new Map<string, Set<(...args: unknown[]) => void>>();
      const provider = {
        async request(args: { method: string; params?: unknown[] }) {
          if (args.method === "eth_sendTransaction" && rejectNext) {
            rejectNext = false;
            throw Object.assign(new Error("User rejected transaction"), { code: 4001 });
          }
          if (args.method === "eth_requestAccounts" || args.method === "eth_accounts")
            return [account];
          if (args.method === "eth_chainId") return `0x${chainId.toString(16)}`;
          return (
            window as unknown as { testWalletRpc: (args: unknown) => Promise<unknown> }
          ).testWalletRpc(args);
        },
        on(event: string, handler: (...args: unknown[]) => void) {
          const handlers = events.get(event) ?? new Set();
          handlers.add(handler);
          events.set(event, handlers);
        },
        removeListener(event: string, handler: (...args: unknown[]) => void) {
          events.get(event)?.delete(handler);
        },
      };
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: {
                uuid: "b6a665c7-798d-458a-943e-529ce6c7df2d",
                name: "Local fork wallet",
                rdns: "test.anvil",
              },
              provider,
            },
          })
        );
      window.addEventListener("eip6963:requestProvider", announce);
      Object.assign(window, {
        testWallet: {
          rejectNextTransaction() {
            rejectNext = true;
          },
          changeAccount(next: string) {
            account = next;
            for (const handler of events.get("accountsChanged") ?? []) handler([next]);
          },
          changeChain(next: number) {
            chainId = next;
            for (const handler of events.get("chainChanged") ?? [])
              handler(`0x${next.toString(16)}`);
          },
        },
      });
    },
    { chainId, account }
  );
}
