import "./env.js";
import "./sentry.js";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openapiDocument } from "./openapi.js";
import { serializeWithBigInt } from "@spandex/core";
import { compareQuotes, singleQuote } from "./quotes.js";
import { redactText } from "./redaction.js";
import { parseQuoteParams } from "./quote.js";
import {
  getTokenDecimals,
  getTokenSymbol,
  getTokenName,
  SUPPORTED_CHAINS,
  DEFAULT_TOKENS,
} from "./config.js";
import { logger } from "./logger.js";
import { captureException } from "./sentry.js";
import { getRequestId, setTraceHeaders } from "./tracing.js";
import { recordRequest, getMetrics } from "./metrics.js";
import { isEnabled, getAllFlags } from "./feature-flags.js";
import { trackQuote, getAnalyticsSummary } from "./analytics.js";
import { trackError, getErrorInsights } from "./error-insights.js";

const PORT = parseInt(process.env.PORT || "3100", 10);
const HOST = process.env.HOST || "0.0.0.0";

function log(message: string) {
  logger.info(message);
}

function logError(message: string, err?: unknown) {
  const errorDetail = err instanceof Error ? err.message : err || "";
  logger.error({ err: errorDetail }, message);
  captureException(err, { message });
}

interface TokenListPayload {
  tokens: Array<{
    chainId: number;
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    logoURI?: string;
  }>;
  [key: string]: unknown;
}

interface TokenlistEntry {
  path: string;
  name: string;
  tokens: TokenListPayload["tokens"];
}

let cachedDefaultTokenlists: TokenlistEntry[] | null = null;
let cachedDefaultTokenlistsKey: string | null = null;

/**
 * Get the list of default tokenlist file paths from environment.
 * DEFAULT_TOKENLISTS: comma-separated list of file paths (relative to cwd or absolute)
 * Defaults to ['static/tokenlist.json'] when not set.
 */
function getDefaultTokenlistPaths(): string[] {
  const envValue = process.env.DEFAULT_TOKENLISTS;
  if (!envValue || envValue.trim() === "") {
    return [resolve(process.cwd(), "static", "tokenlist.json")];
  }
  return envValue
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => (p.startsWith("/") ? p : resolve(process.cwd(), p)));
}

/**
 * Load all default tokenlists from configured paths.
 * Returns array of {path, name, tokens} entries.
 * Caches based on the DEFAULT_TOKENLISTS env value.
 */
async function loadDefaultTokenlists(): Promise<TokenlistEntry[]> {
  const paths = getDefaultTokenlistPaths();
  const cacheKey = paths.join("|");

  if (cachedDefaultTokenlists && cachedDefaultTokenlistsKey === cacheKey) {
    return cachedDefaultTokenlists;
  }

  const entries: TokenlistEntry[] = [];

  for (const path of paths) {
    try {
      const fileContents = await readFile(path, "utf8");
      const parsed = JSON.parse(fileContents) as TokenListPayload;
      const tokens = Array.isArray(parsed.tokens) ? parsed.tokens : [];
      const name =
        typeof parsed.name === "string" && parsed.name.trim() !== ""
          ? parsed.name
          : path.split("/").pop() || path;
      entries.push({ path, name, tokens });
    } catch (err) {
      logError(`Failed to load default tokenlist from ${path}`, err);
    }
  }

  cachedDefaultTokenlists = entries;
  cachedDefaultTokenlistsKey = cacheKey;
  return entries;
}

function sendJson(res: http.ServerResponse, status: number, data: object) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(serializeWithBigInt(data));
}

function sendError(res: http.ServerResponse, status: number, message: string) {
  sendJson(res, status, {
    error: redactText(message),
    code: status >= 500 ? "UPSTREAM_ERROR" : status === 404 ? "NOT_FOUND" : "INVALID_REQUEST",
    requestId: res.getHeader("x-request-id") ?? "",
  });
}

export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    await routeRequest(req, res);
  } catch (error) {
    logError("Request failed", error);
    trackError(error, "request");
    if (res.headersSent) {
      res.destroy();
    } else {
      sendError(res, 500, "Request failed. Please try again.");
    }
  }
}

async function routeRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const requestStart = Date.now();
  const requestId = getRequestId(req);
  setTraceHeaders(res, requestId);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
