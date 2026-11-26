import * as Sentry from "@sentry/svelte";

const dsn = import.meta.env.VITE_SENTRY_DSN;
const release = import.meta.env.VITE_SENTRY_RELEASE;
// The bundled module URL identifies code that belongs to this build. Provider stacks are untrusted.
const assetUrl = import.meta.url.split(/[?#]/)[0];
const assetName = assetUrl.split("/").pop();
const errorTypes = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
]);

if (dsn && URL.parse(dsn)?.protocol === "https:" && /^[a-f0-9]{40}$/.test(release || "")) {
  Sentry.init({
    dsn,
    release,
    environment: import.meta.env.PROD ? "production" : "development",
    defaultIntegrations: false,
    integrations: [
      Sentry.globalHandlersIntegration(),
      Sentry.browserApiErrorsIntegration(),
      Sentry.dedupeIntegration(),
    ],
    maxBreadcrumbs: 0,
    tracesSampleRate: 0,
    dataCollection: { userInfo: false, cookies: false },
    sendClientReports: false,
    transport: (options) =>
      Sentry.makeFetchTransport(options, (url, init) =>
        fetch(url, {
          ...init,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
          signal: AbortSignal.timeout(2_000),
        })
      ),
    // Wallet/provider errors can contain signed data, addresses and secrets.
    // Keep only exception classes and generated-code locations for grouping.
    beforeSend(event, hint) {
      hint.attachments = [];
      return {
        type: event.type,
        event_id: event.event_id,
        timestamp: event.timestamp,
        platform: event.platform,
        level: event.level,
        release,
        environment: event.environment,
        exception: {
          values: event.exception?.values?.map((exception) => ({
            type: errorTypes.has(exception.type || "") ? exception.type : "Error",
            stacktrace: {
              frames: exception.stacktrace?.frames?.map((frame) => ({
                filename: frame.filename?.split(/[?#]/)[0] === assetUrl ? assetName : undefined,
                lineno: frame.lineno,
                colno: frame.colno,
                in_app: frame.in_app,
              })),
            },
            mechanism: exception.mechanism && {
              type: "generic",
              handled: exception.mechanism.handled,
            },
          })),
        },
      };
    },
  });
}
