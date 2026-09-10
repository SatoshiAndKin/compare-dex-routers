import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import type { OpenAPIObject } from "openapi3-ts/oas30";
import { z } from "zod";
import { QuoteSchema, CompareSchema } from "./quote-response.js";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

// --- Reusable parameter schemas ---

const ChainIdParam = z.coerce
  .number()
  .int()
  .openapi({
    param: { name: "chainId", in: "query" },
    description: "Chain ID (1, 8453, 42161, 10, 137, 56, 43114)",
    example: 1,
  });

const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .openapi({
    description: "EVM address (0x-prefixed, 40 hex chars)",
    example: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  });

const SlippageBpsParam = z.coerce
  .number()
  .int()
  .min(0)
  .max(10000)
  .default(50)
  .openapi({
    param: { name: "slippageBps", in: "query" },
    description: "Slippage tolerance in basis points",
    example: 50,
  });

const ModeParam = z
  .enum(["exactIn", "targetOut"])
  .default("exactIn")
  .openapi({
    param: { name: "mode", in: "query" },
    description:
      "Quote mode. exactIn: specify input amount, get output amount. targetOut: specify desired output amount, get required input amount.",
  });

const QuoteQuerySchema = z.object({
  chainId: ChainIdParam,
  from: AddressSchema.openapi({
    param: { name: "from", in: "query" },
    description: "Input token address",
  }),
  to: AddressSchema.openapi({
    param: { name: "to", in: "query" },
    description: "Output token address",
  }),
  amount: z.string().openapi({
    param: { name: "amount", in: "query" },
    description:
      "Human-readable amount. For exactIn: input amount. For targetOut: desired output amount.",
  }),
  slippageBps: SlippageBpsParam,
  sender: AddressSchema.optional().openapi({
    param: { name: "sender", in: "query" },
    description: "Account bound to execution data. Omit for a preview with no execution data.",
  }),
  mode: ModeParam,
});

const TokenMetadataQuerySchema = z.object({
  chainId: ChainIdParam,
  address: AddressSchema.openapi({
    param: { name: "address", in: "query" },
    description: "Token contract address",
  }),
});

// --- Response schemas ---

const ErrorSchema = z
  .object({
    error: z.string(),
    code: z.enum(["INVALID_REQUEST", "NOT_FOUND", "UPSTREAM_ERROR"]),
    requestId: z.string(),
  })
  .openapi("Error");

const QuoteResponseSchema = QuoteSchema.openapi("Quote");
const CompareResultSchema = CompareSchema.openapi("CompareResult");

const TokenMetadataSchema = z
  .object({
    name: z.string().openapi({ description: "Token name from ERC-20 name() function" }),
    symbol: z.string().openapi({ description: "Token symbol from ERC-20 symbol() function" }),
    decimals: z
      .number()
      .int()
      .openapi({ description: "Token decimals from ERC-20 decimals() function" }),
  })
  .openapi("TokenMetadata");

const TokenEntrySchema = z
  .object({
    chainId: z.number().int(),
    address: z.string(),
    name: z.string(),
    symbol: z.string(),
    decimals: z.number().int(),
    logoURI: z.string(),
  })
  .openapi("TokenEntry");

const TokenListEntrySchema = z
  .object({
    name: z.string(),
    tokens: z.array(TokenEntrySchema),
  })
  .openapi("TokenListEntry");

const TokenListResponseSchema = z
  .object({
    name: z
      .string()
      .openapi({ description: 'Name of the token list (or "Default Tokenlists" if multiple)' }),
    tokenlists: z.array(TokenListEntrySchema),
    tokens: z
      .array(TokenEntrySchema)
      .openapi({ description: "Merged array of all tokens from all default token lists" }),
  })
  .openapi("TokenListResponse");

const AnalyticsSummarySchema = z
  .object({
    totalQuotes: z
      .number()
      .int()
      .openapi({ description: "Total number of quotes tracked since server start" }),
    successRate: z
      .number()
      .openapi({ description: "Fraction of quotes that succeeded (0.0 to 1.0)" }),
    avgDurationMs: z
      .number()
      .int()
      .openapi({ description: "Average quote duration in milliseconds" }),
    topPairs: z.array(z.object({ pair: z.string(), count: z.number().int() })),
    topChains: z.array(z.object({ chainId: z.number().int(), count: z.number().int() })),
  })
  .openapi("AnalyticsSummary");

const ErrorPatternSchema = z.object({
  message: z.string(),
  count: z.number().int(),
  firstSeen: z.string().datetime(),
  lastSeen: z.string().datetime(),
  contexts: z.array(z.string()),
});

const ErrorInsightsSchema = z
  .object({
    patterns: z.array(ErrorPatternSchema),
    totalPatterns: z.number().int(),
    recurringPatterns: z.number().int(),
  })
  .openapi("ErrorInsights");

const DefaultTokenPairSchema = z
  .object({
    from: z.string().openapi({ description: "Default input token address" }),
    to: z.string().openapi({ description: "Default output token address" }),
  })
  .openapi("DefaultTokenPair");

const ConfigSchema = z
  .object({
    flags: z.record(z.string(), z.boolean()),
    defaultTokens: z
      .record(z.string(), DefaultTokenPairSchema)
      .openapi({ description: "Map of chainId to default token pair" }),
    walletConnectProjectId: z
      .string()
      .openapi({ description: "WalletConnect project ID (empty string if not configured)" }),
  })
  .openapi("Config");

const FarcasterAccountAssociationSchema = z.object({
  header: z.string(),
  payload: z.string(),
  signature: z.string(),
});