<script>
window.onload = function() {
  SwaggerUIBundle({
    url: "./openapi.json",
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
    layout: "StandaloneLayout"
  });
};
</script>
</body>
</html>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (url.pathname === "/.well-known/farcaster.json" && req.method === "GET") {
    const host = req.headers.host || "localhost:3100";
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const baseUrl = `${protocol}://${host}`;
    sendJson(res, 200, {
      accountAssociation: {
        header: process.env.FARCASTER_ACCOUNT_ASSOCIATION_HEADER || "",
        payload: process.env.FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD || "",
        signature: process.env.FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE || "",
      },
      miniapp: {
        version: "1",
        name: "Compare DEX Routers",
        homeUrl: `${baseUrl}/?miniApp=true`,
        iconUrl: `${baseUrl}/icon.png`,
        primaryCategory: "finance",
      },
    });
    return;
  }

  if (url.pathname === "/health") {
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
      walletConnectProjectId: process.env.WALLETCONNECT_PROJECT_ID || "",
    });
    return;
  }

  if (url.pathname === "/tokenlist" && req.method === "GET") {
    try {
      const defaultTokenlists = await loadDefaultTokenlists();
      const allTokens = defaultTokenlists.flatMap((entry) => entry.tokens);
      const names = defaultTokenlists.map((entry) => entry.name);
      sendJson(res, 200, {
        name: names.length === 1 ? names[0] : "Default Tokenlists",
        tokenlists: defaultTokenlists.map((entry) => ({
          name: entry.name,
          tokens: entry.tokens,
        })),
        tokens: allTokens,
      });
    } catch (err) {
      logError("Failed to load tokenlist", err);
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

    try {
      const [name, symbol, decimals] = await Promise.all([
        getTokenName(chainId, addressParam),
        getTokenSymbol(chainId, addressParam),
        getTokenDecimals(chainId, addressParam),
      ]);

      sendJson(res, 200, { name, symbol, decimals });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError(`Token metadata fetch failed: chain=${chainId} address=${addressParam}`, err);

      if (/revert|returned no data|not a contract/i.test(message)) {
        sendError(res, 404, "Not a valid ERC-20 token");
      } else {
        sendError(res, 500, "Token metadata is unavailable. Please try again.");
      }
    }
    return;
  }

  if (url.pathname === "/quote" && req.method === "GET") {
    const parsed = parseQuoteParams(url.searchParams);
    if (!parsed.success) {
      sendError(res, 400, parsed.error);
      return;
    }

    const { chainId, from, to, amount, mode } = parsed.data;

    const startTime = Date.now();
    try {
      const result = await singleQuote(parsed.data, "spandex");
      const duration = Date.now() - startTime;
      log(
        `Quote: chain=${chainId} ${result.from_symbol || from} -> ` +
          `${result.to_symbol || to}, amount=${amount}, mode=${mode}, ` +
          `output=${result.output_amount}, provider=${result.provider}, ${duration}ms`
      );
      recordRequest("/quote", duration, false);
      trackQuote({
        chainId,
        fromToken: from,
        toToken: to,
        provider: result.provider,
        durationMs: duration,
        success: true,
        outputAmount: result.output_amount,
      });
      sendJson(res, 200, result);
    } catch (err) {
      const duration = Date.now() - startTime;
      logError(`Quote failed: chain=${chainId} ${from} -> ${to}, ${duration}ms`, err);
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
    }
    return;
  }

  if (url.pathname === "/compare" && req.method === "GET" && isEnabled("compare_endpoint")) {
    const parsed = parseQuoteParams(url.searchParams);
    if (!parsed.success) {
      sendError(res, 400, parsed.error);
      return;
    }

    const { chainId, from, to, amount, mode } = parsed.data;

    const startTime = Date.now();
    try {
      const result = await compareQuotes(parsed.data);
      const duration = Date.now() - startTime;
      log(
        `Compare: chain=${chainId} ${from} -> ${to}, ` +
          `amount=${amount}, mode=${mode}, recommendation=${result.recommendation}, ${duration}ms`
      );
      recordRequest("/compare", duration, false);
      sendJson(res, 200, result);
    } catch (err) {
      const duration = Date.now() - startTime;
      logError(`Compare failed: chain=${chainId} ${from} -> ${to}, ${duration}ms`, err);
      recordRequest("/compare", duration, true);
      trackError(err, `compare:${chainId}:${from}-${to}`);
      sendError(res, 500, "Request failed. Please try again.");
    }
    return;
  }

  if (url.pathname === "/quote-curve" && req.method === "GET") {
    const parsed = parseQuoteParams(url.searchParams);
    if (!parsed.success) {
      sendError(res, 400, parsed.error);
      return;
    }

    const { chainId, from, to, amount, mode } = parsed.data;

    const startTime = Date.now();
    try {
      const result = await singleQuote(parsed.data, "curve");
      const duration = Date.now() - startTime;
      log(
        `Quote-curve: chain=${chainId} ${result.from_symbol || from} -> ` +
          `${result.to_symbol || to}, amount=${amount}, mode=${mode}, ` +
          `output=${result.output_amount}, ${duration}ms`
      );
      recordRequest("/quote-curve", duration, false);
      sendJson(res, 200, result);
    } catch (err) {
      const duration = Date.now() - startTime;
      logError(`Quote-curve failed: chain=${chainId} ${from} -> ${to}, ${duration}ms`, err);
      recordRequest("/quote-curve", duration, true);
      trackError(err, `quote-curve:${chainId}:${from}-${to}`);
      sendError(res, 500, "Request failed. Please try again.");
    }
    return;
  }

  log(`404: ${req.method} ${url.pathname}`);
  sendError(res, 404, "Not found");
}

async function main() {
  const server = http.createServer(handleRequest);
  server.listen(PORT, HOST, () => {
    log(`Server listening on http://${HOST}:${PORT}`);
  });
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  main().catch((err) => {
    logError("Failed to start server", err);
    process.exit(1);
  });
}
