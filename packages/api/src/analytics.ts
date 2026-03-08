import { logger } from "./logger.js";

interface QuoteEvent {
  chainId: number;
  fromToken: string;
  toToken: string;
  provider: string;
  durationMs: number;
  success: boolean;
  outputAmount?: string;
}

interface AnalyticsSummary {
  totalQuotes: number;
  successRate: number;
  avgDurationMs: number;
  topPairs: { pair: string; count: number }[];
  topChains: { chainId: number; count: number }[];
}

const events: QuoteEvent[] = [];
const MAX_EVENTS = 10000;

export function trackQuote(event: QuoteEvent): void {
  events.push(event);
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }

  logger.debug(
    {
      event: "quote_tracked",
      chainId: event.chainId,
      pair: `${event.fromToken}-${event.toToken}`,
      provider: event.provider,
      durationMs: event.durationMs,
      success: event.success,
    },
    "analytics: quote tracked"
  );
}

export function getAnalyticsSummary(): AnalyticsSummary {
  const successCount = events.filter((e) => e.success).length;
  const totalDuration = events.reduce((sum, e) => sum + e.durationMs, 0);

  const pairCounts = new Map<string, number>();
  const chainCounts = new Map<number, number>();

  for (const event of events) {
    const pair = `${event.fromToken.slice(0, 10)}-${event.toToken.slice(0, 10)}`;
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    chainCounts.set(event.chainId, (chainCounts.get(event.chainId) ?? 0) + 1);
  }

  const topPairs = [...pairCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pair, count]) => ({ pair, count }));

  const topChains = [...chainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([chainId, count]) => ({ chainId, count }));

  return {
    totalQuotes: events.length,
    successRate: events.length > 0 ? successCount / events.length : 0,
    avgDurationMs: events.length > 0 ? Math.round(totalDuration / events.length) : 0,
    topPairs,
    topChains,
  };
}
