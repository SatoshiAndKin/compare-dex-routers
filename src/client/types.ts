/**
 * Shared TypeScript interfaces for the client-side application.
 * These mirror the data structures used in the inline JS of server.ts.
 */

/** Token from a tokenlist source */
export interface Token {
  address: string;
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  /** Which tokenlist source this token came from */
  _source?: string;
  /** Whether this token needs disambiguation (same symbol, different address) */
  _needsDisambiguation?: boolean;
}

/** Tokenlist source entry in the multi-tokenlist data model */
export interface TokenlistSource {
  /** URL of the tokenlist (null for the default/built-in tokenlist) */
  url: string | null;
  enabled: boolean;
  name: string;
  tokens: Token[];
  error: string | null;
  /** Marks a duplicate entry that was filtered during migration */
  _duplicate?: boolean;
}

/** Compare parameters read from the form */
export interface CompareParams {
  chainId: string;
  from: string;
  to: string;
  amount: string;
  slippageBps: string;
  mode: "exactIn" | "targetOut";
  sender: string;
}

/** User preferences stored in localStorage */
export interface UserPreferences {
  chainId?: string;
  amount?: string;
  slippageBps?: string;
  mode?: string;
  sellAmount?: string;
  receiveAmount?: string;
  perChainTokens?: Record<string, { from?: string; to?: string }>;
}

/** Quote response from /quote endpoint (Spandex) */
export interface QuoteResponse {
  chainId?: number;
  from?: string;
  from_symbol?: string;
  to?: string;
  to_symbol?: string;
  amount?: string;
  input_amount?: string;
  output_amount?: string;
  input_amount_raw?: string;
  output_amount_raw?: string;
  mode?: string;
  provider?: string;
  slippage_bps?: number;
  gas_used?: string;
  gas_cost_eth?: string;
  gas_price_gwei?: string;
  net_value_eth?: string;
  router_address?: string;
  router_calldata?: string;
  router_value?: string;
  approval_token?: string;
  approval_spender?: string;
  output_value_eth?: string;
  error?: string;
}

/** Quote response from /quote-curve endpoint */
export interface CurveQuoteResponse {
  source?: "curve";
  from?: string;
  from_symbol?: string;
  to?: string;
  to_symbol?: string;
  amount?: string;
  input_amount?: string;
  output_amount?: string;
  input_amount_raw?: string;
  output_amount_raw?: string;
  mode?: string;
  route?: CurveRouteStep[];
  route_symbols?: Record<string, string>;
  router_address?: string;
  router_calldata?: string;
  gas_used?: string;
  gas_cost_eth?: string;
  net_value_eth?: string;
  output_value_eth?: string;
  approval_target?: string;
  approval_calldata?: string;
  error?: string;
}

/** A single step in a Curve route */
export interface CurveRouteStep {
  poolId?: string;
  poolName?: string;
  inputCoinAddress?: string;
  outputCoinAddress?: string;
}

/** Progressive quote state tracking both router quotes */
export interface ProgressiveQuoteState {
  spandex: QuoteResponse | null;
  spandexError: string | null;
  curve: CurveQuoteResponse | null;
  curveError: string | null;
  recommendation: "spandex" | "curve" | null;
  recommendationReason: string | null;
  gasPriceGwei: string | null;
  outputToEthRate: number | null;
  inputToEthRate: number | null;
  mode: string | null;
  complete: boolean;
  singleRouterMode: boolean;
}

/** Chain definition for the chain selector dropdown */
export interface ChainDefinition {
  id: string;
  name: string;
}

/** EIP-6963 wallet provider info */
export interface WalletProviderInfo {
  uuid: string;
  name: string;
  icon?: string;
  rdns?: string;
}

/** EIP-6963 wallet provider detail */
export interface WalletProviderDetail {
  info: WalletProviderInfo;
  provider: EIP1193Provider;
}

/** Minimal EIP-1193 provider interface used in wallet interactions */
export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}
