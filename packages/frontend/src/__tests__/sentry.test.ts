import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const release = "a".repeat(40);
// Avoid Vite rewriting new URL("../sentry.ts", import.meta.url) to its dev asset server.
const codeAssetUrl = import.meta.url.replace("/__tests__/sentry.test.ts", "/sentry.ts");

afterEach(async () => {
  const sdk = await import("@sentry/svelte");
  await sdk.close(100);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.resetModules();
});

describe("browser error reporting", () => {
  it.each([undefined, "http://public@example.test/1"])(
    "does not start a client for absent or plaintext DSN %s",
    async (dsn) => {
      vi.stubEnv("VITE_SENTRY_DSN", dsn);
      vi.stubEnv("VITE_SENTRY_RELEASE", release);
      await import("../sentry.js");
      const sdk = await import("@sentry/svelte");
      expect(sdk.getClient()).toBeUndefined();
    }
  );

  it("does not report an unversioned build", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@collector.test/1");
    vi.stubEnv("VITE_SENTRY_RELEASE", "dev");
    await import("../sentry.js");
    const sdk = await import("@sentry/svelte");
    expect(sdk.getClient()).toBeUndefined();
  });

  it("sends a full release with only exception types and safe code locations", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@collector.test/1");
    vi.stubEnv("VITE_SENTRY_RELEASE", release);
    await import("../sentry.js");
    const sdk = await import("@sentry/svelte");
    sdk.captureEvent({
      level: "error",
      message: "private transaction payload",
      user: { id: "0x" + "b".repeat(40) },
      request: { url: "https://rpc.test/private?key=secret", data: "signed transaction" },
      contexts: { private: { payload: "private context" } },
      extra: { password: "secret" },
      breadcrumbs: [{ message: "private breadcrumb" }],
      exception: {
        values: [
          {
            type: "TypeError",
            value: "wallet address and transaction details",
            stacktrace: {
              frames: [
                {
                  filename: codeAssetUrl + "?key=secret#private",
                  function: "refreshQuotes",
                  lineno: 12,
                  colno: 4,
                  vars: { signature: "signed data" },
                  pre_context: ["private code"],
                },
              ],
            },
          },
          { type: "0x" + "b".repeat(40), value: "private error type" },
        ],
      },
    });
    await sdk.flush(1_000);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toMatch(/^https:\/\/collector.test\/api\/1\/envelope\//);
    expect(options).toMatchObject({
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const body = String(options.body);
    const event = JSON.parse(body.split("\n")[2]);
    expect(event.release).toBe(release);
    expect(event.exception.values[0]).toMatchObject({
      type: "TypeError",
      stacktrace: { frames: [{ filename: "sentry.ts", lineno: 12 }] },
    });
    for (const secret of ["private", "secret", "signed", "0x" + "b".repeat(40), "wallet address"]) {
      expect(body).not.toContain(secret);
    }
    const configuration = sdk.getClient()?.getOptions();
    expect(configuration?.tracesSampleRate).toBe(0);
    expect(configuration?.maxBreadcrumbs).toBe(0);
    expect(configuration?.integrations.map((integration) => integration.name).sort()).toEqual([
      "BrowserApiErrors",
      "Dedupe",
      "GlobalHandlers",
    ]);
  });

  it("captures native unhandled browser errors", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@collector.test/1");
    vi.stubEnv("VITE_SENTRY_RELEASE", release);
    await import("../sentry.js");
    const sdk = await import("@sentry/svelte");
    expect(window.onerror).toBeTypeOf("function");
    window.onerror?.(
      "private",
      "https://swap.test/app.js",
      12,
      4,
      new TypeError("private wallet payload")
    );
    await sdk.flush(1_000);
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0][1].body)).not.toContain("private wallet payload");
  });

  it("does not upload provider-controlled filenames or function names in forged stacks", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@collector.test/1");
    vi.stubEnv("VITE_SENTRY_RELEASE", release);
    await import("../sentry.js");
    const sdk = await import("@sentry/svelte");
    const secret = "0x" + "c".repeat(64);
    const error = new TypeError("private provider payload");
    error.stack = `TypeError: private provider payload\n    at ${secret} (https://rpc.test/${secret}:21:8)\n    at refreshQuotes (${codeAssetUrl}:12:4)`;
    sdk.captureException(error);
    await sdk.flush(1_000);
    expect(fetch).toHaveBeenCalledOnce();
    const body = String(fetch.mock.calls[0][1].body);
    expect(body).not.toContain(secret);
    const event = JSON.parse(body.split("\n")[2]);
    expect(event.exception.values[0].stacktrace.frames).toContainEqual(
      expect.objectContaining({ filename: "sentry.ts", lineno: 12, colno: 4 })
    );
  });

  it("aborts a collector that never completes its response", async () => {
    const fetch = vi.fn(
      (_url: unknown, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(options.signal?.reason));
        })
    );
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@collector.test/1");
    vi.stubEnv("VITE_SENTRY_RELEASE", release);
    await import("../sentry.js");
    const sdk = await import("@sentry/svelte");
    const start = performance.now();
    sdk.captureException(new TypeError("private payload"));
    await sdk.flush(3_000);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(performance.now() - start).toBeLessThan(2_800);
  });
});
