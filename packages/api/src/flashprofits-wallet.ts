import {
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  maxUint256,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { isNativeToken, type SwapParams } from "@spandex/core";
import { walletFactory } from "./flashprofits-wallet-factory.generated.js";

// Mainnet deployment identities from Flashprofits contracts/flashprofits-7702/deployments.toml.
const amountFlow = walletFactory.interpreter;
const amountFlowHash = "0x953fa3e7abf9f2eee5d7ea2d3b4200570deb995a04684553449817614af7369e";
const flashAccount = "0xe0c3dcf7ea00847400b63b39008b00005900f08f";
const flashAccountHash = "0x903c0ba125e59e49743f477134f4a8b3b37a8600de342a35ac6680cfa7258aaf";

const factoryAbi = parseAbi([
  "function executorOf(address wallet) view returns (address)",
  "function interpreter() view returns (address)",
  "function create() returns (address)",
]);
const executorAbi = parseAbi([
  "function owner() view returns (address)",
  "function interpreter() view returns (address)",
  "function execute(address inputToken,uint256 inputAmount,address outputToken,bytes plan) payable returns (uint256)",
]);
const delegatedAbi = parseAbi([
  "function transientExecute(uint256 tip,uint256 deadline,address target,bytes data) returns (bytes)",
]);
const amountFlowAbi = parseAbi(["function execute(bytes plan) payable returns (uint256)"]);

export type WalletBinding =
  | { kind: "delegation" | "executor"; account: Address }
  | { kind: "setup"; to: Address; data: Hex }
  | {
      kind: "deployFactory";
      to: Address;
      data: Hex;
      factory: { address: Address; code_hash: Hex };
    };

export async function flashprofitsWallet(
  client: PublicClient,
  wallet: Address
): Promise<WalletBinding | null> {
  const [walletCode, interpreterCode] = await Promise.all([
    client.getCode({ address: wallet }),
    client.getCode({ address: amountFlow }),
  ]);
  if (!interpreterCode || keccak256(interpreterCode) !== amountFlowHash) return null;
  if (walletCode?.toLowerCase() === `0xef0100${flashAccount.slice(2)}`) {
    const delegatedCode = await client.getCode({ address: flashAccount });
    if (delegatedCode && keccak256(delegatedCode) === flashAccountHash)
      return { kind: "delegation", account: wallet };
  }

  const factoryAddress = process.env.FLASHPROFITS_WALLET_FACTORY;
  const factoryCodeHash = process.env.FLASHPROFITS_WALLET_FACTORY_CODE_HASH?.toLowerCase();
  const override = Boolean(factoryAddress || factoryCodeHash);
  if (override && (!factoryAddress || !isAddress(factoryAddress) || !factoryCodeHash)) return null;
  const factory = factoryAddress ? getAddress(factoryAddress) : walletFactory.address;
  const factoryCode = await client.getCode({ address: factory });
  if (!factoryCode) {
    if (override) return null;
    const deployerCode = await client.getCode({ address: walletFactory.deployer });
    if (!deployerCode || keccak256(deployerCode) !== walletFactory.deployerCodeHash) return null;
    return {
      kind: "deployFactory",
      to: walletFactory.deployer,
      data: walletFactory.deploymentData,
      factory: { address: walletFactory.address, code_hash: walletFactory.codeHash },
    };
  }
  if (keccak256(factoryCode) !== (factoryCodeHash ?? walletFactory.codeHash)) return null;
  return walletExecutor(client, factory, wallet);
}

async function walletExecutor(
  client: PublicClient,
  factory: Address,
  wallet: Address
): Promise<WalletBinding | null> {
  const [interpreter, account] = await Promise.all([
    client.readContract({ address: factory, abi: factoryAbi, functionName: "interpreter" }),
    client.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "executorOf",
      args: [wallet],
    }),
  ]);
  if (interpreter.toLowerCase() !== amountFlow) return null;
  const executorCode = await client.getCode({ address: account });
  if (!executorCode || executorCode === "0x")
    return {
      kind: "setup",
      to: factory,
      data: encodeFunctionData({ abi: factoryAbi, functionName: "create" }),
    };
  const [owner, executorInterpreter] = await Promise.all([
    client.readContract({ address: account, abi: executorAbi, functionName: "owner" }),
    client.readContract({ address: account, abi: executorAbi, functionName: "interpreter" }),
  ]);
  if (
    owner.toLowerCase() !== wallet.toLowerCase() ||
    executorInterpreter.toLowerCase() !== amountFlow
  )
    return null;
  return { kind: "executor", account };
}

export function flashprofitsTransaction(
  wallet: Extract<WalletBinding, { kind: "delegation" | "executor" }>,
  swap: SwapParams,
  inputAmount: bigint,
  nativeExecutionCost: bigint,
  plan: Hex
) {
  if (wallet.kind === "delegation")
    return {
      to: wallet.account,
      data: encodeFunctionData({
        abi: delegatedAbi,
        functionName: "transientExecute",
        args: [
          0n,
          maxUint256,
          amountFlow,
          encodeFunctionData({ abi: amountFlowAbi, functionName: "execute", args: [plan] }),
        ],
      }),
      value: 0n,
      approval: null,
    };
  const nativeInput = isNativeToken(swap.inputToken);
  return {
    to: wallet.account,
    data: encodeFunctionData({
      abi: executorAbi,
      functionName: "execute",
      args: [
        nativeInput ? zeroAddress : swap.inputToken,
        inputAmount,
        isNativeToken(swap.outputToken) ? zeroAddress : swap.outputToken,
        plan,
      ],
    }),
    value: nativeExecutionCost + (nativeInput ? inputAmount : 0n),
    approval: nativeInput ? null : { token: swap.inputToken, spender: wallet.account },
  };
}
