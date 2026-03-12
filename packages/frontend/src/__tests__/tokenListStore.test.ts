import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  tokenListStore,
  DEFAULT_TOKENLIST_NAME,
  LOCAL_TOKENS_SOURCE_NAME,
  type Token,
} from "../lib/stores/tokenListStore.svelte.js";

// ---------------------------------------------------------------------------
// Mock API client
// ---------------------------------------------------------------------------

const mockUSDC: Token = {
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  chainId: 1,
  name: "USD Coin",
  symbol: "USDC",
  decimals: 6,
};

const mockDAI: Token = {
  address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  chainId: 1,
  name: "Dai Stablecoin",
  symbol: "DAI",
  decimals: 18,
};

const mockBaseUSDC: Token = {
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  chainId: 8453,
  name: "USD Coin",
  symbol: "USDC",
  decimals: 6,
};

let mockGetImpl: (path: string, options?: unknown) => Promise<{ data?: unknown; error?: unknown }>;

vi.mock("../lib/api.js", () => ({
  apiClient: {
    GET: vi.fn((...args: unknown[]) => mockGetImpl(args[0] as string, args[1])),
  },
}));

// ---------------------------------------------------------------------------
// Helper: reset store state between tests
// ---------------------------------------------------------------------------

function resetStore(): void {
  tokenListStore.lists = [];
  tokenListStore.localTokens = [];
  tokenListStore.localTokensEnabled = true;
  tokenListStore.unrecognizedModal = null;
  (tokenListStore as unknown as { initialized: boolean; isInitializing: boolean }).initialized =
    false;
  (tokenListStore as unknown as { initialized: boolean; isInitializing: boolean }).isInitializing =
    false;
}

