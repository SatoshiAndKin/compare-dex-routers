import curve from "@curvefi/api";
import type { PublicClient } from "viem";
import type { QuoteMode } from "./quote.js";

const CURVE_CHAIN_ID = 1;

let initialized = false;
let initPromise: Promise<void> | null = null;

export function isCurveSupported(chainId: number): boolean {
  return chainId === CURVE_CHAIN_ID;
}

export async function initCurve(rpcUrl: string): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    await curve.init("JsonRpc", { url: rpcUrl }, { chainId: CURVE_CHAIN_ID });

    await Promise.all([
      curve.factory.fetchPools(),
      curve.crvUSDFactory.fetchPools(),
      curve.cryptoFactory.fetchPools(),
      curve.twocryptoFactory.fetchPools(),
      curve.tricryptoFactory.fetchPools(),
      curve.stableNgFactory.fetchPools(),
    ]);

    initialized = true;
  })();

  return initPromise;
}

const symbolCache = new Map<string, string>();

async function getCurveTokenSymbol(address: string): Promise<string> {
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

interface CurveRouteStep {
  poolId?: string;
  poolName?: string;
  poolAddress?: string;
  inputCoinAddress?: string;
  outputCoinAddress?: string;
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
}

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export async function findCurveQuote(
  from: string,
  to: string,
  amount: string,
  sender?: string,
  client?: PublicClient,
  mode: QuoteMode = "exactIn"
): Promise<CurveQuoteResult> {
  if (!initialized) throw new Error("Curve API not initialized");

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
    getCurveTokenSymbol(from),
    getCurveTokenSymbol(to),
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
      const symbol = await getCurveTokenSymbol(addr);
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
