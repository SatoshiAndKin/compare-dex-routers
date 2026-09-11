import type { components } from "../../generated/api-types.js";
import { apiClient } from "../api.js";

export type Quote = components["schemas"]["Quote"];
export interface CompareParams {
  chainId: number;
  from: string;
  to: string;
  amount: string;
  slippageBps: number;
  mode: "exactIn" | "targetOut";
  sender?: string;
}

class ComparisonStore {
  spandexResult = $state<Quote | null>(null);
  curveResult = $state<Quote | null>(null);
  spandexError = $state<string | null>(null);
  curveError = $state<string | null>(null);
  isLoading = $state(false);
  gasPriceGwei = $state<string | null>(null);
  recommendation = $state<"spandex" | "curve" | null>(null);
  recommendationReason = $state<string | null>(null);
  activeTab = $state<"recommended" | "alternative">("recommended");
  mode = $state<"exactIn" | "targetOut">("exactIn");
  hasResults = $derived(
    this.spandexResult !== null ||
      this.curveResult !== null ||
      this.spandexError !== null ||
      this.curveError !== null ||
      this.isLoading
  );
  private abortController: AbortController | null = null;
  private sequence = 0;

  cancel(): void {
    this.sequence++;
    this.abortController?.abort();
    this.abortController = null;
    this.isLoading = false;
  }

  invalidate(): void {
    this.cancel();
    this.spandexResult = null;
    this.curveResult = null;
    this.spandexError = null;
    this.curveError = null;
    this.gasPriceGwei = null;
    this.recommendation = null;
    this.recommendationReason = null;
  }

  isCurrent(quote: Quote): boolean {
    return !this.isLoading && (quote === this.spandexResult || quote === this.curveResult);
  }

  async compare(params: CompareParams): Promise<void> {
    this.invalidate();
    this.mode = params.mode;
    this.activeTab = "recommended";
    this.isLoading = true;
    const sequence = this.sequence;
    const controller = new AbortController();
    this.abortController = controller;
    try {
      const { data, error } = await apiClient.GET("/compare", {
        params: { query: params },
        signal: controller.signal,
      });
      if (sequence !== this.sequence || controller.signal.aborted) return;
      if (error || !data) throw new Error(error?.error ?? "Comparison failed");
      this.spandexResult = data.spandex;
      this.curveResult = data.curve;
      this.spandexError = data.spandex_error;
      this.curveError = data.curve_error;
      this.gasPriceGwei = data.gas_price_gwei;
      this.recommendation = data.recommendation;
      this.recommendationReason = data.recommendation_reason;
    } catch (error) {
      if (sequence !== this.sequence || controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Comparison failed";
      this.spandexError = message;
      this.curveError = message;
    } finally {
      if (sequence === this.sequence) {
        this.isLoading = false;
        this.abortController = null;
      }
    }
  }
}

export const comparisonStore = new ComparisonStore();
