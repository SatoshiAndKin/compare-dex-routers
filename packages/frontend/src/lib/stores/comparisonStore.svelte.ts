import type { components } from "../../generated/api-types.js";
import { apiClient } from "../api.js";

export type Quote = components["schemas"]["Quote"];
export type QuoteResponse = components["schemas"]["QuoteResponse"];
export interface CompareParams {
  chainId: number;
  from: string;
  to: string;
  amount: string;
  slippageBps: number;
  mode: "exactIn" | "targetOut";
  sender?: string;
}

export async function requestQuotes(
  params: CompareParams,
  signal?: AbortSignal
): Promise<QuoteResponse> {
  const { data, error } = await apiClient.GET("/quote", { params: { query: params }, signal });
  if (error || !data) throw new Error(error?.error ?? "Quote request failed");
  return data;
}

class ComparisonStore {
  quotes = $state<Quote[]>([]);
  failures = $state<QuoteResponse["failures"]>([]);
  error = $state<string | null>(null);
  isLoading = $state(false);
  isStale = $state(false);
  gasPriceGwei = $state<string | null>(null);
  recommendation = $state<string | null>(null);
  recommendationReason = $state<string | null>(null);
  selectedProvider = $state<string | null>(null);
  activeProvider = $derived(this.selectedProvider ?? this.recommendation);
  activeQuote = $derived(
    this.quotes.find((quote) => quote.provider === this.activeProvider) ?? null
  );
  mode = $state<"exactIn" | "targetOut">("exactIn");
  hasResults = $derived(
    this.quotes.length > 0 ||
      this.failures.length > 0 ||
      this.error !== null ||
      this.isLoading ||
      this.recommendationReason !== null
  );
  private updatedAt = 0;
  private abortController: AbortController | null = null;
  private sequence = 0;

  cancel(): void {
    this.sequence++;
    this.abortController?.abort();
    this.abortController = null;
    this.isLoading = false;
  }

  invalidate(retainResults = false): void {
    this.cancel();
    // Retained results are display-only until a replacement request succeeds.
    this.isStale = retainResults;
    if (retainResults) return;
    this.quotes = [];
    this.failures = [];
    this.error = null;
    this.gasPriceGwei = null;
    this.recommendation = null;
    this.recommendationReason = null;
    this.selectedProvider = null;
    this.updatedAt = 0;
  }

  isCurrent(quote: Quote): boolean {
    return !this.isStale && !this.isLoading && !this.error && this.quotes.includes(quote);
  }

  isFresh(quote: Quote): boolean {
    return this.isCurrent(quote) && Date.now() - this.updatedAt < 30_000;
  }

  async compare(params: CompareParams): Promise<void> {
    this.cancel();
    this.mode = params.mode;
    this.error = null;
    this.isLoading = true;
    this.isStale = true;
    const sequence = this.sequence;
    const controller = new AbortController();
    this.abortController = controller;
    try {
      const data = await requestQuotes(params, controller.signal);
      if (sequence !== this.sequence || controller.signal.aborted) return;
      this.quotes = data.quotes;
      this.failures = data.failures;
      this.gasPriceGwei = data.gas_price_gwei;
      this.recommendation = data.recommendation;
      this.recommendationReason = data.recommendation_reason;
      this.updatedAt = Date.now();
      this.isStale = false;
    } catch (error) {
      if (sequence !== this.sequence || controller.signal.aborted) return;
      this.error = error instanceof Error ? error.message : "Quote request failed";
    } finally {
      if (sequence === this.sequence) {
        this.isLoading = false;
        this.abortController = null;
      }
    }
  }
}
export const comparisonStore = new ComparisonStore();
