/**
 * Form store managing all quote comparison form state.
 * Uses Svelte 5 class-based runes pattern.
 */

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  name?: string;
  logoURI?: string;
  chainId?: number;
}

class FormStore {
  chainId = $state(1); // default to Ethereum
  fromToken = $state<TokenInfo | null>(null);
  toToken = $state<TokenInfo | null>(null);
  sellAmount = $state('');
  receiveAmount = $state('');
  mode = $state<'exactIn' | 'targetOut'>('exactIn');
  slippageBps = $state(50); // default 50 bps (0.5%)
  isLoading = $state(false);

  // Derived: is form ready to submit?
  get canSubmit(): boolean {
    return (
      this.fromToken !== null &&
      this.toToken !== null &&
      (this.sellAmount !== '' || this.receiveAmount !== '')
    );
  }
}

export const formStore = new FormStore();
