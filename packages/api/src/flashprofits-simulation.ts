import { isNativeToken, type SwapParams } from "@spandex/core";
import {
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  parseAbi,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
} from "viem";
import type { flashprofitsTransaction } from "./flashprofits-wallet.js";

const native = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const multicall = "0xca11bde05977b3631167028862be2a173976ca11";
const balanceAbi = parseAbi(["function getEthBalance(address owner) view returns (uint256)"]);
const approvalTopic = keccak256(stringToHex("Approval(address,address,uint256)"));
const transferTopic = keccak256(stringToHex("Transfer(address,address,uint256)"));
const wrapped = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const wrapAbi = parseAbi([
  "event Deposit(address indexed owner, uint256 value)",
  "event Withdrawal(address indexed owner, uint256 value)",
]);
const wrapTopics = new Set([
  keccak256(stringToHex("Deposit(address,uint256)")),
  keccak256(stringToHex("Withdrawal(address,uint256)")),
]);

type Transaction = ReturnType<typeof flashprofitsTransaction>;
type Call = {
  from?: Address;
  to: Address;
  data: Hex;
  value?: bigint;
  gas?: bigint;
  gasPrice?: bigint;
};
type Pair = { token: Address; spender: Address };
type Probe = { call: Call; id: string };

function asset(token: Address): Address {
  return isNativeToken(token) ? native : (token.toLowerCase() as Address);
}

function balance(owner: Address, token: Address): Probe {
  return {
    id: `${owner}:${token}`,
    call:
      token === native
        ? { to: multicall, data: encodeFunctionData({ abi: balanceAbi, args: [owner] }) }
        : {
            to: token,
            data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
          },
  };
}

function allowance(owner: Address, pair: Pair): Probe {
  return {
    id: `${owner}:${pair.token.toLowerCase()}:${pair.spender.toLowerCase()}`,
    call: {
      to: pair.token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, pair.spender],
      }),
    },
  };
}

function snapshot(probes: Probe[], results: ReadonlyArray<{ status: string; data: Hex }>) {
  if (probes.length !== results.length) throw new Error("Wallet simulation is missing state reads");
  return new Map(
    probes.map((probe, index) => {
      const read = results[index];
      if (read?.status !== "success" || read.data.length !== 66)
        throw new Error("Wallet simulation did not return verified balances and allowances");
      return [probe.id, BigInt(read.data)];
    })
  );
}

