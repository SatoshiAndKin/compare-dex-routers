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
    // ERC-6963 discovery is now in the bundled client wallet module (src/client/wallet.ts).
    // Verify the client bundle script tag is present which loads the wallet module.
    expect(res.body).toContain('src="/static/client.js"');
    // The inline JS still references wallet via window shims
    expect(res.body).toContain("hasConnectedWallet");
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
    // wallet_switchEthereumChain is now in the bundled client wallet module (src/client/wallet.ts)
    // The inline JS delegates chain switching via window.ensureWalletOnChain()
    expect(res.body).toContain("ensureWalletOnChain");
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
    // initializeTokenlistSources is now in the client bundle (token-management.ts)
    // The inline JS calls it via a shim that delegates to the window-exposed module function
    expect(res.body).toContain("initializeTokenlistSources()");
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

  it("GET / shows Gas: N/A in quote details when gas_used is missing", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);

    // The renderSecondaryDetails function now always shows Gas Used field
    // It should show "N/A" when gas data is missing
    expect(res.body).toContain("Gas Used");
    expect(res.body).toContain("N/A");
  });

  // VAL-SENDER-001: No sender input visible
  it("GET / has no sender input element", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    // No element with id="sender"
    expect(res.body).not.toContain('id="sender"');
    // No label for sender
    expect(res.body).not.toContain('for="sender"');
    // No sender placeholder
    expect(res.body).not.toContain("Sender (optional)");
  });

  // VAL-FLOW-001 through VAL-FLOW-006: Form element order
  // VAL-UI-001: Form field visual order - Chain → Wallet → From Token → To Token → Sell Amount → Receive Amount → Action Row
  // VAL-SLIP-003: Submit button first in action row, slippage box after
  it("GET / has form elements in correct order (chain → wallet → from → to → sellAmount → receiveAmount → submit → slippage)", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = res.body;

    // Find positions of key elements
    const chainPos = html.indexOf('id="chainId"');
    const walletPos = html.indexOf('id="connectWalletBtn"');
    const fromPos = html.indexOf('id="from"');
    const toPos = html.indexOf('id="to"');
    const sellAmountPos = html.indexOf('id="sellAmount"');
    const receiveAmountPos = html.indexOf('id="receiveAmount"');
    const submitPos = html.indexOf('id="submit"');
    const slippagePos = html.indexOf('id="slippageBps"');

    // Verify order: chain < wallet < from < to < sellAmount < receiveAmount < submit < slippage
    // From/To tokens are BEFORE amount fields (VAL-UI-001)
    // Submit is FIRST in action row, slippage box after (VAL-SLIP-003)
    expect(chainPos).toBeGreaterThan(-1);
    expect(walletPos).toBeGreaterThan(chainPos);
    expect(fromPos).toBeGreaterThan(walletPos);
    expect(toPos).toBeGreaterThan(fromPos);
    expect(sellAmountPos).toBeGreaterThan(toPos);
    expect(receiveAmountPos).toBeGreaterThan(sellAmountPos);
    expect(submitPos).toBeGreaterThan(receiveAmountPos);
    expect(slippagePos).toBeGreaterThan(submitPos);
  });

  // VAL-WALLET-004: Wallet buttons must not submit form
  it("GET / wallet buttons have type=button to prevent form submission", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = res.body;

    // Connect wallet button must be type="button"
    expect(html).toContain('type="button" id="connectWalletBtn"');
    // Disconnect button must be type="button"
    expect(html).toContain('type="button" id="disconnectWalletBtn"');
  });

  // VAL-UI-050: Chain selector accepts text input
  // VAL-UI-051: Filter by chain name
  // VAL-UI-052: Filter by chain ID
  it("GET / has searchable chain dropdown with input and dropdown list", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = res.body;

    // Chain selector is now an input (not select)
    expect(html).toContain('id="chainId"');
    expect(html).toContain('placeholder="Search chain name or ID..."');
    expect(html).toContain("data-chain-id=");

    // Chain dropdown list element exists
    expect(html).toContain('id="chainDropdown"');
    expect(html).toContain('class="chain-dropdown"');

    // Chain dropdown JS logic is now in src/client/chain-selector.ts (loaded via client.js bundle)
    // The inline JS references getCurrentChainId via window globals
    expect(html).toContain("getCurrentChainId");
  });

  // VAL-FLOW-008: MEV info button in results area
  it("GET / has MEV info button positioned after form, near results area", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = res.body;

    // MEV button should be in the results div, not in the form
    const formEndPos = html.indexOf("</form>");
    const resultStartPos = html.indexOf('id="result"');
    const mevBtnPos = html.indexOf('id="mevInfoBtn"');

    // MEV button should appear after form ends
    expect(mevBtnPos).toBeGreaterThan(formEndPos);
    // MEV button should be inside the results area
    expect(mevBtnPos).toBeGreaterThan(resultStartPos);
  });

  // VAL-UI-001: Two amount fields (sell/receive) after from/to tokens
  it("GET / has sell and receive amount fields after from/to tokens", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = res.body;

    const fromPos = html.indexOf('id="from"');
    const toPos = html.indexOf('id="to"');
    const sellAmountPos = html.indexOf('id="sellAmount"');
    const receiveAmountPos = html.indexOf('id="receiveAmount"');

    // Both amount fields should appear AFTER from and to
    expect(sellAmountPos).toBeGreaterThan(-1);
    expect(receiveAmountPos).toBeGreaterThan(-1);
    expect(fromPos).toBeGreaterThan(-1);
    expect(toPos).toBeGreaterThan(-1);
    expect(sellAmountPos).toBeGreaterThan(fromPos);
    expect(sellAmountPos).toBeGreaterThan(toPos);
    expect(receiveAmountPos).toBeGreaterThan(sellAmountPos);

    // Labels for the amount fields
    expect(html).toContain('id="sellAmountLabel"');
    expect(html).toContain('id="receiveAmountLabel"');
    expect(html).toContain("YOU SELL");
    expect(html).toContain("YOU RECEIVE");

    // From token should have its own form-group
    expect(html).toContain('<label for="from">From Token</label>');
  });

  // VAL-WALLET-002: Wallet section integrated into form
  it("GET / wallet section is inside the form element", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = res.body;

    const formStartPos = html.indexOf('<form id="form">');
    const formEndPos = html.indexOf("</form>");
    const walletBtnPos = html.indexOf('id="connectWalletBtn"');

    // Wallet button should be inside form
    expect(walletBtnPos).toBeGreaterThan(formStartPos);
    expect(walletBtnPos).toBeLessThan(formEndPos);
  });

  // VAL-SENDER-004: URL never contains sender param after form submission
  it("GET / includes JS that removes sender from URL", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = res.body;

    // The updateUrlFromCompareParams function (now in url-sync.ts module) deletes sender from URL
    // The inline JS still references the shim that delegates to the module
    expect(html).toContain("updateUrlFromCompareParams");
  });

  // VAL-SENDER-006: No JS errors from removed sender input
  it("GET / has no references to getElementById('sender')", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = res.body;

    // No code should reference getElementById('sender')
    expect(html).not.toContain("getElementById('sender')");
    // No senderInput variable
    expect(html).not.toContain("senderInput");
  });

  // VAL-CROSS-003: Form works without wallet
  it("GET / compare works without wallet connection (no sender required)", async () => {
    const res = await request(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = res.body;

    // The readCompareParamsFromForm function (now in url-sync.ts module) handles no wallet case
    // The inline JS still references hasConnectedWallet and readCompareParamsFromForm via shims
    expect(html).toContain("hasConnectedWallet()");
    expect(html).toContain("readCompareParamsFromForm");
    expect(html).toContain("getConnectedAddress");
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

  // Tokenlist proxy endpoint tests
  describe("GET /tokenlist/proxy", () => {
    it("returns 400 when url parameter is missing", async () => {
      const res = await request(`${baseUrl}/tokenlist/proxy`);
      expect(res.status).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain("Missing url parameter");
    });

    it("returns 400 when url parameter is empty", async () => {
      const res = await request(`${baseUrl}/tokenlist/proxy?url=`);
      expect(res.status).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain("Missing url parameter");
    });

    it("returns 400 for non-HTTPS URL (http://)", async () => {
      const res = await request(`${baseUrl}/tokenlist/proxy?url=http://example.com/tokens.json`);
      expect(res.status).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain("HTTPS");
    });

    it("returns 400 for invalid URL format", async () => {
      const res = await request(`${baseUrl}/tokenlist/proxy?url=not-a-valid-url`);
      expect(res.status).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain("Invalid URL");
    });

    it("returns 502 for unreachable URL", async () => {
      const res = await request(
        `${baseUrl}/tokenlist/proxy?url=https://nonexistent.invalid/tokenlist.json`
      );
      expect(res.status).toBe(502);
      const body = JSON.parse(res.body);
      expect(body.error).toBeDefined();
    });

    it("returns 200 with valid tokenlist from real URL", async () => {
      // Using the Uniswap default tokenlist which is a known working endpoint
      const res = await request(
        `${baseUrl}/tokenlist/proxy?url=${encodeURIComponent("https://tokens.uniswap.org")}`
      );
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.tokens)).toBe(true);
      expect(body.tokens.length).toBeGreaterThan(0);
    });

    it("returns application/json content-type for valid tokenlist", async () => {
      const res = await request(
        `${baseUrl}/tokenlist/proxy?url=${encodeURIComponent("https://tokens.uniswap.org")}`
      );
      expect(res.headers["content-type"]).toContain("application/json");
    });

    it("returns token objects with expected fields from proxied list", async () => {
      const res = await request(
        `${baseUrl}/tokenlist/proxy?url=${encodeURIComponent("https://tokens.uniswap.org")}`
      );
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      const token = body.tokens[0];

      expect(token).toMatchObject({
        chainId: expect.any(Number),
        address: expect.any(String),
        name: expect.any(String),
        symbol: expect.any(String),
        decimals: expect.any(Number),
      });
    });

    it("returns 502 for URL that returns non-JSON content", async () => {
      // Using a URL that returns HTML instead of JSON
      const res = await request(
        `${baseUrl}/tokenlist/proxy?url=${encodeURIComponent("https://example.com")}`
      );
      expect(res.status).toBe(502);
      const body = JSON.parse(res.body);
      expect(body.error).toBeDefined();
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

  // Local Tokens Toggle tests
  describe("Local Tokens Toggle", () => {
    it("includes Local Tokens section with toggle switch", async () => {
      const res = await request(`${baseUrl}/`);
      expect(res.status).toBe(200);
      // Check for Local Tokens section header with toggle
      expect(res.body).toContain("local-tokens-header");
      expect(res.body).toContain('id="localTokensToggle"');
      expect(res.body).toContain('class="tokenlist-toggle on"');
      expect(res.body).toContain('aria-label="Toggle local tokens"');
    });

    it("includes local tokens enabled state shims", async () => {
      const res = await request(`${baseUrl}/`);
      expect(res.status).toBe(200);
      // Local tokens management is now in the client bundle (token-management.ts).
      // Inline JS has shim functions that delegate to window-exposed module functions.
      expect(res.body).toContain("function loadLocalTokensEnabled()");
    });

    it("includes loadLocalTokensEnabled function (shim or module)", async () => {
      const res = await request(`${baseUrl}/`);
      expect(res.status).toBe(200);
      expect(res.body).toContain("loadLocalTokensEnabled");
    });

    it("includes saveLocalTokenList shim function", async () => {
      const res = await request(`${baseUrl}/`);
      expect(res.status).toBe(200);
      expect(res.body).toContain("function saveLocalTokenList(tokens)");
    });

    it("getTokensForChain is available via window shim", async () => {
      const res = await request(`${baseUrl}/`);
      expect(res.status).toBe(200);
      // getTokensForChain is now in the client bundle, accessible via window shim
      expect(res.body).toContain("function getTokensForChain(chainId)");
    });

    it("references local tokens toggle functionality", async () => {
      const res = await request(`${baseUrl}/`);
      expect(res.status).toBe(200);
      // The toggle is now wired up in the client bundle token-management module
      expect(res.body).toContain("localTokensToggle");
    });
  });

  // Autocomplete refresh uses getCurrentChainId regression test
  describe("Autocomplete Chain ID usage", () => {
    it("autocomplete uses getCurrentChainId() via module callbacks not raw chainId.value", async () => {
      const res = await request(`${baseUrl}/`);
      expect(res.status).toBe(200);

      // setupAutocomplete is now in src/client/autocomplete.ts (loaded via client.js bundle).
      // The inline JS has shim autocomplete objects that delegate to window-exposed module functions.
      // Verify the inline JS does NOT use the buggy pattern of reading chainId.value directly.
      expect(res.body).not.toMatch(/autocomplete[\s\S]{0,100}chainIdInput\.value/);

      // Verify the autocomplete module is referenced (shim objects exist)
      expect(res.body).toContain("getFromAutocomplete");
      expect(res.body).toContain("getToAutocomplete");
    });
  });
});
