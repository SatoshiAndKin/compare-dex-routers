import * as Sentry from "@sentry/node";
import { logger } from "./logger.js";
import { redact } from "./redaction.js";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.1,
    beforeSend: (event) => redact(event) as typeof event,
    beforeSendTransaction: (event) => redact(event) as typeof event,
  });
}

export function captureException(err: unknown, context?: Record<string, unknown>) {
  if (dsn) {
    Sentry.captureException(redact(err), { extra: redact(context) as Record<string, unknown> });
  }
}

export function captureMessage(message: string, level: "info" | "warning" | "error" = "info") {
  if (dsn) {
    Sentry.captureMessage(String(redact(message)), level);
  }
}

export async function flushTelemetry(timeoutMs: number): Promise<boolean> {
  const [sentryFlushed] = await Promise.all([
    dsn ? Sentry.flush(timeoutMs) : Promise.resolve(true),
    new Promise<void>((resolve, reject) =>
      logger.flush((error) => (error ? reject(error) : resolve()))
    ),
  ]);
  return sentryFlushed;
}