function expectedEffects(logs: Log[], protectedAccounts: Set<string>, probes: Set<string>) {
  const amounts = new Map<string, bigint>();
  const approvals = new Map<string, bigint>();
  const movements: string[] = [];
  const credit = (owner: string, token: Address, delta: bigint) => {
    if (!protectedAccounts.has(owner)) return;
    const id = `${owner}:${token}`;
    if (!probes.has(id)) throw new Error("Simulation found a transfer of an unexpected asset");
    amounts.set(id, (amounts.get(id) ?? 0n) + delta);
  };
  for (const log of logs) {
    const topic = log.topics[0];
    const token = asset(log.address);
    if (token === wrapped && topic && wrapTopics.has(topic)) {
      const event = decodeEventLog({
        abi: wrapAbi,
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      const owner = event.args.owner.toLowerCase();
      if (protectedAccounts.has(owner)) {
        const delta = event.eventName === "Deposit" ? event.args.value : -event.args.value;
        credit(owner, token, delta);
        movements.push(`${token}:${owner}:${event.eventName}:${event.args.value}`);
      }
      continue;
    }
    if (topic !== transferTopic && topic !== approvalTopic) continue;
    const participants = log.topics.slice(1, 3).map((address) => `0x${address.slice(-40)}`);
    if (!participants.some((address) => protectedAccounts.has(address))) continue;
    const decoded = decodeEventLog({
      abi: erc20Abi,
      data: log.data,
      topics: log.topics,
      strict: true,
    });
    if (decoded.eventName === "Transfer") {
      const { from, to, value } = decoded.args;
      credit(from.toLowerCase(), token, -value);
      credit(to.toLowerCase(), token, value);
      movements.push(`${token}:${from.toLowerCase()}:${to.toLowerCase()}:${value}`);
    } else if (decoded.eventName === "Approval") {
      const { owner, spender, value } = decoded.args;
      if (!protectedAccounts.has(owner.toLowerCase())) continue;
      const id = `${owner.toLowerCase()}:${token}:${spender.toLowerCase()}`;
      if (!probes.has(id)) throw new Error("Simulation found an unexpected allowance change");
      approvals.set(id, value);
    }
  }
  return { amounts, approvals, movements };
}

function readState(state: Map<string, bigint>, id: string): bigint {
  const value = state.get(id);
  if (value === undefined) throw new Error("Wallet simulation is missing a state read");
  return value;
}

function checkBalances(args: {
  probes: Probe[];
  before: Map<string, bigint>;
  after: Map<string, bigint>;
  amounts: Map<string, bigint>;
  allowed: Set<string>;
  gasPayer: string;
  fees: bigint;
}) {
  for (const { id } of args.probes) {
    const fee = id === args.gasPayer ? args.fees : 0n;
    const delta = readState(args.after, id) - readState(args.before, id) + fee;
    if (delta !== (args.amounts.get(id) ?? 0n))
      throw new Error("Wallet balance changes do not match the transfer logs");
    if (delta !== 0n && !args.allowed.has(id))
      throw new Error("Simulation left unexpected balances in the wallet or executor");
  }
}

function checkAllowances(args: {
  probes: Probe[];
  before: Map<string, bigint>;
  after: Map<string, bigint>;
  expected: Map<string, bigint>;
  funding?: string;
}) {
  const effects: string[] = [];
  for (const { id } of args.probes) {
    const logged = args.expected.get(id);
    const previous = readState(args.before, id);
    const current = readState(args.after, id);
    if (id === args.funding) {
      if (current > previous || (logged !== undefined && current !== logged))
        throw new Error("Unexpected wallet funding allowance after simulation");
    } else {
      if (current !== (logged ?? previous))
        throw new Error("Simulation allowance does not match its log");
      if (logged !== undefined) effects.push(`${id}:${current}`);
    }
  }
  return effects.sort();
}

function checkTradeAmounts(args: {
  amounts: Map<string, bigint>;
  wallet: Address;
  swap: SwapParams;
  inputAmount: bigint;
  outputAmount: bigint;
  nativeExecutionCost: bigint;
}) {
  const { amounts, wallet, swap, inputAmount, outputAmount, nativeExecutionCost } = args;
  const input = asset(swap.inputToken);
  const output = asset(swap.outputToken);
  const nativeDelta = amounts.get(`${wallet}:${native}`) ?? 0n;
  if (
    input !== native &&
    output !== native &&
    (nativeDelta > 0n || -nativeDelta > nativeExecutionCost)
  )
    throw new Error("Unexpected native currency transfer");
  const sent = -(amounts.get(`${wallet}:${input}`) ?? 0n);
  const received = amounts.get(`${wallet}:${output}`) ?? 0n;
  const maximum = inputAmount + (input === native ? nativeExecutionCost : 0n);
  const minimum =
    swap.mode === "targetOut"
      ? swap.outputAmount
      : (outputAmount * BigInt(10_000 - swap.slippageBps)) / 10_000n;
  if (
    sent <= 0n ||
    sent > maximum ||
    (swap.mode === "exactIn" && sent < inputAmount) ||
    received <= 0n ||
    received < minimum
  )
    throw new Error("Simulated trade amounts differ from the request");
  return { sent, received };
}

export async function simulateFlashprofitsTrade(args: {
  client: PublicClient;
  swap: SwapParams;
  tx: Transaction;
  inputAmount: bigint;
  outputAmount: bigint;
  nativeExecutionCost: bigint;
  assets: Address[];
  approvals: Pair[];
}) {
  const { client, swap, tx, inputAmount, outputAmount, nativeExecutionCost } = args;
  const wallet = swap.swapperAccount.toLowerCase() as Address;
  const account = tx.to.toLowerCase() as Address;
  const owners = new Set([wallet, account]);
  const input = asset(swap.inputToken);
  const output = asset(swap.outputToken);
  const assets = new Set<Address>([native, input, output, ...args.assets.map(asset)]);
  const balanceProbes = [...owners].flatMap((owner) =>
    [...assets].map((token) => balance(owner, token))
  );
  const allowanceProbes = args.approvals.map((pair) => allowance(account, pair));
  const funding = tx.approval && allowance(wallet, tx.approval);
  if (funding) allowanceProbes.push(funding);
  const probes = [
    ...new Map([...balanceProbes, ...allowanceProbes].map((probe) => [probe.id, probe])).values(),
  ];
  const calls = probes.map(({ call }) => ({ ...call, from: zeroAddress }));
  const [gasPrice, blockNumber, funded] = await Promise.all([
    client.getGasPrice(),
    client.getBlockNumber({ cacheTime: 0 }),
    tx.approval
      ? client.readContract({
          address: tx.approval.token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [wallet, tx.approval.spender],
        })
      : Promise.resolve(inputAmount),
  ]);
  const approve: Call[] =
    tx.approval && funded < inputAmount
      ? [
          {
            from: wallet,
            to: tx.approval.token,
            gasPrice,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [tx.approval.spender, inputAmount],
            }),
          },
        ]
      : [];
  const trade = { from: wallet, to: tx.to, data: tx.data, value: tx.value, gasPrice };
  const run = async (gas?: bigint) => {
    const [block] = await client.simulateBlocks({
      blockNumber,
      traceTransfers: true,
      blocks: [{ calls: [...calls, ...approve, { ...trade, gas }, ...calls] }],
    });
    const results = block?.calls;
    const tradeIndex = calls.length + approve.length;
    const execution = results?.[tradeIndex];
    if (
      !results ||
      results.length !== tradeIndex + 1 + calls.length ||
      execution?.status !== "success" ||
      !execution.logs
    )
      throw new Error("Exact wallet transaction did not complete in simulation");
    const approval = approve.length ? results[calls.length] : undefined;
    if (approve.length && approval?.status !== "success")
      throw new Error("Simulated funding approval failed");
    return { results, execution, approval, tradeIndex };
  };
  const estimate = await run();
  const used = estimate.execution.maxUsedGas ?? estimate.execution.gasUsed;
  if (gasPrice <= 0n || used <= 0n) throw new Error("Wallet simulation is missing gas data");
  const gas = (used * 6n + 4n) / 5n;
  const { results, execution, approval, tradeIndex } = await run(gas);
  const before = snapshot(probes, results.slice(0, calls.length));
  const after = snapshot(probes, results.slice(tradeIndex + 1));
  const tracked = new Set(before.keys());
  const observed = expectedEffects(execution.logs ?? [], owners, tracked);
  if (approval) {
    if (!approval.logs || !funding) throw new Error("Simulation is missing funding approval logs");
    const changes = expectedEffects(approval.logs, owners, tracked);
    if (
      changes.movements.length ||
      changes.approvals.size !== 1 ||
      changes.approvals.get(funding.id) !== inputAmount
    )
      throw new Error("Simulated funding approval had unexpected effects");
  }
  const fees = (execution.gasUsed + (approval?.gasUsed ?? 0n)) * gasPrice;
  const gasPayer = `${wallet}:${native}`;
  checkBalances({
    probes: balanceProbes,
    before,
    after,
    amounts: observed.amounts,
    allowed: new Set([`${wallet}:${input}`, `${wallet}:${output}`, gasPayer]),
    gasPayer,
    fees,
  });
  const allowanceEffects = checkAllowances({
    probes: allowanceProbes,
    before,
    after,
    expected: observed.approvals,
    funding: funding?.id,
  });
  const { sent, received } = checkTradeAmounts({
    amounts: observed.amounts,
    wallet,
    swap,
    inputAmount,
    outputAmount,
    nativeExecutionCost,
  });
  const effects = keccak256(
    stringToHex(
      JSON.stringify([
        ...observed.movements,
        ...allowanceEffects,
        sent.toString(),
        received.toString(),
      ])
    )
  );
  return {
    effects,
    gas,
    gasPrice,
    gasUsed: execution.gasUsed,
    approvalGasUsed: approval?.gasUsed ?? 0n,
    received,
  };
}
