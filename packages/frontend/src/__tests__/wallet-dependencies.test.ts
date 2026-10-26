import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// Resolve through the public SDKs so these tests use the same transitive
// dependencies as the application, including the security overrides.
const require = createRequire(import.meta.url);
const walletConnectRequire = createRequire(require.resolve("@walletconnect/ethereum-provider"));
const appkitRequire = createRequire(walletConnectRequire.resolve("@reown/appkit"));
const appkitUtilsRequire = createRequire(appkitRequire.resolve("@reown/appkit-utils"));
const baseRequire = createRequire(appkitUtilsRequire.resolve("@base-org/account"));
const coinbaseRequire = createRequire(baseRequire.resolve("@coinbase/cdp-sdk"));
type Schema = { safeParse: (input: unknown) => { success: boolean; data?: unknown } };
const schemas = (await import(
  new URL("../src/W3mFrameSchema.js", pathToFileURL(appkitRequire.resolve("@reown/appkit-wallet")))
    .href
)) as Record<string, Schema>;

const { SignEvmTypedDataFieldCriterionSchema } = (await import(
  new URL("./policies/evmSchema.js", pathToFileURL(coinbaseRequire.resolve("@coinbase/cdp-sdk")))
    .href
)) as { SignEvmTypedDataFieldCriterionSchema: Schema };

describe("wallet dependency contracts", () => {
  it("validates network and theme messages with the wallet SDK's Zod dependency", () => {
    for (const chainId of [1, "eip155:1"]) {
      expect(schemas.AppSwitchNetworkRequest.safeParse({ chainId }).success).toBe(true);
    }
    const theme = {
      themeMode: "dark",
      themeVariables: { "--w3m-accent": "#123456", "--w3m-z-index": 10 },
      w3mThemeVariables: { "--w3m-font-family": "sans-serif" },
    };
    expect(schemas.AppSyncThemeRequest.safeParse(theme)).toMatchObject({
      success: true,
      data: theme,
    });
    expect(schemas.AppSwitchNetworkRequest.safeParse({ chainId: {} }).success).toBe(false);
    expect(schemas.AppSyncThemeRequest.safeParse({ themeVariables: { color: {} } }).success).toBe(
      false
    );
  });

  it("rejects malformed signing messages and preserves valid wallet calls", () => {
    const call = {
      method: "wallet_sendCalls",
      params: [{ chainId: "0x1", calls: [{ to: `0x${"1".repeat(40)}`, value: "0x0" }] }],
    };
    expect(schemas.WalletSendCallsRequest.safeParse(call)).toMatchObject({
      success: true,
      data: call,
    });
    expect(
      schemas.WalletSendCallsRequest.safeParse({ method: "wallet_sendCalls", params: [{}] }).success
    ).toBe(false);
    expect(
      schemas.RpcPersonalSignRequest.safeParse({ method: "personal_sign", params: "invalid" })
        .success
    ).toBe(false);
  });

  it("preserves Coinbase EIP-712 policy validation with the upgraded Zod dependency", () => {
    const policy = {
      type: "evmTypedDataField",
      types: { types: { Mail: [{ name: "contents", type: "string" }] }, primaryType: "Mail" },
      conditions: [{ match: "hello", path: "contents" }],
    };
    expect(SignEvmTypedDataFieldCriterionSchema.safeParse(policy)).toMatchObject({
      success: true,
      data: policy,
    });
    for (const types of [{ Mail: "invalid" }, { Mail: [{ name: 42, type: "string" }] }]) {
      expect(
        SignEvmTypedDataFieldCriterionSchema.safeParse({
          ...policy,
          types: { ...policy.types, types },
        }).success
      ).toBe(false);
    }
  });
});
