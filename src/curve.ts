import { createCurve } from "@curvefi/api";
import type { PublicClient } from "viem";
import type { QuoteMode } from "./quote.js";

// All supported chains for Curve
export const CURVE_SUPPORTED_CHAINS = [1, 8453, 42161, 10, 137, 56, 43114];

// Type for curve instance - using `any` since @curvefi/api has complex types
// and we use runtime checks for the fields we need
type CurveInstance = {
  init: (
    providerType: "JsonRpc",
    providerSettings: { url: string },
    options: { chainId: number }
  ) => Promise<void>;
  factory: { fetchPools: () => Promise<void> };
  crvUSDFactory: { fetchPools: () => Promise<void> };
  cryptoFactory: { fetchPools: () => Promise<void> };
  twocryptoFactory: { fetchPools: () => Promise<void> };
  tricryptoFactory: { fetchPools: () => Promise<void> };
  stableNgFactory: { fetchPools: () => Promise<void> };
  getCoinsData: (addresses: string[]) => Promise<Array<{ symbol?: string }>>;
  hasAllowance: (
    coins: string[],
    amounts: string[],
    address: string,
    spender: string
  ) => Promise<boolean>;
  router: {
    getBestRouteAndOutput: (
      from: string,
      to: string,
      amount: string
    ) => Promise<{ route: CurveRouteStep[]; output: string }>;
    populateSwap: (
      from: string,
      to: string,
      amount: string
    ) => Promise<{ to?: string | null; data?: string | null; value?: string | null }>;
    populateApprove: (
      coin: string,
      amount: string,
      isMax: boolean,
      userAddress: string
    ) => Promise<Array<{ to?: string | null; data?: string | null }>>;
    required: (from: string, to: string, outputAmount: string) => Promise<string>;
  };
};

interface CurveRouteStep {
  poolId?: string;
  poolName?: string;
  poolAddress?: string;
  inputCoinAddress?: string;
  outputCoinAddress?: string;
}

// Per-chain curve instances
const curveInstances = new Map<number, CurveInstance>();

// Track which chains successfully initialized
const initializedChains = new Set<number>();

// Track initialization errors per chain
const initErrors = new Map<number, string>();

export function isCurveSupported(chainId: number): boolean {
  return CURVE_SUPPORTED_CHAINS.includes(chainId);
}

export function isCurveInitialized(chainId: number): boolean {
  return initializedChains.has(chainId);
}

export function getCurveInitError(chainId: number): string | undefined {
  return initErrors.get(chainId);
}

/**
 * Initialize a single Curve instance for a specific chain.
 * Creates a new curve instance and initializes it with the chain's RPC URL.
 */
export async function initCurveInstance(
  chainId: number,
  rpcUrl: string
): Promise<CurveInstance | null> {
  // Already initialized
  if (initializedChains.has(chainId)) {
    const existing = curveInstances.get(chainId);
    if (existing) return existing;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const curve = createCurve() as any;

    await curve.init("JsonRpc", { url: rpcUrl }, { chainId });

    await Promise.all([
      curve.factory.fetchPools(),
      curve.crvUSDFactory.fetchPools(),
      curve.cryptoFactory.fetchPools(),
      curve.twocryptoFactory.fetchPools(),
      curve.tricryptoFactory.fetchPools(),
      curve.stableNgFactory.fetchPools(),
    ]);

    curveInstances.set(chainId, curve);
    initializedChains.add(chainId);
    initErrors.delete(chainId);

    return curve;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    initErrors.set(chainId, errorMsg);
    return null;
  }
}

/**
 * Initialize Curve instances for ALL supported chains in parallel.
 * This is called at server startup to ensure all chains are ready.
 * If one chain fails, others continue - errors are logged but don't block.
 */
