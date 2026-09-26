import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { transactionExplorer, explorerBase } from "../lib/explorers.js";
import {
  preferencesStore,
  getChainPreferences,
  savePreferences,
} from "../lib/stores/preferencesStore.svelte.js";
import { walletStore } from "../lib/stores/walletStore.svelte.js";
import { settingsStore } from "../lib/stores/settingsStore.svelte.js";
import { formStore } from "../lib/stores/formStore.svelte.js";
import WalletButton from "../lib/components/WalletButton.svelte";
import SettingsModal from "../lib/components/SettingsModal.svelte";

const hash = `0x${"a".repeat(64)}`;
beforeEach(() => {
  localStorage.clear();
  walletStore.setMessage("");
  formStore.chainId = 1;
});

describe("transaction explorers", () => {
  it.each([
    [1, "etherscan.io"],
    [10, "optimistic.etherscan.io"],
    [8453, "basescan.org"],
    [42161, "arbiscan.io"],
    [56, "bscscan.com"],
    [137, "polygonscan.com"],
    [43114, "snowtrace.io"],
  ] as const)("links chain %s to its explorer", (chainId, host) => {
    expect(transactionExplorer({ chainId, hash })?.url).toBe(`https://${host}/tx/${hash}`);
  });
  it.each([
    "javascript:alert(1)",
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com?x=1",
    "https://example.com/#fragment",
    "not a url",
    {},
  ])("rejects an invalid stored override %s and uses the default", (value) => {
    savePreferences({ chains: { 1: { explorerUrl: value as string } } });
    expect(explorerBase(value)).toBeNull();
    expect(transactionExplorer({ chainId: 1, hash }, preferencesStore.getExplorerUrl(1))?.url).toBe(
      `https://etherscan.io/tx/${hash}`
    );
  });
  it("preserves per-chain explorer choices when saving trade preferences and supports reset", () => {
    expect(preferencesStore.setExplorerUrl(1, " https://eth.blockscout.com/ ")).toBeNull();
    preferencesStore.setExplorerUrl(8453, "https://base.blockscout.com");
    preferencesStore.saveForChain(1);
    expect(getChainPreferences(1)?.explorerUrl).toBe("https://eth.blockscout.com");
    expect(transactionExplorer({ chainId: 1, hash }, preferencesStore.getExplorerUrl(1))?.url).toBe(
      `https://eth.blockscout.com/tx/${hash}`
    );
    preferencesStore.setExplorerUrl(1, "");
    expect(preferencesStore.getExplorerUrl(1)).toBeNull();
    expect(preferencesStore.getExplorerUrl(8453)).toBe("https://base.blockscout.com");
  });
  it("keeps a confirmation link on its submitted chain and clears it with unrelated messages", async () => {
    walletStore.chainId = 1;
    walletStore.setMessage("Swap confirmed", false, { chainId: 1, hash });
    const view = render(WalletButton);
    const link = view.getByRole("link", { name: "View on Etherscan ↗" });
    expect(link).toHaveAttribute("href", `https://etherscan.io/tx/${hash}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    walletStore.chainId = 8453;
    await tick();
    expect(link).toHaveAttribute("href", `https://etherscan.io/tx/${hash}`);
    await fireEvent.click(view.getByText("Transaction details"));
    expect(view.getByText(hash)).toBeVisible();
    preferencesStore.setExplorerUrl(1, "https://eth.blockscout.com");
    await tick();
    expect(view.getByRole("link")).toHaveAttribute("href", `https://eth.blockscout.com/tx/${hash}`);
    walletStore.setMessage("Connection failed", true);
    await tick();
    expect(view.queryByRole("link")).toBeNull();
    expect(view.queryByText(hash)).toBeNull();
    expect(walletStore.messageTransaction).toBeNull();
  });
  it("saves, validates and resets explorer settings for the current trade chain", async () => {
    settingsStore.openSettings();
    const view = render(SettingsModal);
    const input = view.getByLabelText(/Block explorer for/);
    await fireEvent.input(input, { target: { value: "https://eth.blockscout.com" } });
    await fireEvent.click(view.getByText("Save explorer"));
    expect(view.getByText("Explorer preference saved.")).toBeVisible();
    expect(preferencesStore.getExplorerUrl(1)).toBe("https://eth.blockscout.com");
    await fireEvent.input(input, { target: { value: "javascript:alert(1)" } });
    await fireEvent.click(view.getByText("Save explorer"));
    expect(view.getByRole("alert")).toHaveTextContent("Enter an HTTPS explorer URL");
    expect(preferencesStore.getExplorerUrl(1)).toBe("https://eth.blockscout.com");
    await fireEvent.click(view.getByText("Use chain default"));
    expect(input).toHaveValue("");
    expect(preferencesStore.getExplorerUrl(1)).toBeNull();
    settingsStore.closeSettings();
  });
  it("keeps unknown chains and malformed hashes from producing incorrect links", () => {
    expect(transactionExplorer({ chainId: 999999, hash })).toBeNull();
    expect(transactionExplorer({ chainId: 1, hash: "0x123" })).toBeNull();
  });
});
