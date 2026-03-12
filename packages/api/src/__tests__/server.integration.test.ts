import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleRequest } from "../server.js";

const TEST_PORT = 0; // Let OS assign a free port

function request(
  url: string
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      })
      .on("error", reject);
  });
}

describe("server integration", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.PORT = String(TEST_PORT);
    process.env.HOST = "127.0.0.1";
    process.env.ALCHEMY_API_KEY ??= "test-key";

    server = http.createServer((req, res) => {
      void handleRequest(req, res);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const addr = server.address();
    if (addr && typeof addr === "object") {
      baseUrl = `http://127.0.0.1:${addr.port}`;
    }
  });

  afterAll(async () => {
    delete process.env.DEFAULT_TOKENLISTS;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /health returns 200 with status ok", async () => {
    const res = await request(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("ok");
  });

  it("GET /health returns JSON content-type", async () => {
    const res = await request(`${baseUrl}/health`);
    expect(res.headers["content-type"]).toContain("application/json");
  });

  // API-only server: GET / returns 404 (no HTML serving)
  it("GET / returns 404 (no HTML serving in API-only mode)", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(404);
  });

  // GET /config endpoint tests
  it("GET /config returns 200", async () => {
    const res = await request(`${baseUrl}/config`);
    expect(res.status).toBe(200);
  });

  it("GET /config returns application/json content-type", async () => {
    const res = await request(`${baseUrl}/config`);
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("GET /config has CORS header", async () => {
    const res = await request(`${baseUrl}/config`);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("GET /config returns defaultTokens object", async () => {
    const res = await request(`${baseUrl}/config`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.defaultTokens).toBeDefined();
    expect(typeof body.defaultTokens).toBe("object");
  });

  it("GET /config defaultTokens contains chainId 1 (Ethereum)", async () => {
    const res = await request(`${baseUrl}/config`);
    const body = JSON.parse(res.body);
    expect(body.defaultTokens["1"]).toBeDefined();
    expect(body.defaultTokens["1"].from).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(body.defaultTokens["1"].to).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("GET /config defaultTokens contains chainId 8453 (Base)", async () => {
    const res = await request(`${baseUrl}/config`);
    const body = JSON.parse(res.body);
    expect(body.defaultTokens["8453"]).toBeDefined();
    expect(body.defaultTokens["8453"].from).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(body.defaultTokens["8453"].to).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("GET /config defaultTokens has all 7 supported chains", async () => {
    const res = await request(`${baseUrl}/config`);
    const body = JSON.parse(res.body);
    const chainIds = Object.keys(body.defaultTokens).map(Number);
    expect(chainIds).toEqual(expect.arrayContaining([1, 8453, 42161, 10, 137, 56, 43114]));
    expect(chainIds).toHaveLength(7);
  });

  it("GET /config returns walletConnectProjectId field", async () => {
    const res = await request(`${baseUrl}/config`);
    const body = JSON.parse(res.body);
    expect("walletConnectProjectId" in body).toBe(true);
    expect(typeof body.walletConnectProjectId).toBe("string");
  });

  it("GET /config defaultTokens addresses are never truncated (full 42-char hex)", async () => {
    const res = await request(`${baseUrl}/config`);
    const body = JSON.parse(res.body);
    for (const entry of Object.values(body.defaultTokens) as Array<{
      from: string;
      to: string;
    }>) {
      expect(entry.from).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(entry.to).toMatch(/^0x[a-fA-F0-9]{40}$/);
      // Verify not truncated (no ellipsis patterns)
      expect(entry.from).not.toContain("...");
      expect(entry.to).not.toContain("...");
    }
  });

  it("GET /config does not expose secrets or API keys", async () => {
    const res = await request(`${baseUrl}/config`);
    const body = res.body;
    expect(body).not.toContain("ALCHEMY");
    expect(body).not.toContain("alchemy");
    expect(body).not.toContain("apiKey");
  });

  it("GET /config returns non-empty defaultTokens for each supported chain", async () => {
    const res = await request(`${baseUrl}/config`);
    const body = JSON.parse(res.body);
    for (const [, entry] of Object.entries(
      body.defaultTokens as Record<string, { from: string; to: string }>
    )) {
      expect(entry.from).toBeTruthy();
      expect(entry.to).toBeTruthy();
    }
  });

  it("GET /config has CORS Access-Control-Allow-Methods header", async () => {
    const res = await request(`${baseUrl}/config`);
    expect(res.headers["access-control-allow-methods"]).toContain("GET");
  });

  it("GET /static/ returns 404 (static files not served by API)", async () => {
    const res = await request(`${baseUrl}/static/client.js`);
    expect(res.status).toBe(404);
  });

  it("GET /chains returns 200", async () => {
    const res = await request(`${baseUrl}/chains`);
    expect(res.status).toBe(200);
  });

  it("GET /unknown returns 404", async () => {
    const res = await request(`${baseUrl}/unknown`);
    expect(res.status).toBe(404);
  });

  it("GET /tokenlist returns 200 with JSON body", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenlist-200-"));
    const tokenlistPath = join(dir, "tokenlist.json");
    const fixture = {
      tokens: [
        {
          chainId: 1,
          address: "0x0000000000000000000000000000000000000001",
          name: "Test Token",
          symbol: "TST",
          decimals: 18,
          logoURI: "https://example.com/tst.png",
        },
      ],
    };
    await writeFile(tokenlistPath, JSON.stringify(fixture), "utf8");
    process.env.DEFAULT_TOKENLISTS = tokenlistPath;
    try {
      const res = await request(`${baseUrl}/tokenlist`);
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.tokens)).toBe(true);
      expect(body.tokens.length).toBeGreaterThan(0);
    } finally {
      delete process.env.DEFAULT_TOKENLISTS;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("GET /tokenlist returns application/json content-type", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenlist-ct-"));
    const tokenlistPath = join(dir, "tokenlist.json");
    await writeFile(
      tokenlistPath,
      JSON.stringify({
        tokens: [
          {
            chainId: 1,
            address: "0x0000000000000000000000000000000000000001",
            name: "T",
            symbol: "T",
            decimals: 18,
            logoURI: "",
          },
        ],
      }),
      "utf8"
    );
    process.env.DEFAULT_TOKENLISTS = tokenlistPath;
    try {
      const res = await request(`${baseUrl}/tokenlist`);
      expect(res.headers["content-type"]).toContain("application/json");
    } finally {
      delete process.env.DEFAULT_TOKENLISTS;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("GET /tokenlist response has token objects with expected fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenlist-fields-"));
    const tokenlistPath = join(dir, "tokenlist.json");
    const fixture = {
      tokens: [
        {
          chainId: 1,
          address: "0x0000000000000000000000000000000000000001",
          name: "Test Token",
          symbol: "TST",
          decimals: 18,
          logoURI: "https://example.com/tst.png",
        },
      ],
    };
    await writeFile(tokenlistPath, JSON.stringify(fixture), "utf8");
    process.env.DEFAULT_TOKENLISTS = tokenlistPath;
    try {
      const res = await request(`${baseUrl}/tokenlist`);
      const body = JSON.parse(res.body);
      const token = body.tokens[0];

      expect(token).toMatchObject({
        chainId: expect.any(Number),
        address: expect.any(String),
        name: expect.any(String),
        symbol: expect.any(String),
        decimals: expect.any(Number),
        logoURI: expect.any(String),
      });
    } finally {
      delete process.env.DEFAULT_TOKENLISTS;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("GET /tokenlist caches file contents in memory after first read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokenlist-cache-"));
    const tokenlistPath = join(dir, "tokenlist.json");

    const initial = {
      tokens: [
        {
          chainId: 1,
          address: "0x0000000000000000000000000000000000000001",
          name: "Initial Token",
          symbol: "INIT",
          decimals: 18,
          logoURI: "https://example.com/init.png",
        },
      ],
    };

    const updated = {
      tokens: [
        {
          chainId: 1,
          address: "0x0000000000000000000000000000000000000002",
          name: "Updated Token",
          symbol: "UPD",
          decimals: 18,
          logoURI: "https://example.com/upd.png",
        },
      ],
    };

    try {
      await writeFile(tokenlistPath, JSON.stringify(initial), "utf8");
      process.env.DEFAULT_TOKENLISTS = tokenlistPath;

      const firstResponse = await request(`${baseUrl}/tokenlist`);
      expect(firstResponse.status).toBe(200);
      expect(JSON.parse(firstResponse.body).tokens[0].name).toBe("Initial Token");

      await writeFile(tokenlistPath, JSON.stringify(updated), "utf8");

      const secondResponse = await request(`${baseUrl}/tokenlist`);
      expect(secondResponse.status).toBe(200);
      expect(JSON.parse(secondResponse.body).tokens[0].name).toBe("Initial Token");
    } finally {
      delete process.env.DEFAULT_TOKENLISTS;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("GET /tokenlist returns 200 with empty arrays when file is missing (logs error)", async () => {
    process.env.DEFAULT_TOKENLISTS = join(tmpdir(), `missing-tokenlist-${Date.now()}.json`);

    try {
      const res = await request(`${baseUrl}/tokenlist`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/json");
      const body = JSON.parse(res.body);
      // Should return empty arrays when no tokenlists can be loaded
      expect(body.tokenlists).toEqual([]);
      expect(body.tokens).toEqual([]);
    } finally {
      delete process.env.DEFAULT_TOKENLISTS;
    }
  });

  // /config endpoint - additional validation
  it("GET /config only returns expected top-level keys", async () => {
    const res = await request(`${baseUrl}/config`);
    const body = JSON.parse(res.body);
    const keys = Object.keys(body);
    expect(keys).toContain("defaultTokens");
    expect(keys).toContain("walletConnectProjectId");
  });

  it("GET /config walletConnectProjectId is empty string when env var not set", async () => {
    const saved = process.env.WALLETCONNECT_PROJECT_ID;
    delete process.env.WALLETCONNECT_PROJECT_ID;
    try {
      const res = await request(`${baseUrl}/config`);
      const body = JSON.parse(res.body);
      expect(body.walletConnectProjectId).toBe("");
    } finally {
      if (saved !== undefined) process.env.WALLETCONNECT_PROJECT_ID = saved;
    }
  });

  it("GET /config defaultTokens has from != to for each chain", async () => {
    const res = await request(`${baseUrl}/config`);
    const body = JSON.parse(res.body);
    for (const [, entry] of Object.entries(
      body.defaultTokens as Record<string, { from: string; to: string }>
    )) {
      expect(entry.from.toLowerCase()).not.toBe(entry.to.toLowerCase());
    }
  });

  it("GET /chains returns JSON content-type", async () => {
    const res = await request(`${baseUrl}/chains`);
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("GET /chains returns all supported chain IDs", async () => {
    const res = await request(`${baseUrl}/chains`);
    const body = JSON.parse(res.body);
    const chainIds = Object.keys(body).map(Number);
    expect(chainIds).toEqual(expect.arrayContaining([1, 8453, 42161, 10, 137, 56, 43114]));
  });

  // VAL-TL-003: Multiple default tokenlists via DEFAULT_TOKENLISTS env var
  describe("GET /tokenlist with multiple defaults", () => {
    it("returns tokenlists array with one entry per default tokenlist", async () => {
      const dir1 = await mkdtemp(join(tmpdir(), "tokenlist-multi-1-"));
      const dir2 = await mkdtemp(join(tmpdir(), "tokenlist-multi-2-"));
      const path1 = join(dir1, "list1.json");
      const path2 = join(dir2, "list2.json");

      const list1 = {
        name: "First List",
        tokens: [
          {
            chainId: 1,
            address: "0x0000000000000000000000000000000000000001",
            name: "Token One",
            symbol: "ONE",
            decimals: 18,
          },
        ],
      };
      const list2 = {
        name: "Second List",
        tokens: [
          {
            chainId: 1,
            address: "0x0000000000000000000000000000000000000002",
            name: "Token Two",
            symbol: "TWO",
            decimals: 18,
          },
        ],
      };

      await writeFile(path1, JSON.stringify(list1), "utf8");
      await writeFile(path2, JSON.stringify(list2), "utf8");
      process.env.DEFAULT_TOKENLISTS = `${path1},${path2}`;

      try {
        const res = await request(`${baseUrl}/tokenlist`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);

        // Should have tokenlists array with 2 entries
        expect(Array.isArray(body.tokenlists)).toBe(true);
        expect(body.tokenlists.length).toBe(2);

        // Each entry should have name and tokens
        expect(body.tokenlists[0].name).toBe("First List");
        expect(body.tokenlists[0].tokens.length).toBe(1);
        expect(body.tokenlists[1].name).toBe("Second List");
        expect(body.tokenlists[1].tokens.length).toBe(1);

        // Merged tokens array should have both
        expect(body.tokens.length).toBe(2);
      } finally {
        delete process.env.DEFAULT_TOKENLISTS;
        await rm(dir1, { recursive: true, force: true });
        await rm(dir2, { recursive: true, force: true });
      }
    });

    it("returns tokenlists array for single default tokenlist", async () => {
      const dir = await mkdtemp(join(tmpdir(), "tokenlist-single-"));
      const tokenlistPath = join(dir, "tokenlist.json");
      const fixture = {
        name: "Single List",
        tokens: [
          {
            chainId: 1,
            address: "0x0000000000000000000000000000000000000001",
            name: "Test Token",
            symbol: "TST",
            decimals: 18,
          },
        ],
      };
      await writeFile(tokenlistPath, JSON.stringify(fixture), "utf8");
      process.env.DEFAULT_TOKENLISTS = tokenlistPath;

      try {
        const res = await request(`${baseUrl}/tokenlist`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);

        // Should have tokenlists array with 1 entry
        expect(Array.isArray(body.tokenlists)).toBe(true);
        expect(body.tokenlists.length).toBe(1);
        expect(body.tokenlists[0].name).toBe("Single List");
        expect(body.tokenlists[0].tokens.length).toBe(1);
      } finally {
        delete process.env.DEFAULT_TOKENLISTS;
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("merges tokens from all default tokenlists into flat tokens array", async () => {
      const dir1 = await mkdtemp(join(tmpdir(), "tokenlist-merge-1-"));
      const dir2 = await mkdtemp(join(tmpdir(), "tokenlist-merge-2-"));
      const path1 = join(dir1, "list1.json");
      const path2 = join(dir2, "list2.json");

      const list1 = {
        name: "List A",
        tokens: [
          {
            chainId: 1,
            address: "0x0000000000000000000000000000000000000001",
            name: "A",
            symbol: "A",
            decimals: 18,
          },
        ],
      };
      const list2 = {
        name: "List B",
        tokens: [
          {
            chainId: 1,
            address: "0x0000000000000000000000000000000000000002",
            name: "B",
            symbol: "B",
            decimals: 18,
          },
        ],
      };

      await writeFile(path1, JSON.stringify(list1), "utf8");
      await writeFile(path2, JSON.stringify(list2), "utf8");
      process.env.DEFAULT_TOKENLISTS = `${path1},${path2}`;

      try {
        const res = await request(`${baseUrl}/tokenlist`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);

        // Merged tokens array should have both tokens
        expect(body.tokens.length).toBe(2);
        const symbols = body.tokens.map((t: { symbol: string }) => t.symbol);
        expect(symbols).toContain("A");
        expect(symbols).toContain("B");
      } finally {
        delete process.env.DEFAULT_TOKENLISTS;
        await rm(dir1, { recursive: true, force: true });
        await rm(dir2, { recursive: true, force: true });
      }
    });
  });

  // Token metadata endpoint tests
  describe("GET /token-metadata", () => {
    it("returns 400 when chainId parameter is missing", async () => {
      const res = await request(
        `${baseUrl}/token-metadata?address=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
      );
      expect(res.status).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain("Missing or invalid chainId");
    });

    it("returns 400 when address parameter is missing", async () => {
      const res = await request(`${baseUrl}/token-metadata?chainId=1`);
      expect(res.status).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain("Missing or invalid address");
    });

    it("returns 400 for unsupported chainId", async () => {
      const res = await request(
        `${baseUrl}/token-metadata?chainId=999&address=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
      );
      expect(res.status).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain("Unsupported chain");
    });

    it("returns 400 for invalid address format", async () => {
      const res = await request(`${baseUrl}/token-metadata?chainId=1&address=not-an-address`);
      expect(res.status).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain("Invalid address format");
    });

    it("returns 400 for address with wrong length", async () => {
      const res = await request(`${baseUrl}/token-metadata?chainId=1&address=0x1234`);
      expect(res.status).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain("Invalid address format");
    });

    it("returns application/json content-type", async () => {
      const res = await request(
        `${baseUrl}/token-metadata?chainId=1&address=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
      );
      expect(res.headers["content-type"]).toContain("application/json");
    });
  });

  // /config endpoint - CORS tests
  describe("/config CORS behavior", () => {
    it("GET /config has Access-Control-Allow-Origin: *", async () => {
      const res = await request(`${baseUrl}/config`);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
    });

    it("GET /health also has CORS headers", async () => {
      const res = await request(`${baseUrl}/health`);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
    });

    it("GET /chains also has CORS headers", async () => {
      const res = await request(`${baseUrl}/chains`);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
    });
  });

  // /config returns stable structure across requests
  describe("GET /config stability", () => {
    it("returns consistent data across multiple requests", async () => {
      const res1 = await request(`${baseUrl}/config`);
      const res2 = await request(`${baseUrl}/config`);
      expect(res1.body).toBe(res2.body);
    });

    it("defaultTokens never contains truncated addresses", async () => {
      const res = await request(`${baseUrl}/config`);
      const body = JSON.parse(res.body);
      // No address should be shorter than 42 chars (0x + 40 hex chars)
      for (const entry of Object.values(body.defaultTokens) as Array<{
        from: string;
        to: string;
      }>) {
        expect(entry.from.length).toBe(42);
        expect(entry.to.length).toBe(42);
      }
    });
  });

  // Additional API endpoint smoke tests
  it("GET /analytics returns 200 with JSON", async () => {
    const res = await request(`${baseUrl}/analytics`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("GET /errors returns 200 with JSON", async () => {
    const res = await request(`${baseUrl}/errors`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("GET /config returns both defaultTokens and walletConnectProjectId (API config contract)", async () => {
    const res = await request(`${baseUrl}/config`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.defaultTokens).toBeDefined();
    expect(body.walletConnectProjectId).toBeDefined();
  });
});
