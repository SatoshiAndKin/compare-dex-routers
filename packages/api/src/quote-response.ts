import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const quantity = z.string().regex(/^\d+$/);
const nativeValue = z.string().nullable();

const UsdConversionSchema = z.object({
  native_price_usd: z.string(),
  source: z.literal("defillama"),
  updated_at: z.number().int(),
});
export type UsdConversion = z.infer<typeof UsdConversionSchema>;

const QuoteSchema = z.object({
  chainId: z.number().int(),
  from: address,
  from_symbol: z.string(),
  to: address,
  to_symbol: z.string(),
  amount: z.string(),
  input_amount: z.string(),
  output_amount: z.string(),
  input_amount_raw: quantity,
  output_amount_raw: quantity,
  mode: z.enum(["exactIn", "targetOut"]),
  provider: z.string(),
  slippage_bps: z.number().int().min(0).max(10000),
  sender: address.nullable(),
  simulation_status: z.enum(["succeeded", "failed", "not_run"]),
  simulation_reason: z.string().nullable(),
  execution: z
    .object({
      to: address,
      data: z.string().regex(/^0x(?:[a-fA-F0-9]{2})*$/),
      value: quantity,
      approval: z.object({ token: address, spender: address }).nullable(),
    })
    .nullable(),
  route: z
    .object({
      nodes: z.array(z.object({ address, symbol: z.string().optional() })),
      edges: z.array(
        z.object({
          source: address,
          target: address,
          address: address.optional(),
          key: z.string(),
          value: z.number(),
        })
      ),
    })
    .nullable(),
  gas_used: quantity.nullable().describe("Swap execution gas units, excluding approvals"),
  approval_gas_used: quantity
    .nullable()
    .describe("Remaining approval gas units; zero when unnecessary, null when unknown"),
  approval_gas_cost_native: nativeValue,
  gas_price_gwei: nativeValue,
  native_currency: z.string(),
  gas_cost_native: nativeValue.describe(
    "Estimated swap plus required approval cost in native currency"
  ),
  trade_value_native: nativeValue,
  net_value_native: nativeValue,
  gas_cost_usd: nativeValue,
  approval_gas_cost_usd: nativeValue,
  trade_value_usd: nativeValue,
  net_value_usd: nativeValue,
});

const ProviderFailureSchema = z.object({
  provider: z.string(),
  stage: z.enum(["quote", "simulation"]),
  error: z.object({
    name: z.string(),
    message: z.string(),
    code: z.union([z.string(), z.number()]).nullable(),
    cause: z.unknown().nullable(),
    details: z.unknown().nullable(),
  }),
});

export const QuoteResponseSchema = z.object({
  quotes: z.array(QuoteSchema.openapi("Quote")),
  failures: z.array(ProviderFailureSchema),
  recommendation: z.string().nullable(),
  recommendation_reason: z.string(),
  recommendation_basis: z.enum(["gas_adjusted", "raw_amount", "none"]),
  simulation_basis: z.literal("wallet_balance"),
  simulation_account: address,
  wallet_readiness: z.literal("unchecked"),
  gas_price_gwei: nativeValue,
  native_currency: z.string(),
  usd_conversion: UsdConversionSchema.nullable().describe(
    "Display-only native currency to USD conversion; timestamp in Unix seconds"
  ),
  mode: z.enum(["exactIn", "targetOut"]),
});

export type QuoteResult = z.infer<typeof QuoteSchema>;
export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;
export type ProviderFailure = z.infer<typeof ProviderFailureSchema>;
