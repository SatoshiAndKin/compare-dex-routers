import { z } from "zod";
import { logger } from "./logger.js";

const REFRESH_INTERVAL_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 2_000;

const ExtensionPartSchema = z.string().min(1).max(42);
const ExtensionTextSchema = z.union([
  ExtensionPartSchema,
  z.record(z.string().regex(/^[0-9]$/), ExtensionPartSchema).refine((parts) => {
    const keys = Object.keys(parts);
    return keys.length > 0 && keys.every((key, index) => key === String(index));
  }),
]);

const HttpsUrlSchema = z.url({ protocol: /^https$/ });

function readExtensionText(value: z.infer<typeof ExtensionTextSchema>): string {
  return typeof value === "string" ? value : Object.values(value).join("");
}

const BlockProvenanceSchema = z
  .looseObject({
    blockSource: ExtensionTextSchema,
    blockReason: ExtensionTextSchema,
    blockSourceUrl: ExtensionTextSchema,
  })
  .refine(
    (extensions) => HttpsUrlSchema.safeParse(readExtensionText(extensions.blockSourceUrl)).success
  );

const BlockedTokenSchema = z.looseObject({
  chainId: z.number().int().positive(),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  name: z.string().min(1),
  symbol: z.string().min(1),
  decimals: z.number().int().min(0).max(255),
  extensions: BlockProvenanceSchema,
});

export const BlockedTokenlistSchema = z.looseObject({
  name: z.string().min(1),
  timestamp: z.iso.datetime({ offset: true }),
  version: z.object({
    major: z.number().int().nonnegative(),
    minor: z.number().int().nonnegative(),
    patch: z.number().int().nonnegative(),
  }),
  tokens: z.array(BlockedTokenSchema).min(1).max(10_000),
});

type BlockedToken = z.infer<typeof BlockedTokenSchema>;

export function blockDetails(token: BlockedToken) {
  return {
    chainId: token.chainId,
    address: token.address,
    blockSource: readExtensionText(token.extensions.blockSource),
    blockReason: readExtensionText(token.extensions.blockReason),
    blockSourceUrl: readExtensionText(token.extensions.blockSourceUrl),
  };
}

const tokenKey = (chainId: number, address: string) => chainId + ":" + address.toLowerCase();

class BlockedTokenlistSnapshot {
  private readonly index = new Map<string, BlockedToken>();

  constructor(readonly list: z.infer<typeof BlockedTokenlistSchema>) {
    for (const token of list.tokens) {
      const key = tokenKey(token.chainId, token.address);
      if (this.index.has(key)) throw new Error("Duplicate blocked token");
      this.index.set(key, token);
    }
  }

  find(chainId: number, address: string) {
    return this.index.get(tokenKey(chainId, address));
  }
}

class BlockedTokenlist {
  private current: BlockedTokenlistSnapshot | undefined;
  private pending: Promise<BlockedTokenlistSnapshot | undefined> | undefined;
  private nextRefresh = 0;

  constructor(private readonly url: string) {}

  load() {
    if (this.pending) return this.pending;
    if (Date.now() < this.nextRefresh) return Promise.resolve(this.current);
    this.pending = this.refresh().finally(() => {
      this.nextRefresh = Date.now() + REFRESH_INTERVAL_MS;
      this.pending = undefined;
    });
    return this.pending;
  }

  private async refresh() {
    try {
      const response = await fetch(this.url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        redirect: "error",
      });
      if (!response.ok) throw new Error("Flashprofits returned HTTP " + String(response.status));
      this.current = new BlockedTokenlistSnapshot(
        BlockedTokenlistSchema.parse(await response.json())
      );
    } catch {
      logger.warn("Flashprofits blocked token list refresh failed");
    }
    return this.current;
  }
}

let upstream: { url: string; source: BlockedTokenlist } | undefined;

export function loadBlockedTokenlist() {
  const override = process.env.FLASHPROFITS_TOKENLIST_URL?.trim();
  const base = process.env.FLASHPROFITS_BASE_URL?.trim();
  if (!override && !base) return Promise.resolve(undefined);
  let url: string;
  try {
    url = override || new URL("/api/v1/blocked-tokenlist.json", base).href;
  } catch {
    logger.warn("Invalid Flashprofits blocked token list URL");
    return Promise.resolve(undefined);
  }
  if (upstream?.url !== url) upstream = { url, source: new BlockedTokenlist(url) };
  return upstream.source.load();
}
