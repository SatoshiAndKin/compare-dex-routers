import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { walletStore, type EIP6963ProviderDetail } from "../lib/stores/walletStore.svelte.js";
import { deferred, SENDER } from "./quote-fixture.js";

const connectors = vi.hoisted(() => ({
  init: vi.fn(),
  mini: vi.fn(),
  provider: vi.fn(),
  ready: vi.fn(),
}));
vi.mock("@walletconnect/ethereum-provider", () => ({
  EthereumProvider: { init: connectors.init },
}));
vi.mock("@farcaster/miniapp-sdk", () => ({
  sdk: {
    isInMiniApp: connectors.mini,
    wallet: { getEthereumProvider: connectors.provider },
    actions: { ready: connectors.ready },
  },
}));

function wallet(rdns = "test.wallet", accounts: Promise<string[]> = Promise.resolve([SENDER])) {
  return {
    info: { uuid: crypto.randomUUID(), name: rdns, rdns },
    provider: {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === "eth_accounts" || method === "eth_requestAccounts") return accounts;
        if (method === "eth_chainId") return "0x2105";
        throw new Error(`Unexpected method ${method}`);
      }),
      on: vi.fn(),
      removeListener: vi.fn(),
    },
  };
}
function announce(detail: EIP6963ProviderDetail) {
  window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
}
beforeEach(() => {
  walletStore.stopDiscovery();
  walletStore.disconnect();
  walletStore.discoveredProviders = [];
  walletStore.setMessage("");
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  walletStore.stopDiscovery();
  vi.restoreAllMocks();
});

describe("silent wallet restoration", () => {
  it("restores an already approved account on discovery without asking for permission", async () => {
    const detail = wallet();
    walletStore.startDiscovery();
    announce(detail);
    await vi.waitFor(() => expect(walletStore.address).toBe(SENDER));
    expect(walletStore.chainId).toBe(8453);
    expect(detail.provider.request.mock.calls.map(([args]) => args.method)).not.toContain(
      "eth_requestAccounts"
    );
    expect(localStorage.getItem("compare-dex-wallet")).toBe("test.wallet");
    expect(detail.provider.on.mock.calls.map(([event]) => event)).toEqual([
      "accountsChanged",
      "chainChanged",
    ]);
  });

  it("waits for the remembered wallet even if another authorized wallet announces first", async () => {
    localStorage.setItem("compare-dex-wallet", "preferred.wallet");
    const other = wallet();
    const preferred = wallet("preferred.wallet");
    walletStore.startDiscovery();
    announce(other);
    announce(preferred);
    await vi.waitFor(() => expect(walletStore.walletInfo?.uuid).toBe(preferred.info.uuid));
    expect(other.provider.request).not.toHaveBeenCalled();
  });

  it.each(["locked", "revoked", "error"])(
    "leaves %s wallets disconnected without a popup or error",
    async (state) => {
      const detail = wallet("test.wallet", Promise.resolve([]));
      if (state === "error") detail.provider.request.mockRejectedValue(new Error("Unavailable"));
      walletStore.startDiscovery();
      announce(detail);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(walletStore.address).toBeNull();
      expect(walletStore.message).toBe("");
      expect(detail.provider.request.mock.calls.map(([args]) => args.method)).toEqual([
        "eth_accounts",
      ]);
    }
  );

  it.each(["disconnect", "manual", "stop"])(
    "discards a pending restoration after %s",
    async (action) => {
      const pending = deferred<string[]>();
      const detail = wallet("old.wallet", pending.promise);
      walletStore.startDiscovery();
      announce(detail);
      if (action === "disconnect") walletStore.disconnect();
      if (action === "stop") walletStore.stopDiscovery();
      if (action === "manual") await walletStore.connect(wallet("chosen.wallet"));
      pending.resolve([SENDER]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(walletStore.walletInfo?.rdns ?? null).toBe(
        action === "manual" ? "chosen.wallet" : null
      );
      expect(detail.provider.on).not.toHaveBeenCalled();
    }
  );

  it("respects explicit disconnect across reloads and permits a later manual connection", async () => {
    await walletStore.connect(wallet());
    walletStore.disconnect();
    walletStore.startDiscovery();
    const detail = wallet();
    announce(detail);
    expect(detail.provider.request).not.toHaveBeenCalled();
    await walletStore.connect(detail);
    expect(walletStore.address).toBe(SENDER);
    expect(localStorage.getItem("compare-dex-wallet")).toBe("test.wallet");
  });

  it("removes previous listeners when switching wallets", async () => {
    const first = wallet();
    await walletStore.connect(first);
    await walletStore.connect(wallet("next.wallet"));
    expect(first.provider.removeListener.mock.calls.map(([event]) => event)).toEqual([
      "accountsChanged",
      "chainChanged",
    ]);
  });

  it("still restores when browser storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    // A fresh page has no stored preference.
    walletStore.startDiscovery();
    await walletStore.connect(wallet());
    walletStore.disconnect(false);
    announce(wallet());
    await vi.waitFor(() => expect(walletStore.address).toBe(SENDER));
  });

  it.each([true, false])(
    "restores WalletConnect only with an existing session (%s)",
    async (session) => {
      localStorage.setItem("compare-dex-wallet", "walletconnect");
      walletStore.startDiscovery();
      const detail = wallet("walletconnect");
      const connect = vi.fn();
      connectors.init.mockResolvedValue({
        ...detail.provider,
        session: session ? {} : undefined,
        connect,
      });
      await walletStore.restoreSession("project");
      expect(walletStore.address).toBe(session ? SENDER : null);
      expect(connectors.init).toHaveBeenCalledWith(expect.objectContaining({ showQrModal: false }));
      expect(connect).not.toHaveBeenCalled();
      expect(detail.provider.request.mock.calls.map(([args]) => args.method)).not.toContain(
        "eth_requestAccounts"
      );
    }
  );

  it("silently restores the previously chosen Farcaster wallet", async () => {
    localStorage.setItem("compare-dex-wallet", "farcaster");
    walletStore.startDiscovery();
    const detail = wallet("farcaster");
    connectors.mini.mockResolvedValue(true);
    connectors.provider.mockResolvedValue(detail.provider);
    await walletStore.restoreSession("");
    expect(walletStore.address).toBe(SENDER);
    expect(detail.provider.request.mock.calls.map(([args]) => args.method)).not.toContain(
      "eth_requestAccounts"
    );
  });
});
