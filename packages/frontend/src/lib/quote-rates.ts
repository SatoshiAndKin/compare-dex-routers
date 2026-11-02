import { formatUnits } from "viem";

/** Full-trade ratio, rounded to six significant digits without floating-point arithmetic. */
export function formatQuoteRate(received: string, paid: string): string | null {
  const decimal = /^(\d+)(?:\.(\d+))?$/;
  const output = decimal.exec(received);
  const input = decimal.exec(paid);
  if (!output || !input) return null;
  const outputFraction = output[2] ?? "";
  const inputFraction = input[2] ?? "";
  const numerator = BigInt(`${output[1]}${outputFraction}`) * 10n ** BigInt(inputFraction.length);
  const denominator = BigInt(`${input[1]}${inputFraction}`) * 10n ** BigInt(outputFraction.length);
  if (numerator === 0n || denominator === 0n) return null;

  let exponent = numerator.toString().length - denominator.toString().length;
  const belowPower =
    exponent >= 0
      ? numerator < denominator * 10n ** BigInt(exponent)
      : numerator * 10n ** BigInt(-exponent) < denominator;
  if (belowPower) exponent -= 1;
  const places = 5 - exponent;
  const scaledNumerator = numerator * 10n ** BigInt(Math.max(0, places));
  const scaledDenominator = denominator * 10n ** BigInt(Math.max(0, -places));
  const rounded = (scaledNumerator * 2n + scaledDenominator) / (scaledDenominator * 2n);
  return places >= 0 ? formatUnits(rounded, places) : (rounded * 10n ** BigInt(-places)).toString();
}
