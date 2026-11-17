import "./env.js";
import "./sentry.js";
import http from "node:http";
import { existsSync } from "node:fs";
import { TokenlistFiles } from "./tokenlists.js";
import { loadBlockedTokenlist, type BlockDetails } from "./blocked-tokenlist.js";
import { createManagedServer } from "./shutdown.js";
import { docsAssets, docsAssetUrl } from "./docs-assets.js";
import { pathToFileURL } from "node:url";
import { openapiDocument } from "./openapi.js";
import { serializeWithBigInt } from "@spandex/core";
import { getCoinbaseEstimate, TakerFeePercentSchema } from "./coinbase.js";
import { quoteRoutes } from "./quotes.js";
import { redactText } from "./redaction.js";
import { parseQuoteParams } from "./quote.js";
import {
  getTokenDecimals,
  getTokenSymbol,
  getTokenName,
  SUPPORTED_CHAINS,
  DEFAULT_TOKENS,
  NATIVE_ASSETS,
} from "./config.js";
import { logger } from "./logger.js";
import { getRequestId, setTraceHeaders } from "./tracing.js";
import { recordRequest, getMetrics } from "./metrics.js";
import { isEnabled, getAllFlags } from "./feature-flags.js";
import { trackQuote, getAnalyticsSummary } from "./analytics.js";
import { trackError, getErrorInsights } from "./error-insights.js";

const PORT = parseInt(process.env.PORT || "3100", 10);
const HOST = process.env.HOST || "0.0.0.0";

const tokenlistFiles = new TokenlistFiles();

function sendJson(res: http.ServerResponse, status: number, data: object) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(serializeWithBigInt(data));
}

function sendError(res: http.ServerResponse, status: number, message: string) {
  sendJson(res, status, {
    error: redactText(message),
    code:
      status === 503
        ? "SHUTTING_DOWN"
        : status >= 500
          ? "UPSTREAM_ERROR"
          : status === 404
            ? "NOT_FOUND"
            : "INVALID_REQUEST",
    requestId: res.getHeader("x-request-id") ?? "",
  });
}

function rejectBlockedToken(
  res: http.ServerResponse,
  requestId: string,
  block: BlockDetails | undefined
): boolean {
  if (!block) return false;
  sendJson(res, 403, {
    code: "TOKEN_BLOCKED",
    error: "Token blocked by " + block.blockSource + ". " + block.blockReason,
    block,
    requestId,
  });
  return true;
}

export async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  draining = false
) {
  try {
    await routeRequest(req, res, draining);
  } catch (error) {
    logger.error({ err: error }, "Request failed");
    trackError(error, "request");
    if (res.headersSent) {
      res.destroy();
    } else {
      sendError(res, 500, "Request failed. Please try again.");
    }
  }
}

