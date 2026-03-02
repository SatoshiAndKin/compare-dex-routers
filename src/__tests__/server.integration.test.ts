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
    delete process.env.TOKENLIST_PATH;
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

  it("GET / returns HTML", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("GET / shows a Connect Wallet button", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('id="connectWalletBtn"');
    expect(res.body).toContain("Connect Wallet");
  });

  it("GET / includes ERC-6963 discovery with provider deduplication by uuid", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("eip6963:announceProvider");
    expect(res.body).toContain("eip6963:requestProvider");
    expect(res.body).toContain("walletProvidersByUuid.has(detail.info.uuid)");
  });

  it("GET / includes no-wallet fallback messaging", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("No wallet detected");
  });

  it("GET / includes approve/swap transaction handlers using EIP-1193 RPC methods", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('data-action="swap"');
    expect(res.body).toContain('data-action="approve"');
    expect(res.body).toContain("eth_sendTransaction");
    expect(res.body).toContain("eth_getTransactionReceipt");
    expect(res.body).toContain("wallet_switchEthereumChain");
  });

  it("GET / wires Curve approval fields into quote actions", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("approvalToken: data.from || ''");
    expect(res.body).toContain("approvalSpender: data.approval_target || ''");
  });

  it("GET / encodes ERC20 approve calldata and shows connect-wallet-first messaging", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("0x095ea7b3");
    expect(res.body).toContain("MAX_UINT256_HEX");
    expect(res.body).toContain("Connect wallet first");
  });

  it("GET / loads autocomplete data from /tokenlist on page load", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("fetch('/tokenlist')");
  });

  it("GET / includes 15-second auto-refresh countdown UI", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('id="refreshIndicator"');
    expect(res.body).toContain("AUTO_REFRESH_SECONDS = 15");
    expect(res.body).toContain("Auto-refresh in ");
  });

  it("GET / preserves result tab and scroll position during refresh re-render", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("captureResultUiState()");
    expect(res.body).toContain("setActiveTab(priorUiState.activeTab)");
    expect(res.body).toContain("window.scrollTo(0, priorUiState.scrollY)");
  });

  it("GET / stops auto-refresh on chain change and pauses around transactions", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("stopAutoRefresh();");
    expect(res.body).toContain("clearResultDisplay();");
    expect(res.body).toContain("pauseAutoRefreshForTransaction();");
    expect(res.body).toContain("resumeAutoRefreshAfterTransaction();");
  });

  it("GET / does not inline built-in token data in HTML", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.body).not.toContain("BUILTIN_TOKENS");
    expect(res.body).not.toContain("spandex_tokenlist");
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
    delete process.env.TOKENLIST_PATH;
    const res = await request(`${baseUrl}/tokenlist`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.tokens)).toBe(true);
    expect(body.tokens.length).toBeGreaterThan(0);
  });

  it("GET /tokenlist returns application/json content-type", async () => {
    delete process.env.TOKENLIST_PATH;
    const res = await request(`${baseUrl}/tokenlist`);
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("GET /tokenlist response has token objects with expected fields", async () => {
    delete process.env.TOKENLIST_PATH;
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
      process.env.TOKENLIST_PATH = tokenlistPath;

      const firstResponse = await request(`${baseUrl}/tokenlist`);
      expect(firstResponse.status).toBe(200);
      expect(JSON.parse(firstResponse.body).tokens[0].name).toBe("Initial Token");

      await writeFile(tokenlistPath, JSON.stringify(updated), "utf8");

      const secondResponse = await request(`${baseUrl}/tokenlist`);
      expect(secondResponse.status).toBe(200);
      expect(JSON.parse(secondResponse.body).tokens[0].name).toBe("Initial Token");
    } finally {
      delete process.env.TOKENLIST_PATH;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("GET /tokenlist returns 500 with descriptive error when file is missing", async () => {
    process.env.TOKENLIST_PATH = join(tmpdir(), `missing-tokenlist-${Date.now()}.json`);

    try {
      const res = await request(`${baseUrl}/tokenlist`);
      expect(res.status).toBe(500);
      expect(res.headers["content-type"]).toContain("application/json");
      const body = JSON.parse(res.body);
      expect(body.error).toContain("Failed to load tokenlist");
    } finally {
      delete process.env.TOKENLIST_PATH;
    }
  });

  it("GET / shows Gas: N/A in quote details when gas_used is missing", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);

    // The renderSecondaryDetails function now always shows Gas Used field
    // It should show "N/A" when gas data is missing
    expect(res.body).toContain("Gas Used");
    expect(res.body).toContain("N/A");
  });
});
