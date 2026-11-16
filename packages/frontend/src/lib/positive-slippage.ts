const keepsSurplus = "Keeps positive slippage";
const mayKeepSurplus = "May keep positive slippage";

const labels = new Map<string, string>([
  // https://docs.nordstern.finance/swap-route#positive-slippage
  ["nordstern", keepsSurplus],
  // https://support.kyberswap.com/hc/en-us/articles/13463956968857-What-Fees-Do-I-Need-To-Pay-to-Use-KyberSwap
  ["kyberswap", keepsSurplus],
  // Augustus V6.2 captures surplus by default, with token and partner exceptions.
  // https://repo.sourcify.dev/1/0x6a000f20005980200259b80c5102003040001068
  ["velora", mayKeepSurplus],
  // https://docs.0x.org/evm/0x-swap-api/guides/monetize-your-app-using-swap
  ["0x", mayKeepSurplus],
]);

export function positiveSlippageLabel(provider: string): string | undefined {
  return labels.get(provider);
}