function makeDefaultGET(): typeof mockGetImpl {
  return async (path: string) => {
    if (path === "/tokenlist") {
      return {
        data: {
          name: DEFAULT_TOKENLIST_NAME,
          tokenlists: [
            {
              name: DEFAULT_TOKENLIST_NAME,
              tokens: [mockUSDC, mockDAI],
            },
          ],
          tokens: [mockUSDC, mockDAI],
        },
      };
    }
    return { error: { error: "Not found" } };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("tokenListStore", () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
    vi.clearAllMocks();
    mockGetImpl = makeDefaultGET();
  });

  afterEach(() => {
    resetStore();
    localStorage.clear();
  });

  // -------------------------------------------------------------------------
  // Init / default list
  // -------------------------------------------------------------------------

  it("loads default tokenlist on init()", async () => {
    await tokenListStore.init();

    expect(tokenListStore.lists.length).toBeGreaterThan(0);
    const defaultList = tokenListStore.lists.find((l) => l.url === null);
    expect(defaultList).toBeDefined();
    expect(defaultList!.name).toBe(DEFAULT_TOKENLIST_NAME);
    expect(defaultList!.tokens.length).toBe(2);
    expect(defaultList!.enabled).toBe(true);
  });

  it("keeps default tokenlist present after failed API call", async () => {
    mockGetImpl = async () => ({ error: { error: "Server error" } });

    await tokenListStore.init();

    expect(tokenListStore.lists).toContainEqual({
      url: null,
      name: "Built-in Tokenlist",
      enabled: true,
      tokens: [],
    });
  });

  it("keeps default tokenlist present with empty localStorage", async () => {
    localStorage.removeItem("customTokenlists");
    mockGetImpl = async () => ({ data: undefined });

    await tokenListStore.init();

    expect(tokenListStore.lists).toContainEqual({
      url: null,
      name: "Built-in Tokenlist",
      enabled: true,
      tokens: [],
    });
  });

  it("allTokens contains tokens from enabled default list", async () => {
    await tokenListStore.init();

    const addresses = tokenListStore.allTokens.map((t) => t.address);
    expect(addresses).toContain(mockUSDC.address);
    expect(addresses).toContain(mockDAI.address);
  });

  it("allTokens is empty when no lists loaded", () => {
    expect(tokenListStore.allTokens).toHaveLength(0);
  });

  it("handles API error gracefully on init()", async () => {
    mockGetImpl = async () => ({ error: { error: "Server error" } });
    // Should not throw
    await expect(tokenListStore.init()).resolves.not.toThrow();
    expect(tokenListStore.lists).toHaveLength(1);
    expect(tokenListStore.lists[0]).toMatchObject({
      url: null,
      name: "Built-in Tokenlist",
      enabled: true,
      tokens: [],
    });
  });

  it("init() is idempotent — only runs once", async () => {
    await tokenListStore.init();
    await tokenListStore.init();

    // Should only have one default list entry
    const defaults = tokenListStore.lists.filter((l) => l.url === null);
    expect(defaults.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // addList — URL validation
  // -------------------------------------------------------------------------

  it("rejects empty URL", async () => {
    const err = await tokenListStore.addList("");
    expect(err).toBeTruthy();
    expect(err).toMatch(/url/i);
  });

  it("rejects invalid URL format", async () => {
    const err = await tokenListStore.addList("not-a-url");
    expect(err).toBeTruthy();
    expect(err).toMatch(/invalid url/i);
  });

  it("rejects http:// URL (must use HTTPS)", async () => {
    const err = await tokenListStore.addList("http://example.com/tokens.json");
    expect(err).toBeTruthy();
    expect(err).toMatch(/https/i);
  });

  it("accepts https:// URL and fetches tokenlist", async () => {
    mockGetImpl = async (path: string) => {
      if (path === "/tokenlist") return makeDefaultGET()("/tokenlist");
      if (path === "/tokenlist/proxy") {
        return {
          data: {
            name: "Custom List",
            tokens: [mockBaseUSDC],
          },
        };
      }
      return { error: { error: "Not found" } };
    };

    const err = await tokenListStore.addList("https://example.com/tokens.json");
    expect(err).toBeNull();
    expect(tokenListStore.lists.some((l) => l.name === "Custom List")).toBe(true);
  });

  it("rejects duplicate URL", async () => {
    mockGetImpl = async (path: string) => {
      if (path === "/tokenlist") return makeDefaultGET()("/tokenlist");
      if (path === "/tokenlist/proxy") {
        return { data: { name: "List A", tokens: [mockBaseUSDC] } };
      }
      return { error: { error: "Not found" } };
    };

    await tokenListStore.addList("https://example.com/tokens.json");
    const err = await tokenListStore.addList("https://example.com/tokens.json");
    expect(err).toBeTruthy();
    expect(err).toMatch(/already added/i);
  });

  it("rejects duplicate by name", async () => {
    mockGetImpl = async (path: string) => {
      if (path === "/tokenlist") return makeDefaultGET()("/tokenlist");
      if (path === "/tokenlist/proxy") {
        return { data: { name: DEFAULT_TOKENLIST_NAME, tokens: [mockBaseUSDC] } };
      }
      return { error: { error: "Not found" } };
    };

    await tokenListStore.init();
    const err = await tokenListStore.addList("https://example.com/tokens.json");
    expect(err).toBeTruthy();
    expect(err).toMatch(/already loaded/i);
  });

  // -------------------------------------------------------------------------
  // toggleList / removeList
  // -------------------------------------------------------------------------

  it("toggle list off removes its tokens from allTokens", async () => {
    await tokenListStore.init();

    const before = tokenListStore.allTokens.length;
    tokenListStore.toggleList(null); // disable default list

    expect(tokenListStore.allTokens.length).toBeLessThan(before);
  });

  it("toggle list back on restores tokens", async () => {
    await tokenListStore.init();

    const before = tokenListStore.allTokens.length;
    tokenListStore.toggleList(null);
    tokenListStore.toggleList(null);

    expect(tokenListStore.allTokens.length).toBe(before);
  });

  it("removeList removes from lists array and saves to localStorage", async () => {
    mockGetImpl = async (path: string) => {
      if (path === "/tokenlist") return makeDefaultGET()("/tokenlist");
      if (path === "/tokenlist/proxy") {
        return { data: { name: "Custom List", tokens: [mockBaseUSDC] } };
      }
      return { error: { error: "Not found" } };
    };

    await tokenListStore.addList("https://example.com/tokens.json");
    expect(tokenListStore.lists.some((l) => l.url === "https://example.com/tokens.json")).toBe(
      true
    );

    tokenListStore.removeList("https://example.com/tokens.json");
    expect(tokenListStore.lists.some((l) => l.url === "https://example.com/tokens.json")).toBe(
      false
    );

    // Verify localStorage no longer has this URL
    const stored = JSON.parse(localStorage.getItem("customTokenlists") ?? "[]") as {
      url: string;
    }[];
    expect(stored.some((s) => s.url === "https://example.com/tokens.json")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------

  it("deduplicates tokens with same address+chainId across lists", () => {
    // Manually add two lists with the same token
    tokenListStore.lists = [
      {
        url: null,
        name: "List A",
        enabled: true,
        tokens: [{ ...mockUSDC, _source: "List A" }],
      },
      {
        url: "https://b.example.com/tokens.json",
        name: "List B",
        enabled: true,
        tokens: [{ ...mockUSDC, _source: "List B" }, mockDAI],
      },
    ];

    const addrs = tokenListStore.allTokens.map((t) => t.address);
    const usdcCount = addrs.filter((a) => a === mockUSDC.address).length;
    expect(usdcCount).toBe(1); // deduplicated
    expect(addrs).toContain(mockDAI.address);
  });

  it("does not deduplicate tokens with same address but different chainId", () => {
    // USDC on Ethereum and USDC on Base have different addresses (different token),
    // but test same address different chainId logic
    const tokenA: Token = { ...mockUSDC, chainId: 1 };
    const tokenB: Token = { ...mockUSDC, chainId: 8453 }; // same address, different chain

    tokenListStore.lists = [{ url: null, name: "List", enabled: true, tokens: [tokenA, tokenB] }];

    expect(tokenListStore.allTokens.length).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Local tokens add/remove
  // -------------------------------------------------------------------------

  it("addLocalToken adds to localTokens and persists to localStorage", () => {
    tokenListStore.addLocalToken(mockUSDC);

    expect(tokenListStore.localTokens).toHaveLength(1);
    expect(tokenListStore.localTokens[0]!.address).toBe(mockUSDC.address);
    expect(tokenListStore.localTokens[0]!._source).toBe(LOCAL_TOKENS_SOURCE_NAME);

    const stored = JSON.parse(localStorage.getItem("localTokenList") ?? "{}") as {
      tokens?: unknown[];
    };
    expect(stored.tokens).toHaveLength(1);
  });

  it("addLocalToken deduplicates by address+chainId", () => {
    tokenListStore.addLocalToken(mockUSDC);
    tokenListStore.addLocalToken(mockUSDC); // duplicate

    expect(tokenListStore.localTokens).toHaveLength(1);
  });

  it("removeLocalToken removes token by address+chainId", () => {
    tokenListStore.addLocalToken(mockUSDC);
    tokenListStore.addLocalToken(mockDAI);
    tokenListStore.removeLocalToken(mockUSDC.address, mockUSDC.chainId);

    expect(tokenListStore.localTokens).toHaveLength(1);
    expect(tokenListStore.localTokens[0]!.symbol).toBe("DAI");
  });

  it("local tokens appear in allTokens when localTokensEnabled", () => {
    tokenListStore.localTokens = [mockUSDC];
    tokenListStore.localTokensEnabled = true;

    expect(tokenListStore.allTokens.some((t) => t.address === mockUSDC.address)).toBe(true);
  });

  it("local tokens excluded from allTokens when localTokensEnabled is false", () => {
    tokenListStore.localTokens = [mockUSDC];
    tokenListStore.localTokensEnabled = false;

    expect(tokenListStore.allTokens.some((t) => t.address === mockUSDC.address)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // loadLocalTokens — localStorage restore
  // -------------------------------------------------------------------------

  it("loadLocalTokens restores from localStorage", () => {
    const payload = {
      tokens: [
        {
          chainId: mockUSDC.chainId,
          address: mockUSDC.address,
          name: mockUSDC.name,
          symbol: mockUSDC.symbol,
          decimals: mockUSDC.decimals,
        },
      ],
    };
    localStorage.setItem("localTokenList", JSON.stringify(payload));

    tokenListStore.loadLocalTokens();

    expect(tokenListStore.localTokens).toHaveLength(1);
    expect(tokenListStore.localTokens[0]!.address).toBe(mockUSDC.address);
  });

  it("loadLocalTokens handles corrupt localStorage gracefully", () => {
    localStorage.setItem("localTokenList", "NOT JSON");
    expect(() => tokenListStore.loadLocalTokens()).not.toThrow();
    expect(tokenListStore.localTokens).toHaveLength(0);
  });

  it("loadLocalTokens restores localTokensEnabled=false from localStorage", () => {
    localStorage.setItem("localTokensEnabled", "false");
    tokenListStore.loadLocalTokens();
    expect(tokenListStore.localTokensEnabled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  it("exportLocalTokens returns empty string when no tokens", () => {
    expect(tokenListStore.exportLocalTokens()).toBe("");
  });

  it("exportLocalTokens returns valid JSON with tokens array", () => {
    tokenListStore.localTokens = [mockUSDC];
    const json = tokenListStore.exportLocalTokens();
    expect(json).toBeTruthy();

    const parsed = JSON.parse(json) as { tokens?: unknown[]; name?: string };
    expect(Array.isArray(parsed.tokens)).toBe(true);
    expect(parsed.tokens!).toHaveLength(1);
    expect(parsed.name).toBeTruthy();
  });

  it("exported JSON never truncates addresses", () => {
    tokenListStore.localTokens = [mockUSDC];
    const json = tokenListStore.exportLocalTokens();
    expect(json).toContain(mockUSDC.address);
    expect(json).not.toMatch(/0x[0-9a-fA-F]{4}\.{3}[0-9a-fA-F]{4}/);
  });

  // -------------------------------------------------------------------------
  // Import
  // -------------------------------------------------------------------------

  it("importLocalTokens merges valid tokens", () => {
    const json = JSON.stringify({
      name: "Test List",
      tokens: [
        {
          chainId: mockDAI.chainId,
          address: mockDAI.address,
          name: mockDAI.name,
          symbol: mockDAI.symbol,
          decimals: mockDAI.decimals,
        },
      ],
    });

    const result = tokenListStore.importLocalTokens(json);
    expect("count" in result).toBe(true);
    if ("count" in result) expect(result.count).toBe(1);
    expect(tokenListStore.localTokens).toHaveLength(1);
  });

  it("importLocalTokens returns error for invalid JSON", () => {
    const result = tokenListStore.importLocalTokens("NOT JSON");
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/json/i);
  });

  it("importLocalTokens returns error when tokens array is missing", () => {
    const result = tokenListStore.importLocalTokens(JSON.stringify({ name: "Empty" }));
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/tokens array/i);
  });

  it("importLocalTokens returns error for empty tokens array", () => {
    const result = tokenListStore.importLocalTokens(JSON.stringify({ tokens: [] }));
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/no tokens/i);
  });

  it("importLocalTokens deduplicates on merge", () => {
    tokenListStore.localTokens = [{ ...mockUSDC, _source: LOCAL_TOKENS_SOURCE_NAME }];

    const json = JSON.stringify({
      tokens: [
        {
          chainId: mockUSDC.chainId,
          address: mockUSDC.address,
          name: mockUSDC.name,
          symbol: mockUSDC.symbol,
          decimals: mockUSDC.decimals,
        },
        {
          chainId: mockDAI.chainId,
          address: mockDAI.address,
          name: mockDAI.name,
          symbol: mockDAI.symbol,
          decimals: mockDAI.decimals,
        },
      ],
    });

    const result = tokenListStore.importLocalTokens(json);
    expect("count" in result).toBe(true);
    if ("count" in result) expect(result.count).toBe(1); // only DAI added (USDC is duplicate)
    expect(tokenListStore.localTokens).toHaveLength(2);
  });

  it("importLocalTokens returns error for no valid tokens in file", () => {
    const json = JSON.stringify({
      tokens: [{ badField: "bad" }],
    });
    const result = tokenListStore.importLocalTokens(json);
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/no valid tokens/i);
  });

  it("importLocalTokens persists to localStorage", () => {
    const json = JSON.stringify({
      tokens: [
        {
          chainId: mockDAI.chainId,
          address: mockDAI.address,
          name: mockDAI.name,
          symbol: mockDAI.symbol,
          decimals: mockDAI.decimals,
        },
      ],
    });

    tokenListStore.importLocalTokens(json);

    const stored = JSON.parse(localStorage.getItem("localTokenList") ?? "{}") as {
      tokens?: unknown[];
    };
    expect(stored.tokens).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // findToken
  // -------------------------------------------------------------------------

  it("findToken returns matching token by address+chainId", async () => {
    await tokenListStore.init();

    const found = tokenListStore.findToken(mockUSDC.address, 1);
    expect(found).toBeDefined();
    expect(found!.symbol).toBe("USDC");
  });

  it("findToken returns undefined for unknown address", async () => {
    await tokenListStore.init();

    const found = tokenListStore.findToken("0x0000000000000000000000000000000000000001", 1);
    expect(found).toBeUndefined();
  });

  it("findToken is case-insensitive for address", async () => {
    await tokenListStore.init();

    const found = tokenListStore.findToken(mockUSDC.address.toLowerCase(), 1);
    expect(found).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Persistence: custom lists saved to localStorage
  // -------------------------------------------------------------------------

  it("addList persists custom list URL to localStorage", async () => {
    mockGetImpl = async (path: string) => {
      if (path === "/tokenlist") return makeDefaultGET()("/tokenlist");
      if (path === "/tokenlist/proxy") {
        return { data: { name: "My List", tokens: [mockBaseUSDC] } };
      }
      return { error: { error: "Not found" } };
    };

    await tokenListStore.addList("https://custom.example.com/list.json");

    const stored = JSON.parse(localStorage.getItem("customTokenlists") ?? "[]") as {
      url: string;
    }[];
    expect(stored.some((s) => s.url === "https://custom.example.com/list.json")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // localStorage write failure
  // -------------------------------------------------------------------------

  it("handles localStorage write failure gracefully", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    expect(() => tokenListStore.addLocalToken(mockUSDC)).not.toThrow();
    setItemSpy.mockRestore();
  });
});
