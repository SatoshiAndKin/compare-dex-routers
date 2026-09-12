import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { logger } from "./logger.js";

const payloadSchema = z.object({
  name: z.string().optional(),
  tokens: z.array(
    z.object({
      chainId: z.number().int().positive(),
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      name: z.string(),
      symbol: z.string(),
      decimals: z.number().int().min(0).max(255),
      logoURI: z.string().optional(),
    })
  ),
});

interface Entry {
  name: string;
  tokens: z.infer<typeof payloadSchema>["tokens"];
  error?: string;
}

/** Cache parsed files, but check their identity on every token-list request. */
export class TokenlistFiles {
  private cache = new Map<string, { signature: string; entry: Entry }>();
  private pending = new Map<string, Promise<Entry>>();

  async load(): Promise<Entry[]> {
    const paths = [
      ...new Set(
        (process.env.DEFAULT_TOKENLISTS?.trim() || "static/tokenlist.json")
          .split(",")
          .map((path) => path.trim())
          .filter(Boolean)
          .map((path) => resolve(path))
      ),
    ];
    for (const path of this.cache.keys()) {
      if (!paths.includes(path)) this.cache.delete(path);
    }
    return Promise.all(
      paths.map((path) => {
        const pending = this.pending.get(path);
        if (pending) return pending;
        const request = this.read(path).finally(() => this.pending.delete(path));
        this.pending.set(path, request);
        return request;
      })
    );
  }

  private async read(path: string): Promise<Entry> {
    const cached = this.cache.get(path);
    try {
      const before = await stat(path, { bigint: true });
      const signature = [before.ino, before.size, before.mtimeNs, before.ctimeNs].join(":");
      if (cached?.signature === signature) return cached.entry;
      const payload = payloadSchema.parse(JSON.parse(await readFile(path, "utf8")));
      const after = await stat(path, { bigint: true });
      if ([after.ino, after.size, after.mtimeNs, after.ctimeNs].join(":") !== signature) {
        throw new Error("Token list changed while it was being read");
      }
      const entry = { name: payload.name?.trim() || basename(path), tokens: payload.tokens };
      this.cache.set(path, { signature, entry });
      return entry;
    } catch (error) {
      logger.warn({ err: error, path }, "Token list refresh failed");
      return {
        ...(cached?.entry ?? { name: basename(path), tokens: [] }),
        error: cached ? "Refresh failed. Showing the last valid list." : "Cannot load token list.",
      };
    }
  }
}
