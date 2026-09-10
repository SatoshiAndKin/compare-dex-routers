import { formStore } from "./formStore.svelte.js";
import { preferencesStore } from "./preferencesStore.svelte.js";
import { configStore } from "./configStore.svelte.js";
import { tokensStore } from "./tokensStore.svelte.js";
import { comparisonStore } from "./comparisonStore.svelte.js";
import { autoRefreshStore } from "./autoRefreshStore.svelte.js";

export function applyDefaults(): void {
  const chainId = formStore.chainId;
  const defaults = configStore.defaultTokens[String(chainId)];
  if (defaults) {
    formStore.fromToken ??= { address: defaults.from, symbol: "", decimals: null, chainId };
    formStore.toToken ??= { address: defaults.to, symbol: "", decimals: null, chainId };
  }
  if (!formStore.sellAmount && !formStore.receiveAmount) formStore.sellAmount = "1";
}

export function selectChain(chainId: number): void {
  if (chainId === formStore.chainId) return;
  preferencesStore.saveForChain(formStore.chainId);
  comparisonStore.invalidate();
  autoRefreshStore.stop();
  formStore.fromToken = null;
  formStore.toToken = null;
  formStore.chainId = chainId;
  preferencesStore.applyToForm(chainId);
  applyDefaults();
}

export async function resolveSelectedTokens(): Promise<string | null> {
  const chainId = formStore.chainId;
  const errors = await Promise.all(
    (["fromToken", "toToken"] as const).map(async (side) => {
      const token = formStore[side];
      if (!token || token.decimals !== null) return null;
      try {
        const resolved = await tokensStore.resolve(chainId, token.address);
        if (formStore.chainId === chainId && formStore[side] === token) formStore[side] = resolved;
        return null;
      } catch (error) {
        if (formStore.chainId !== chainId || formStore[side] !== token) return null;
        return error instanceof Error ? error.message : "Cannot load token metadata";
      }
    })
  );
  return errors.find((error) => error !== null) ?? null;
}