async function routeRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  draining: boolean
) {
  const requestStart = Date.now();
  const requestId = getRequestId(req);
  setTraceHeaders(res, requestId);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (draining) {
    res.setHeader("Connection", "close");
    sendError(res, 503, "Server is shutting down. Please retry.");
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  let url: URL;
  try {
    const authority = new URL(`http://${req.headers.host || "localhost:3100"}`);
    if (
      authority.username ||
      authority.password ||
      authority.pathname !== "/" ||
      authority.search ||
      authority.hash
    ) {
      throw new Error("Invalid Host");
    }
    if (!req.url?.startsWith("/") || req.url.startsWith("//")) throw new Error("Invalid target");
    url = new URL(req.url, "http://localhost:3100");
  } catch {
    sendError(res, 400, "Invalid request URL or Host header");
    return;
  }

  if (
    (url.pathname === "/openapi.json" || url.pathname === "/openapi.yaml") &&
    req.method === "GET"
  ) {
    const json = JSON.stringify(openapiDocument, null, 2);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(json);
    return;
  }

  if (url.pathname === "/docs" && req.method === "GET") {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Compare DEX Routers — API Docs</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" type="text/css" href="${docsAssetUrl(docsAssets.css.file)}" integrity="${docsAssets.css.integrity}" crossorigin="anonymous">
</head>
<body>
<div id="swagger-ui"></div>
<script src="${docsAssetUrl(docsAssets.js.file)}" integrity="${docsAssets.js.integrity}" crossorigin="anonymous"></script>
<script>
window.onload = function() {
  SwaggerUIBundle({
    url: "./openapi.json",
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis],
    layout: "BaseLayout",
    validatorUrl: null
  });
};
</script>
</body>
</html>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (url.pathname === "/health") {
    if (existsSync("/tmp/drain")) {
      sendError(res, 503, "Server is draining for deployment.");
      return;
    }
    sendJson(res, 200, { status: "ok", requestId, flags: getAllFlags() });
    recordRequest("/health", Date.now() - requestStart, false);
    return;
  }

  if (url.pathname === "/metrics" && isEnabled("metrics_endpoint")) {
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
    res.end(getMetrics());
    return;
  }

  if (url.pathname === "/analytics") {
    sendJson(res, 200, getAnalyticsSummary());
    return;
  }

  if (url.pathname === "/errors") {
    sendJson(res, 200, getErrorInsights());
    return;
  }

  if (url.pathname === "/chains" && req.method === "GET") {
    sendJson(res, 200, SUPPORTED_CHAINS);
    return;
  }

  if (url.pathname === "/config" && req.method === "GET") {
    sendJson(res, 200, {
      flags: getAllFlags(),
      defaultTokens: DEFAULT_TOKENS,
      nativeAssets: Object.fromEntries(
        Object.entries(NATIVE_ASSETS).map(([chainId, native]) => [
          chainId,
          {
            ...native,
            chainId: Number(chainId),
            address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
          },
        ])
      ),
      walletConnectProjectId: process.env.WALLETCONNECT_PROJECT_ID || "",
    });
    return;
  }

  const tokenSafetyFilter = url.searchParams.get("tokenSafetyFilter") !== "false";

  if (url.pathname === "/blocked-tokenlist.json" && req.method === "GET") {
    const blocked = await loadBlockedTokenlist();
    if (!blocked) {
      sendJson(res, 503, {
        code: "TOKENLIST_UNAVAILABLE",
        error: "The Flashprofits blocked token list is unavailable.",
        requestId,
      });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=60");
    sendJson(res, 200, blocked.list);
    return;
  }

  if (url.pathname === "/tokenlist" && req.method === "GET") {
    try {
      const [lists, blocked] = await Promise.all([
        tokenlistFiles.load(),
        tokenSafetyFilter ? loadBlockedTokenlist() : undefined,
      ]);
      const defaultTokenlists = lists.map((list) => ({
        ...list,
        tokens: list.tokens.filter((token) => !blocked?.find(token.chainId, token.address)),
      }));
      const allTokens = defaultTokenlists.flatMap((entry) => entry.tokens);
      const names = defaultTokenlists.map((entry) => entry.name);
      sendJson(res, 200, {
        name: names.length === 1 ? names[0] : "Default Tokenlists",
        tokenlists: defaultTokenlists.map((entry) => ({
          name: entry.name,
          tokens: entry.tokens,
          ...(entry.error ? { error: entry.error } : {}),
        })),
        tokens: allTokens,
      });
    } catch (err) {
      logger.error({ err }, "Failed to load tokenlist");
      sendError(res, 500, "Cannot load token lists.");
    }
    return;
  }

  // Token metadata endpoint - fetches ERC-20 name, symbol, decimals from chain
  if (url.pathname === "/token-metadata" && req.method === "GET") {
    const chainIdParam = url.searchParams.get("chainId");
    const addressParam = url.searchParams.get("address");

    // Validate chainId
    const chainId = Number(chainIdParam);
    if (!/^\d+$/.test(chainIdParam ?? "") || !Number.isSafeInteger(chainId) || chainId <= 0) {
      sendError(res, 400, "Missing or invalid chainId parameter");
      return;
    }

    if (!SUPPORTED_CHAINS[chainId]) {
      sendError(res, 400, `Unsupported chain: ${chainId}`);
      return;
    }

    // Validate address format
    if (!addressParam) {
      sendError(res, 400, "Missing or invalid address parameter");
      return;
    }

    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!addressRegex.test(addressParam)) {
      sendError(res, 400, "Invalid address format");
      return;
    }

    if (tokenSafetyFilter) {
      const blocked = await loadBlockedTokenlist();
      if (rejectBlockedToken(res, requestId, blocked?.findAll(chainId, [addressParam])[0])) return;
    }

    try {
      const [name, symbol, decimals] = await Promise.all([
        getTokenName(chainId, addressParam),
        getTokenSymbol(chainId, addressParam),
        getTokenDecimals(chainId, addressParam),
      ]);

      sendJson(res, 200, { name, symbol, decimals });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, chainId, address: addressParam }, "Token metadata fetch failed");

      if (/revert|returned no data|not a contract/i.test(message)) {
        sendError(res, 404, "Not a valid ERC-20 token");
      } else {
        sendError(res, 500, "Token metadata is unavailable. Please try again.");
      }
    }
    return;
  }

  if (url.pathname === "/coinbase-estimate" && req.method === "GET") {
    const parsed = parseQuoteParams(url.searchParams);
    if (!parsed.success) {
      sendError(res, 400, parsed.error);
      return;
    }
    const fee = url.searchParams.get("takerFeePercent");
    if (fee !== null && !TakerFeePercentSchema.safeParse(fee).success) {
      sendError(
        res,
        400,
        "Invalid takerFeePercent: use 0 to less than 100 percent with at most four decimal places."
      );
      return;
    }
    const result = await getCoinbaseEstimate(parsed.data, fee);
    sendJson(res, 200, result);
    recordRequest("/coinbase-estimate", Date.now() - requestStart, result.status === "unavailable");
    return;
  }

  if (url.pathname === "/quote" && req.method === "GET") {
    const parsed = parseQuoteParams(url.searchParams);
    if (!parsed.success) {
      sendError(res, 400, parsed.error);
      return;
    }

    const { chainId, from, to, amount, mode } = parsed.data;
    const blocked = await loadBlockedTokenlist();
    if (
      tokenSafetyFilter &&
      rejectBlockedToken(res, requestId, blocked?.findAll(chainId, [from, to])[0])
    )
      return;

    const startTime = Date.now();
    const cancellation = new AbortController();
    const onClose = () => cancellation.abort();
    res.once("close", onClose);
    if (res.destroyed) onClose();
    try {
      const result = await quoteRoutes(
        parsed.data,
        blocked,
        tokenSafetyFilter,
        cancellation.signal
      );
      if (res.destroyed) return;
      const duration = Date.now() - startTime;
      logger.info(
        `Quote: chain=${chainId} ${from} -> ${to}, amount=${amount}, mode=${mode}, recommendation=${result.recommendation}, ${duration}ms`
      );
      recordRequest("/quote", duration, result.quotes.length === 0);
      for (const quote of result.quotes)
        trackQuote({
          chainId,
          fromToken: from,
          toToken: to,
          provider: quote.provider,
          durationMs: duration,
          success: true,
          outputAmount: quote.output_amount,
        });
      sendJson(res, 200, result);
    } catch (err) {
      if (res.destroyed) return;
      const duration = Date.now() - startTime;
      logger.error({ err, chainId, from, to, duration }, "Quote failed");
      recordRequest("/quote", duration, true);
      trackQuote({
        chainId,
        fromToken: from,
        toToken: to,
        provider: "unknown",
        durationMs: duration,
        success: false,
      });
      trackError(err, `quote:${chainId}:${from}-${to}`);
      sendError(res, 500, "Request failed. Please try again.");
    } finally {
      res.off("close", onClose);
    }
    return;
  }

  logger.info(`404: ${req.method} ${url.pathname}`);
  sendError(res, 404, "Not found");
}

export function createApiServer() {
  return createManagedServer((req, res, draining) => {
    void handleRequest(req, res, draining);
  });
}

async function main() {
  const app = createApiServer();
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void app.shutdown().then((clean) => process.exit(clean ? 0 : 1));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  await new Promise<void>((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(PORT, HOST, () => {
      logger.info(`Server listening on http://${HOST}:${PORT}`);
      resolve();
    });
  });
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  main().catch((err) => {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  });
}
