import * as Sentry from "@sentry/node";
import { request } from "node:https";
import { logger } from "./logger.js";
import { redact } from "./redaction.js";

const uploadTimeoutMs = 2_000;
const configuredDsn = process.env.SENTRY_DSN;
const dsn =
  configuredDsn && URL.parse(configuredDsn)?.protocol === "https:" ? configuredDsn : undefined;

if (dsn) {
  Sentry.pinoIntegration.trackLogger(logger);
  const client = Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: 0.1,
    transport: (options) =>
      Sentry.makeNodeTransport({
        ...options,
        // One native HTTPS request per envelope. Native requests never follow redirects.
        keepAlive: false,
        httpModule: {
          request(options, callback) {
            if (
              typeof options !== "object" ||
              options instanceof URL ||
              options.protocol !== "https:"
            ) {
              throw new Error("Sentry uploads require HTTPS");
            }
            return request(
              {
                ...options,
                rejectUnauthorized: true,
                signal: AbortSignal.timeout(uploadTimeoutMs),
              },
              callback
            );
          },
        },
      }),
    integrations: [
      Sentry.pinoIntegration({
        autoInstrument: false,
        error: { levels: ["warn", "error", "fatal"] },
        log: { levels: [] },
      }),
    ],
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

export async function flushTelemetry(timeoutMs: number): Promise<boolean> {
  const [sentryFlushed] = await Promise.all([
    dsn ? Sentry.flush(timeoutMs) : Promise.resolve(true),
    new Promise<void>((resolve, reject) =>
      logger.flush((error) => (error ? reject(error) : resolve()))
    ),
  ]);
  return sentryFlushed;
}
