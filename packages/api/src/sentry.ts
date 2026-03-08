import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.1,
  });
}

export function captureException(err: unknown, context?: Record<string, unknown>) {
  if (dsn) {
    Sentry.captureException(err, { extra: context });
  }
}

export function captureMessage(message: string, level: "info" | "warning" | "error" = "info") {
  if (dsn) {
    Sentry.captureMessage(message, level);
  }
}
