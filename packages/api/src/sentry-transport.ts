import * as Sentry from "@sentry/node";
import { Resolver } from "node:dns/promises";
import { request } from "node:https";
import type { LookupFunction } from "node:net";

const uploadTimeoutMs = 2_000;

// Native async DNS can be cancelled; libc getaddrinfo can outlive HTTP abort.
export function boundedLookup(
  signal: AbortSignal,
  resolver = new Resolver({ timeout: uploadTimeoutMs / 2, tries: 1 })
): LookupFunction {
  const cancel = () => resolver.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  return (hostname, options, callback) => {
    const deadline = setTimeout(cancel, uploadTimeoutMs / 2);
    deadline.unref();
    const families = options.family === 4 ? [4] : options.family === 6 ? [6] : [4, 6];
    void Promise.allSettled(
      families.map(async (family) => {
        const addresses = await (family === 4
          ? resolver.resolve4(hostname)
          : resolver.resolve6(hostname));
        return addresses.map((address) => ({ address, family }));
      })
    ).then((results) => {
      clearTimeout(deadline);
      signal.removeEventListener("abort", cancel);
      const addresses = results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : []
      );
      const first = addresses[0];
      if (!first) {
        callback(Object.assign(new Error("Sentry DNS lookup failed"), { code: "ENOTFOUND" }), "");
      } else if (options.all) {
        callback(null, addresses);
      } else {
        callback(null, first.address, first.family);
      }
    });
  };
}

export function createSentryTransport(
  options: Parameters<typeof Sentry.makeNodeTransport>[0],
  lookup: (signal: AbortSignal) => LookupFunction = boundedLookup
): ReturnType<typeof Sentry.makeNodeTransport> {
  return Sentry.makeNodeTransport({
    ...options,
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
        const signal = AbortSignal.timeout(uploadTimeoutMs);
        return request(
          { ...options, agent: false, rejectUnauthorized: true, lookup: lookup(signal), signal },
          callback
        );
      },
    },
  });
}
