/**
 * Comparison store managing progressive quote fetching and recommendation logic.
 * Fetches /api/quote (Spandex) and /api/quote-curve (Curve) in parallel,
 * updating state progressively as each response arrives.
 */

import type { components } from "../../generated/api-types.js";

// Extend SpandexQuote with gas_price_gwei (present in server response but not in OpenAPI schema)
export type SpandexQuote = components["schemas"]["SpandexQuote"] & {
  gas_price_gwei?: string;
  error?: string;
};

export type CurveQuote = components["schemas"]["CurveQuote"] & {
  input_amount_raw?: string;
  output_amount_raw?: string;
  approval_calldata?: string;
  error?: string;
};

export interface CompareParams {
  chainId: number;
  from: string;
  to: string;
  amount: string;
  slippageBps?: number;
  mode?: "exactIn" | "targetOut";
  sender?: string;
}

// Curve Finance is supported on these chains
const CURVE_SUPPORTED_CHAINS = [1, 8453, 42161, 10, 137, 56, 43114];

function computeRecommendation(
  spandex: SpandexQuote | null,
  curve: CurveQuote | null,
  mode: string,
  isSingleRouterMode: boolean
): { recommendation: "spandex" | "curve"; reason: string } | null {
  if (spandex && curve) {
    if (mode === "targetOut") {
      const spandexInput = Number(spandex.input_amount);
      const curveInput = Number(curve.input_amount);
      const inputSymbol = spandex.from_symbol ?? "tokens";
      if (curveInput < spandexInput) {
        const diff = spandexInput - curveInput;
        const pct = ((diff / spandexInput) * 100).toFixed(3);
        return {
          recommendation: "curve",
          reason: `Curve requires ${diff.toFixed(6)} ${inputSymbol} less (-${pct}%).`,
        };
      } else if (spandexInput < curveInput) {
        const diff = curveInput - spandexInput;
        const pct = ((diff / curveInput) * 100).toFixed(3);
        const provider = spandex.provider ?? "Spandex";
        return {
          recommendation: "spandex",
          reason: `Spandex (${provider}) requires ${diff.toFixed(6)} ${inputSymbol} less (-${pct}%).`,
        };
      } else {
        return {
          recommendation: "spandex",
          reason: "Equal input amounts; defaulting to Spandex for multi-provider coverage.",
        };
      }
    } else {
      // exactIn mode: higher output = better
      const spandexOutput = Number(spandex.output_amount);
      const curveOutput = Number(curve.output_amount);
      const outputSymbol = spandex.to_symbol ?? "tokens";
      if (curveOutput > spandexOutput) {
        const diff = curveOutput - spandexOutput;
        const pct = ((diff / spandexOutput) * 100).toFixed(3);
        return {
          recommendation: "curve",
          reason: `Curve outputs ${diff.toFixed(6)} ${outputSymbol} more (+${pct}%).`,
        };
      } else if (spandexOutput > curveOutput) {
        const diff = spandexOutput - curveOutput;
        const pct = ((diff / curveOutput) * 100).toFixed(3);
        const provider = spandex.provider ?? "Spandex";
        return {
          recommendation: "spandex",
          reason: `Spandex (${provider}) outputs ${diff.toFixed(6)} ${outputSymbol} more (+${pct}%).`,
        };
      } else {
        return {
          recommendation: "spandex",
          reason: "Equal output amounts; defaulting to Spandex for multi-provider coverage.",
        };
      }
    }
  } else if (spandex) {
    return {
      recommendation: "spandex",
      reason: isSingleRouterMode
        ? "Only Spandex is available on this chain."
        : "Only Spandex returned a quote.",
    };
  } else if (curve) {
    return {
      recommendation: "curve",
      reason: "Only Curve returned a quote.",
    };
  }

  return null;
}

class ComparisonStore {
  spandexResult = $state<SpandexQuote | null>(null);
  curveResult = $state<CurveQuote | null>(null);
  spandexError = $state<string | null>(null);
  curveError = $state<string | null>(null);
  spandexLoading = $state(false);
  curveLoading = $state(false);
  gasPriceGwei = $state<string | null>(null);
  recommendation = $state<"spandex" | "curve" | null>(null);
  recommendationReason = $state<string | null>(null);
  activeTab = $state<"recommended" | "alternative">("recommended");
  mode = $state<"exactIn" | "targetOut">("exactIn");
  isSingleRouterMode = $state(false);

