import * as Sentry from "@sentry/node";
import { logger } from "./logger.js";
import { redact } from "./redaction.js";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  const client = Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.1,
    beforeSend: (event) => redact(event) as typeof event,
    beforeSendSpan: (span) => redact(span) as typeof span,
    // Preserve the v10 data collection limits when using the v11 defaults.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
        response: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
      },
      httpBodies: [],
      urlQueryParams: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      graphQL: { document: false, variables: false },
    },
  });
  // Trace envelope headers and propagated baggage also carry the transaction name.
  client?.on("createDsc", (context) => Object.assign(context, redact(context)));
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
