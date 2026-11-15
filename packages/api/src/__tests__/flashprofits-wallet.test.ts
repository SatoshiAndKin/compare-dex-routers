import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCreate2Address,
  keccak256,
  toFunctionSelector,
  zeroHash,
  type Hex,
  type PublicClient,
} from "viem";
import { flashprofitsWallet } from "../flashprofits-wallet.js";
import { walletFactory } from "../flashprofits-wallet-factory.generated.js";

const wallet = "0x1111111111111111111111111111111111111111";
const deployerCode =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";
const interpreterCode = "0x01";
const factoryCodeFixture = "0x03";

vi.mock("viem", async (original) => {
  const viem = await original<typeof import("viem")>();
  return {
    ...viem,
    keccak256: (bytes: Hex | Uint8Array) => {
      if (bytes === interpreterCode)
        return "0x953fa3e7abf9f2eee5d7ea2d3b4200570deb995a04684553449817614af7369e";
      if (bytes === factoryCodeFixture) return walletFactory.codeHash;
      return viem.keccak256(bytes);
    },
  };
});

function fixture(factoryCode?: Hex, deployer: Hex = deployerCode, interpreter = true) {
  return {
    getCode: vi.fn(async ({ address }: { address: string }) => {
      if (address === walletFactory.interpreter) return interpreter ? interpreterCode : undefined;
      if (address === walletFactory.address) return factoryCode;
      if (address === walletFactory.deployer) return deployer;
      return undefined;
    }),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
      functionName === "interpreter" ? walletFactory.interpreter : wallet
    ),
  } as unknown as PublicClient;
}

afterEach(() => vi.unstubAllEnvs());

describe("Flashprofits factory setup", () => {
  it("offers the canonical CREATE2 deployment when the factory is empty", async () => {
    const setup = await flashprofitsWallet(fixture(), wallet);
    expect(setup).toEqual({
      kind: "deployFactory",
      to: walletFactory.deployer,
      data: walletFactory.deploymentData,
      factory: { address: walletFactory.address, code_hash: walletFactory.codeHash },
    });
    const salt = walletFactory.deploymentData.slice(0, 66) as Hex;
    expect(salt).toBe(zeroHash);
    expect(
      getCreate2Address({
        from: walletFactory.deployer,
        salt,
        bytecode: `0x${walletFactory.deploymentData.slice(66)}`,
      })
    ).toBe(walletFactory.address);
  });

  it.each([
    ["unexpected factory code", fixture("0x02")],
    ["an unverified deployer", fixture(undefined, "0x02")],
    ["a missing interpreter", fixture(undefined, deployerCode, false)],
  ])("blocks setup with %s", async (_, client) => {
    await expect(flashprofitsWallet(client, wallet)).resolves.toBeNull();
  });

  it("does not deploy a missing factory configured by override", async () => {
    vi.stubEnv("FLASHPROFITS_WALLET_FACTORY", wallet);
    vi.stubEnv("FLASHPROFITS_WALLET_FACTORY_CODE_HASH", keccak256("0x02"));
    await expect(flashprofitsWallet(fixture(), wallet)).resolves.toBeNull();
  });

  it("offers the per-wallet executor setup after factory deployment", async () => {
    await expect(flashprofitsWallet(fixture(factoryCodeFixture), wallet)).resolves.toEqual({
      kind: "setup",
      to: walletFactory.address,
      data: toFunctionSelector("create()"),
    });
  });
});