  /** Any comparison in progress */
  isLoading = $derived(this.spandexLoading || this.curveLoading);

  /** Has any result or error to display */
  hasResults = $derived(
    this.spandexResult !== null ||
      this.curveResult !== null ||
      this.spandexError !== null ||
      this.curveError !== null ||
      this.spandexLoading ||
      this.curveLoading
  );

  private abortController: AbortController | null = null;
  private sequence = 0;

  /** Cancel any in-progress comparison */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /** Start a new comparison, cancelling any previous one */
  async compare(params: CompareParams): Promise<void> {
    this.cancel();

    // Reset state
    this.spandexResult = null;
    this.curveResult = null;
    this.spandexError = null;
    this.curveError = null;
    this.gasPriceGwei = null;
    this.recommendation = null;
    this.recommendationReason = null;
    this.mode = params.mode ?? "exactIn";
    this.activeTab = "recommended";

    const isSingleRouter = !CURVE_SUPPORTED_CHAINS.includes(params.chainId);
    this.isSingleRouterMode = isSingleRouter;

    // Set loading states
    this.spandexLoading = true;
    this.curveLoading = !isSingleRouter;

    const currentSequence = ++this.sequence;
    const abortController = new AbortController();
    this.abortController = abortController;
    const { signal } = abortController;

    const query = new URLSearchParams({
      chainId: String(params.chainId),
      from: params.from,
      to: params.to,
      amount: params.amount,
    });
    if (params.slippageBps !== undefined) {
      query.set("slippageBps", String(params.slippageBps));
    }
    if (params.mode) {
      query.set("mode", params.mode);
    }
    if (params.sender) {
      query.set("sender", params.sender);
    }

    const isStale = () => currentSequence !== this.sequence;

    const tryFinalize = () => {
      if (this.spandexLoading || (!isSingleRouter && this.curveLoading)) return;
      if (isStale()) return;
      if (this.recommendation !== null) return;

      const result = computeRecommendation(
        this.spandexResult,
        this.curveResult,
        params.mode ?? "exactIn",
        isSingleRouter
      );
      if (result) {
        this.recommendation = result.recommendation;
        this.recommendationReason = result.reason;
      }
    };

    const fetchSpandex = async () => {
      try {
        const response = await fetch(`/api/quote?${query.toString()}`, { signal });
        if (isStale() || signal.aborted) return;
        const data: SpandexQuote = (await response.json()) as SpandexQuote;
        if (isStale() || signal.aborted) return;
        if (!response.ok || data.error) {
          this.spandexError = data.error ?? `Spandex request failed with status ${response.status}`;
        } else {
          this.spandexResult = data;
          if (data.gas_price_gwei) {
            this.gasPriceGwei = data.gas_price_gwei;
          }
        }
      } catch (err) {
        if (signal.aborted || isStale()) return;
        this.spandexError = err instanceof Error ? err.message : "Spandex quote failed";
      } finally {
        this.spandexLoading = false;
        tryFinalize();
      }
    };

    const fetchCurve = async () => {
      if (isSingleRouter) {
        return;
      }
      try {
        const response = await fetch(`/api/quote-curve?${query.toString()}`, { signal });
        if (isStale() || signal.aborted) return;
        const data: CurveQuote = (await response.json()) as CurveQuote;
        if (isStale() || signal.aborted) return;
        if (!response.ok || data.error) {
          this.curveError = data.error ?? `Curve request failed with status ${response.status}`;
        } else {
          this.curveResult = data;
        }
      } catch (err) {
        if (signal.aborted || isStale()) return;
        this.curveError = err instanceof Error ? err.message : "Curve quote failed";
      } finally {
        this.curveLoading = false;
        tryFinalize();
      }
    };

    await Promise.all([fetchSpandex(), fetchCurve()]);

    if (this.abortController === abortController) {
      this.abortController = null;
    }
  }
}

export const comparisonStore = new ComparisonStore();
