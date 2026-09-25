export const NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
export function isNativeToken(address: string): boolean {
  return [NATIVE_TOKEN.toLowerCase(), "0x0000000000000000000000000000000000000000"].includes(
    address.toLowerCase()
  );
}
export function canonicalToken(address: string): string {
  return isNativeToken(address) ? NATIVE_TOKEN : address;
}

/** Exact input text, with no rounding, exponent notation, or thousands separators. */
export function exactAmount(raw: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255 || raw < 0n)
    throw new Error("Invalid balance metadata");
  if (decimals === 0) return raw.toString();
  const scale = 10n ** BigInt(decimals);
  const fraction = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${raw / scale}${fraction ? `.${fraction}` : ""}`;
}