const FarcasterMiniappSchema = z.object({
  version: z.string(),
  name: z.string(),
  homeUrl: z.string(),
  iconUrl: z.string(),
  primaryCategory: z.string(),
});

const FarcasterManifestSchema = z
  .object({
    accountAssociation: FarcasterAccountAssociationSchema,
    miniapp: FarcasterMiniappSchema,
  })
  .openapi("FarcasterManifest");

// --- Helper for JSON responses ---

function jsonContent(schema: z.ZodTypeAny, description: string) {
  return {
    description,
    content: { "application/json": { schema } },
  };
}

function errorResponse(description: string) {
  return jsonContent(ErrorSchema, description);
}

// --- Path registrations ---

registry.registerPath({
  method: "get",
  path: "/health",
  operationId: "getHealth",
  summary: "Health check",
  responses: {
    200: jsonContent(
      z.object({ status: z.string().openapi({ example: "ok" }) }),
      "Server is healthy"
    ),
  },
});

registry.registerPath({
  method: "get",
  path: "/chains",
  operationId: "getChains",
  summary: "List supported chains",
  responses: {
    200: jsonContent(
      z.record(z.string(), z.object({ name: z.string(), alchemySubdomain: z.string() })),
      "Map of chain IDs to chain metadata"
    ),
  },
});

registry.registerPath({
  method: "get",
  path: "/quote",
  operationId: "getQuote",
  summary: "Get best Spandex quote",
  request: { query: QuoteQuerySchema },
  responses: {
    200: jsonContent(QuoteResponseSchema, "Best quote found"),
    400: errorResponse("Invalid parameters"),
    500: errorResponse("Quote failed"),
  },
});

registry.registerPath({
  method: "get",
  path: "/compare",
  operationId: "compareQuotes",
  summary: "Compare Spandex vs Curve quotes",
  request: { query: QuoteQuerySchema },
  responses: {
    200: jsonContent(CompareResultSchema, "Comparison result with recommendation"),
    400: errorResponse("Invalid parameters"),
  },
});

registry.registerPath({
  method: "get",
  path: "/quote-curve",
  operationId: "getQuoteCurve",
  summary: "Get a single Curve Finance quote",
  request: { query: QuoteQuerySchema },
  responses: {
    200: jsonContent(QuoteResponseSchema, "Curve quote"),
    400: errorResponse("Invalid parameters or Curve not supported on this chain"),
    500: errorResponse("Quote failed"),
  },
});

registry.registerPath({
  method: "get",
  path: "/tokenlist",
  operationId: "getTokenlist",
  summary: "Get the default token list(s)",
  description: "Returns all configured default token lists merged into a single response.",
  responses: {
    200: jsonContent(TokenListResponseSchema, "Token list response"),
    500: errorResponse("Failed to load token list"),
  },
});

registry.registerPath({
  method: "get",
  path: "/token-metadata",
  operationId: "getTokenMetadata",
  summary: "Get ERC-20 token metadata from blockchain",
  request: { query: TokenMetadataQuerySchema },
  responses: {
    200: jsonContent(TokenMetadataSchema, "Token metadata retrieved successfully"),
    400: errorResponse(
      "Invalid parameters (missing/invalid chainId or address, unsupported chain)"
    ),
    404: errorResponse("Not a valid ERC-20 token (EOA or non-ERC-20 contract)"),
    500: errorResponse("RPC error or timeout"),
  },
});

registry.registerPath({
  method: "get",
  path: "/analytics",
  operationId: "getAnalytics",
  summary: "Get analytics summary",
  description: "Returns in-memory analytics about quotes processed since server start.",
  responses: {
    200: jsonContent(AnalyticsSummarySchema, "Analytics summary"),
  },
});

registry.registerPath({
  method: "get",
  path: "/errors",
  operationId: "getErrors",
  summary: "Get error insights",
  description: "Returns aggregated error patterns observed since server start.",
  responses: {
    200: jsonContent(ErrorInsightsSchema, "Error insights"),
  },
});

registry.registerPath({
  method: "get",
  path: "/metrics",
  operationId: "getMetrics",
  summary: "Prometheus metrics",
  description:
    "Returns Prometheus-compatible metrics in text exposition format. Requires metrics_endpoint feature flag to be enabled.",
  responses: {
    200: {
      description: "Prometheus metrics text",
      content: {
        "text/plain": {
          schema: z.string().openapi({
            example:
              '# HELP http_requests_total Total HTTP requests\n# TYPE http_requests_total counter\nhttp_requests_total{path="/quote",error="false"} 42',
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/config",
  operationId: "getConfig",
  summary: "Get server configuration",
  description: "Returns default token pairs per chain and wallet connect project ID.",
  responses: {
    200: jsonContent(ConfigSchema, "Server configuration"),
  },
});

registry.registerPath({
  method: "get",
  path: "/.well-known/farcaster.json",
  operationId: "getFarcasterManifest",
  summary: "Farcaster manifest",
  description: "Returns the Farcaster mini-app manifest for frame integration.",
  responses: {
    200: jsonContent(FarcasterManifestSchema, "Farcaster manifest"),
  },
});

// --- Generator ---

const generator = new OpenApiGeneratorV3(registry.definitions);

export const openapiDocument: OpenAPIObject = generator.generateDocument({
  openapi: "3.0.3",
  info: {
    title: "Compare DEX Routers API",
    version: "1.0.0",
    description: "Quote comparison server querying Spandex and Curve for side-by-side swap quotes.",
  },
  servers: [{ url: "http://localhost:3100" }],
});
