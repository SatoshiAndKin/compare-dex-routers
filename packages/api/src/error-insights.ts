import { logger } from "./logger.js";

interface ErrorPattern {
  message: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  contexts: string[];
}

const errorPatterns = new Map<string, ErrorPattern>();
const ERROR_THRESHOLD = 5;
const MAX_CONTEXTS = 10;

function normalizeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function trackError(err: unknown, context: string): void {
  const message = normalizeErrorMessage(err);
  const key = message.slice(0, 200);
  const now = new Date();

  const existing = errorPatterns.get(key);
  if (existing) {
    existing.count++;
    existing.lastSeen = now;
    if (existing.contexts.length < MAX_CONTEXTS && !existing.contexts.includes(context)) {
      existing.contexts.push(context);
    }
  } else {
    errorPatterns.set(key, {
      message: key,
      count: 1,
      firstSeen: now,
      lastSeen: now,
      contexts: [context],
    });
  }

  if (existing && existing.count === ERROR_THRESHOLD) {
    logger.warn(
      {
        event: "error_pattern_detected",
        message: key,
        count: existing.count,
        contexts: existing.contexts,
      },
      `Recurring error pattern detected (${ERROR_THRESHOLD}+ occurrences): ${key.slice(0, 100)}`
    );
  }
}

export function getErrorInsights(): {
  patterns: {
    message: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
    contexts: string[];
  }[];
  totalPatterns: number;
  recurringPatterns: number;
} {
  const patterns = [...errorPatterns.values()]
    .sort((a, b) => b.count - a.count)
    .map((p) => ({
      message: p.message,
      count: p.count,
      firstSeen: p.firstSeen.toISOString(),
      lastSeen: p.lastSeen.toISOString(),
      contexts: p.contexts,
    }));

  return {
    patterns,
    totalPatterns: patterns.length,
    recurringPatterns: patterns.filter((p) => p.count >= ERROR_THRESHOLD).length,
  };
}