export async function initAllCurveInstances(
  getRpcUrl: (chainId: number) => string,
  log: (message: string) => void,
  logError: (message: string, err?: unknown) => void
): Promise<void> {
  const results = await Promise.allSettled(
    CURVE_SUPPORTED_CHAINS.map(async (chainId) => {
      const rpcUrl = getRpcUrl(chainId);
      const result = await initCurveInstance(chainId, rpcUrl);
      return { chainId, success: result !== null };
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      const { chainId, success } = result.value;
      if (success) {
        log(`Curve initialized for chain ${chainId}`);
      } else {
        logError(`Curve failed to initialize for chain ${chainId}: ${initErrors.get(chainId)}`);
      }
    } else {
      logError("Curve initialization promise rejected", result.reason);
    }
  }
}

const symbolCache = new Map<string, string>();

async function getCurveTokenSymbol(curve: CurveInstance, address: string): Promise<string> {
  const lower = address.toLowerCase();
  const cached = symbolCache.get(lower);
  if (cached !== undefined) return cached;

  try {
    const data = await curve.getCoinsData([address]);
    const symbol = data[0]?.symbol || "";
    symbolCache.set(lower, symbol);
    return symbol;
  } catch {
    symbolCache.set(lower, "");
    return "";
  }
}

export interface CurveQuoteResult {
  source: "curve";
  from: string;
  from_symbol: string;
  to: string;
  to_symbol: string;
  amount: string;
  input_amount: string;
  output_amount: string;
  mode: QuoteMode;
  route: CurveRouteStep[];
  route_symbols: Record<string, string>;
  router_address: string;
  router_calldata: string;
  gas_used?: string;
  approval_target?: string;
  approval_calldata?: string;
  // Gas-adjusted comparison fields
  gas_cost_eth?: string; // Gas cost in ETH (gas_used * gas_price / 1e18)
  output_value_eth?: string; // Output converted to ETH
  net_value_eth?: string; // output_value_eth - gas_cost_eth
}

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

/**
 * Find a Curve quote for the given token pair.
 * Uses the curve instance initialized for the specific chain.
 */
export async function findCurveQuote(
  chainId: number,
  from: string,
  to: string,
  amount: string,
  sender?: string,
  client?: PublicClient,
  mode: QuoteMode = "exactIn"
): Promise<CurveQuoteResult> {
  const curve = curveInstances.get(chainId);
  if (!curve) {
    throw new Error(
      `Curve not initialized for chain ${chainId}. ${
        initErrors.get(chainId) || "Initialization may have failed."
      }`
    );
  }

  // For targetOut mode, we need to first get the required input amount
  let inputAmount: string;
  let outputAmount: string;
  let route: CurveRouteStep[];

  if (mode === "targetOut") {
    // Use required() to get the input needed for desired output
    const requiredInput = await curve.router.required(from, to, amount);
    inputAmount = requiredInput;
    outputAmount = amount;
    // Get the route for the input amount
    const routeResult = await curve.router.getBestRouteAndOutput(from, to, inputAmount);
    route = routeResult.route as CurveRouteStep[];
  } else {
    // exactIn mode - original behavior
    const routeResult = await curve.router.getBestRouteAndOutput(from, to, amount);
    route = routeResult.route as CurveRouteStep[];
    inputAmount = amount;
    outputAmount = routeResult.output;
  }

  const [fromSymbol, toSymbol] = await Promise.all([
    getCurveTokenSymbol(curve, from),
    getCurveTokenSymbol(curve, to),
  ]);

  const typedRoute = route;

  const tokenAddresses = new Set<string>();
  for (const step of typedRoute) {
    if (step.inputCoinAddress) tokenAddresses.add(step.inputCoinAddress.toLowerCase());
    if (step.outputCoinAddress) tokenAddresses.add(step.outputCoinAddress.toLowerCase());
  }

  const routeSymbols: Record<string, string> = {};
  await Promise.all(
    Array.from(tokenAddresses).map(async (addr) => {
      const symbol = await getCurveTokenSymbol(curve, addr);
      if (symbol) routeSymbols[addr] = symbol;
    })
  );

  // For swap transaction, we always use the input amount
  const swapTx = await curve.router.populateSwap(from, to, inputAmount);
  if (!swapTx.to || !swapTx.data) {
    throw new Error("Failed to generate Curve swap transaction");
  }

  const result: CurveQuoteResult = {
    source: "curve",
    from,
    from_symbol: fromSymbol,
    to,
    to_symbol: toSymbol,
    amount,
    input_amount: inputAmount,
    output_amount: outputAmount,
    mode,
    route: typedRoute,
    route_symbols: routeSymbols,
    router_address: swapTx.to,
    router_calldata: swapTx.data,
  };

  // Estimate gas using viem client if provided
  if (client && sender && ADDRESS_REGEX.test(sender)) {
    try {
      const gasEstimate = await client.estimateGas({
        account: sender as `0x${string}`,
        to: swapTx.to as `0x${string}`,
        data: swapTx.data as `0x${string}`,
        value: swapTx.value ? BigInt(swapTx.value) : 0n,
      });
      result.gas_used = gasEstimate.toString();
    } catch {
      // Gas estimation failed, leave it undefined
    }
  }

  if (sender && ADDRESS_REGEX.test(sender)) {
    try {
      const isApproved = await curve.hasAllowance([from], [inputAmount], sender, swapTx.to);
      if (!isApproved) {
        const approveTxs = await curve.router.populateApprove(from, inputAmount, false, sender);
        const approveTx = approveTxs[0];
        if (approveTx?.to && approveTx?.data) {
          result.approval_target = approveTx.to;
          result.approval_calldata = approveTx.data;
        }
      }
    } catch {
      // Approval check failed, skip it
    }
  }

  return result;
}
