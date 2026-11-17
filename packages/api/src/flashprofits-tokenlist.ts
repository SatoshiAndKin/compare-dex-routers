import { isAddress, zeroAddress } from "viem";
import { z } from "zod";
import { logger } from "./logger.js";
import { fetchFlashprofitsTokenlist } from "./tokenlists.js";

const REFRESH_INTERVAL_MS = 60_000;

const GraphTokenSchema = z.object({
  chainId: z.number().int().positive(),
  address: z.string().refine((address) => isAddress(address, { strict: false })),
  symbol: z.string().trim().min(1),
  decimals: z.number().int().min(0).max(255),
});

type Token = z.infer<typeof GraphTokenSchema> & { name: string };
type Snapshot = { name: string; tokens: Token[]; error?: string };

class FlashprofitsTokenlist {
  private tokens: Token[] | undefined;
  private pending: Promise<Snapshot | undefined> | undefined;
  private nextRefresh = 0;
  private stale = false;

  constructor(private readonly url: URL) {}

  load() {
    if (this.pending) return this.pending;
    if (Date.now() < this.nextRefresh) return Promise.resolve(this.result());
    this.pending = this.refresh().finally(() => {
      this.nextRefresh = Date.now() + REFRESH_INTERVAL_MS;
      this.pending = undefined;
    });
    return this.pending;
  }

  private result(): Snapshot | undefined {
    if (!this.tokens) return undefined;
    return {
      name: "Flashprofits allowed token list",
      tokens: this.tokens,
      ...(this.stale ? { error: "Showing last valid list." } : {}),
    };
  }

  private async refresh() {
    try {
      const entries = z.array(z.unknown()).parse(await fetchFlashprofitsTokenlist(this.url));
      const unique = new Map<string, Token>();
      for (const entry of entries) {
        const { data } = GraphTokenSchema.safeParse(entry);
        // Flashprofits uses the zero address for native ETH. CDR already adds it per chain.
        if (!data || data.address === zeroAddress) continue;
        unique.set(data.chainId + ":" + data.address.toLowerCase(), {
          ...data,
          name: data.symbol,
        });
      }
      // A cold graph can return an empty array, or omit metadata for every asset.
      if (!unique.size) throw new Error("Flashprofits token list has no usable assets");
      this.tokens = [...unique.values()];
      this.stale = false;
    } catch {
      this.stale = true;
      logger.warn("Flashprofits allowed token list refresh failed");
    }
    return this.result();
  }
}

let upstream: { base: string; list: FlashprofitsTokenlist } | undefined;

export async function loadFlashprofitsTokenlist() {
  const base = process.env.FLASHPROFITS_BASE_URL?.trim();
  if (!base) return undefined;
  if (upstream?.base !== base) {
    if (!URL.canParse("/api/v1/tokenlist.json", base)) return undefined;
    const url = new URL("/api/v1/tokenlist.json", base);
    upstream = { base, list: new FlashprofitsTokenlist(url) };
  }
  return upstream.list.load();
}
