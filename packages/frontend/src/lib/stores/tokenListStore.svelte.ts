/**
 * Token list store — manages multiple token lists (default + custom), local tokens,
 * deduplication, export/import, and the unrecognized-token modal state.
 *
 * Ported from src/client/token-management.ts for Svelte 5.
 */

import { apiClient } from "../api.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CUSTOM_TOKENLISTS_KEY = "customTokenlists";
const LOCAL_TOKEN_LIST_KEY = "localTokenList";
const LOCAL_TOKENS_ENABLED_KEY = "localTokensEnabled";
const DEFAULT_TOKENLIST_ENABLED_KEY = "defaultTokenlistEnabled";

export const DEFAULT_TOKENLIST_NAME = "Default Tokenlist";
export const LOCAL_TOKENS_SOURCE_NAME = "Local Tokens";
export const DEFAULT_UNISWAP_URL = "https://tokens.uniswap.org";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Token {
  address: string;
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  _source?: string;
}

export interface TokenListEntry {
  /** null for the built-in default list */
  url: string | null;
  name: string;
  enabled: boolean;
  tokens: Token[];
  error?: string;
}

interface PersistedList {
  url: string;
  enabled: boolean;
  name: string;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

class TokenListStore {
  lists = $state<TokenListEntry[]>([]);
  localTokens = $state<Token[]>([]);
  localTokensEnabled = $state(true);
  isInitializing = $state(false);
  private initialized = false;

  /** Modal state for unrecognized-token detection */
  unrecognizedModal = $state<{
    address: string;
    chainId: number;
    targetType: "from" | "to";
  } | null>(null);

  /**
   * All tokens from all enabled lists + local tokens (when enabled),
   * deduplicated by address+chainId.
   */
  allTokens = $derived.by(() => {
    const seen = new Set<string>();
    const result: Token[] = [];

    for (const list of this.lists) {
      if (!list.enabled) continue;
      for (const token of list.tokens) {
        if (!token.address) continue;
        const key = `${token.address.toLowerCase()}_${Number(token.chainId)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(token);
      }
    }

    if (this.localTokensEnabled) {
      for (const token of this.localTokens) {
        if (!token.address) continue;
        const key = `${token.address.toLowerCase()}_${Number(token.chainId)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(token);
      }
    }

    return result;
  });

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  /**
   * Initialize the store: load default tokenlist from API, then restore
   * any saved custom lists from localStorage.
   */
  async init(): Promise<void> {
    if (this.initialized || this.isInitializing) return;
    this.isInitializing = true;

    try {
      // 1. Load default list(s) from server
      await this._loadDefaultLists();

      // 2. Restore custom lists from localStorage (migrate old format if needed)
      await this._restoreCustomLists();

      // 3. Auto-add Uniswap default tokenlist if not already present
      await this._ensureUniswapList();

      this.initialized = true;
    } finally {
      this.isInitializing = false;
    }
  }

  private async _loadDefaultLists(): Promise<void> {
    let defaultEnabled = true;
    try {
      const stored = localStorage.getItem(DEFAULT_TOKENLIST_ENABLED_KEY);
      if (stored !== null) defaultEnabled = stored === "true";
    } catch {
      // ignore
    }

    try {
      const { data } = await apiClient.GET("/tokenlist");
      if (data) {
        const tokenlists = data.tokenlists ?? [];

        if (tokenlists.length > 0) {
          for (const entry of tokenlists) {
            const name = entry.name ?? DEFAULT_TOKENLIST_NAME;
            const tokens: Token[] = (entry.tokens ?? []).map((t) => ({
              address: t.address ?? "",
              chainId: t.chainId ?? 0,
              name: t.name ?? "",
              symbol: t.symbol ?? "",
              decimals: t.decimals ?? 18,
              logoURI: t.logoURI,
              _source: name,
            }));
            this.lists = [...this.lists, { url: null, name, enabled: defaultEnabled, tokens }];
          }
        } else if (data.tokens && data.tokens.length > 0) {
          // Fallback: old flat response format
          const name = data.name ?? DEFAULT_TOKENLIST_NAME;
          const tokens: Token[] = data.tokens.map((t) => ({
            address: t.address ?? "",
            chainId: t.chainId ?? 0,
            name: t.name ?? "",
            symbol: t.symbol ?? "",
            decimals: t.decimals ?? 18,
            logoURI: t.logoURI,
            _source: name,
          }));
          this.lists = [...this.lists, { url: null, name, enabled: defaultEnabled, tokens }];
        }
      }
    } catch {
      // Network error — default list stays empty
    }

    this._ensureDefaultList(defaultEnabled);
  }

  _ensureDefaultList(defaultEnabled: boolean): void {
    const hasDefaultList = this.lists.some((list) => list.url === null);
    if (hasDefaultList) return;

    this.lists = [
      ...this.lists,
      {
        url: null,
        name: "Built-in Tokenlist",
        enabled: defaultEnabled,
        tokens: [],
      },
    ];
  }

  private async _ensureUniswapList(): Promise<void> {
    const normalizedUniswap = this._normalizeUrl(DEFAULT_UNISWAP_URL);
    const alreadyPresent = this.lists.some(
      (l) => l.url && this._normalizeUrl(l.url) === normalizedUniswap
    );
    if (alreadyPresent) return;

    try {
      const { tokens, name } = await this._fetchCustomList(DEFAULT_UNISWAP_URL);
      this.lists = [...this.lists, { url: DEFAULT_UNISWAP_URL, name, enabled: true, tokens }];
      this._saveCustomLists();
    } catch {
      // Network error — skip, will retry next init
    }
  }

  private async _restoreCustomLists(): Promise<void> {
    // Migrate old single-URL format
    let saved: PersistedList[] | null = this._migrateOldUrl();
    if (!saved) saved = this._loadPersistedCustomLists();
    if (!saved || saved.length === 0) return;

    // Collect default list names to avoid duplicates
    const defaultNames = new Set(this.lists.map((l) => (l.name ?? "").trim().toLowerCase()));

    const loadPromises = saved.map(async (item) => {
      // Skip if name already matches a default
      const nameNorm = (item.name ?? "").trim().toLowerCase();
      if (nameNorm && defaultNames.has(nameNorm)) return;

      const idx = this.lists.length;
      this.lists = [
        ...this.lists,
        {
          url: item.url,
          name: item.name ?? item.url,
          enabled: item.enabled !== false,
          tokens: [],
        },
      ];

      try {
        const { tokens, name } = await this._fetchCustomList(item.url);
        // Post-fetch dedup check
        const fetchedNameNorm = (name ?? "").trim().toLowerCase();
        if (defaultNames.has(fetchedNameNorm)) {
          // Remove this duplicate entry
          this.lists = this.lists.filter((_, i) => i !== idx);
          return;
        }
        const updated = [...this.lists];
        const entry = updated[idx];
        if (entry) {
          updated[idx] = { ...entry, tokens, name };
          this.lists = updated;
        }
      } catch (err) {
        const updated = [...this.lists];
        const entry = updated[idx];
        if (entry) {
          const msg = err instanceof Error ? err.message : String(err);
          updated[idx] = { ...entry, error: msg, tokens: [] };
          this.lists = updated;
        }
      }
    });

    await Promise.all(loadPromises);
  }

  private _migrateOldUrl(): PersistedList[] | null {
    try {
      const oldUrl = localStorage.getItem("customTokenlistUrl");
      if (oldUrl) {
        const newList: PersistedList[] = [{ url: oldUrl, enabled: true, name: oldUrl }];
        localStorage.setItem(CUSTOM_TOKENLISTS_KEY, JSON.stringify(newList));
        localStorage.removeItem("customTokenlistUrl");
        return newList;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private _loadPersistedCustomLists(): PersistedList[] | null {
    try {
      const raw = localStorage.getItem(CUSTOM_TOKENLISTS_KEY);
      if (raw) return JSON.parse(raw) as PersistedList[];
    } catch {
      // corrupt data
    }
    return null;
  }

  private async _fetchCustomList(url: string): Promise<{ tokens: Token[]; name: string }> {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch tokenlist: HTTP ${response.status}`);
    }

    const data = (await response.json()) as { name?: string; tokens?: Record<string, unknown>[] };

    if (!data || !Array.isArray(data.tokens)) {
      throw new Error("Invalid tokenlist: missing tokens array");
    }

    const name = data.name ?? url;
    const tokens: Token[] = data.tokens.map((t) => ({
      address: (t.address as string) ?? "",
      chainId: (t.chainId as number) ?? 0,
      name: (t.name as string) ?? "",
      symbol: (t.symbol as string) ?? "",
      decimals: (t.decimals as number) ?? 18,
      logoURI: t.logoURI as string | undefined,
      _source: name,
    }));

    return { tokens, name };
  }

  // -------------------------------------------------------------------------
  // List management
  // -------------------------------------------------------------------------

  /**
   * Add a new tokenlist by URL. Returns an error string on failure.
   */
  async addList(url: string): Promise<string | null> {
    const trimmed = url.trim();
    if (!trimmed) return "Enter a tokenlist URL";

    try {
      new URL(trimmed);
    } catch {
      return "Invalid URL format";
    }

    if (!trimmed.toLowerCase().startsWith("https://")) {
      return "URL must use HTTPS";
    }

    // Check for duplicate URL
    const normalizedNew = this._normalizeUrl(trimmed);
    const isDuplicateUrl = this.lists.some(
      (l) => l.url && this._normalizeUrl(l.url) === normalizedNew
    );
    if (isDuplicateUrl) return "This tokenlist is already added";

    try {
      const { tokens, name } = await this._fetchCustomList(trimmed);

      // Check for duplicate by name
      const nameNorm = (name ?? "").trim().toLowerCase();
      const isDuplicateName = this.lists.some(
        (l) => (l.name ?? "").trim().toLowerCase() === nameNorm
      );
      if (isDuplicateName) return `This tokenlist is already loaded ("${name}")`;

      this.lists = [...this.lists, { url: trimmed, name, enabled: true, tokens }];
      this._saveCustomLists();
      return null; // success
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  /** Remove a custom list by URL */
  removeList(url: string): void {
    this.lists = this.lists.filter((l) => l.url !== url);
    this._saveCustomLists();
  }

  /** Toggle enabled state of a list (by url, null = default) */
  toggleList(url: string | null): void {
    this.lists = this.lists.map((l) => {
      if (l.url === url) return { ...l, enabled: !l.enabled };
      return l;
    });
    this._saveCustomLists();
  }

  private _normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.origin.toLowerCase() + parsed.pathname.replace(/\/+$/, "");
    } catch {
      return url.toLowerCase().replace(/\/+$/, "");
    }
  }

  private _saveCustomLists(): void {
    const customLists = this.lists
      .filter((l) => l.url !== null)
      .map((l) => ({ url: l.url as string, enabled: l.enabled, name: l.name }));

    const defaultList = this.lists.find((l) => l.url === null);
    const defaultEnabled = defaultList ? defaultList.enabled : true;

    try {
      localStorage.setItem(CUSTOM_TOKENLISTS_KEY, JSON.stringify(customLists));
      localStorage.setItem(DEFAULT_TOKENLIST_ENABLED_KEY, String(defaultEnabled));
    } catch {
      // ignore storage errors
    }
  }

  // -------------------------------------------------------------------------
  // Local tokens
  // -------------------------------------------------------------------------

  /** Add a token to local tokens (deduped by address+chainId) */
  addLocalToken(token: Token): void {
    const addr = token.address.toLowerCase();
    const chainId = Number(token.chainId);
    const isDuplicate = this.localTokens.some(
      (t) => t.address.toLowerCase() === addr && Number(t.chainId) === chainId
    );
    if (!isDuplicate) {
      this.localTokens = [...this.localTokens, { ...token, _source: LOCAL_TOKENS_SOURCE_NAME }];
      this._saveLocalTokens();
    }
  }

  /** Remove a local token by address+chainId */
  removeLocalToken(address: string, chainId: number): void {
    const addr = address.toLowerCase();
    const cid = Number(chainId);
    this.localTokens = this.localTokens.filter(
      (t) => !(t.address.toLowerCase() === addr && Number(t.chainId) === cid)
    );
    this._saveLocalTokens();
  }

  /** Toggle localTokensEnabled */
  toggleLocalTokens(): void {
    this.localTokensEnabled = !this.localTokensEnabled;
    try {
      localStorage.setItem(LOCAL_TOKENS_ENABLED_KEY, String(this.localTokensEnabled));
    } catch {
      // ignore
    }
  }

  private _saveLocalTokens(): void {
    const payload = {
      name: "Local Tokens",
      timestamp: new Date().toISOString(),
      tokens: this.localTokens.map((t) => ({
        chainId: t.chainId,
        address: t.address,
        name: t.name,
        symbol: t.symbol,
        decimals: t.decimals,
      })),
    };
    try {
      localStorage.setItem(LOCAL_TOKEN_LIST_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  /** Load local tokens from localStorage (call during init or on demand) */
  loadLocalTokens(): void {
    try {
      const raw = localStorage.getItem(LOCAL_TOKEN_LIST_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { tokens?: unknown[] };
        if (parsed && Array.isArray(parsed.tokens)) {
          this.localTokens = (parsed.tokens as Record<string, unknown>[])
            .filter(
              (t) =>
                typeof t.chainId === "number" &&
                typeof t.address === "string" &&
                typeof t.symbol === "string" &&
                typeof t.decimals === "number"
            )
            .map((t) => ({
              address: t.address as string,
              chainId: t.chainId as number,
              name: (t.name as string) || (t.symbol as string),
              symbol: t.symbol as string,
              decimals: t.decimals as number,
              _source: LOCAL_TOKENS_SOURCE_NAME,
            }));
        }
      }
    } catch {
      // corrupt data — keep empty
    }

    try {
      const enabled = localStorage.getItem(LOCAL_TOKENS_ENABLED_KEY);
      if (enabled !== null) this.localTokensEnabled = enabled === "true";
    } catch {
      // ignore
    }
  }

  // -------------------------------------------------------------------------
  // Export / Import
  // -------------------------------------------------------------------------

  /**
   * Export local tokens as a Uniswap-compatible tokenlist JSON string.
   * Returns empty string (and error) if no tokens.
   */
  exportLocalTokens(): string {
    if (this.localTokens.length === 0) return "";

    const payload = {
      name: "Local Tokens",
      version: { major: 1, minor: 0, patch: 0 },
      timestamp: new Date().toISOString(),
      tokens: this.localTokens.map((t) => ({
        chainId: t.chainId,
        address: t.address,
        name: t.name,
        symbol: t.symbol,
        decimals: t.decimals,
      })),
    };

    return JSON.stringify(payload, null, 2);
  }

  /**
   * Import tokens from a Uniswap-compatible tokenlist JSON string.
   * Returns { count } on success or { error } on failure.
   */
  importLocalTokens(json: string): { count: number } | { error: string } {
    let parsed: { tokens?: unknown[] };
    try {
      parsed = JSON.parse(json) as { tokens?: unknown[] };
    } catch {
      return { error: "File is not valid JSON" };
    }

    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tokens)) {
      return { error: "File must contain a tokens array" };
    }

    if (parsed.tokens.length === 0) {
      return { error: "Tokenlist contains no tokens" };
    }

    const validTokens: Token[] = [];
    for (const t of parsed.tokens as Record<string, unknown>[]) {
      if (
        typeof t.chainId === "number" &&
        typeof t.address === "string" &&
        /^0x[a-fA-F0-9]{40}$/.test(t.address) &&
        typeof t.symbol === "string" &&
        typeof t.decimals === "number"
      ) {
        validTokens.push({
          chainId: t.chainId,
          address: t.address,
          name: (t.name as string) || (t.symbol as string) || "Unknown",
          symbol: t.symbol,
          decimals: t.decimals,
        });
      }
    }

    if (validTokens.length === 0) {
      return { error: "No valid tokens found in file" };
    }

    let addedCount = 0;
    for (const token of validTokens) {
      const addr = token.address.toLowerCase();
      const cid = Number(token.chainId);
      const isDuplicate = this.localTokens.some(
        (t) => t.address.toLowerCase() === addr && Number(t.chainId) === cid
      );
      if (!isDuplicate) {
        this.localTokens = [...this.localTokens, { ...token, _source: LOCAL_TOKENS_SOURCE_NAME }];
        addedCount++;
      }
    }

    this._saveLocalTokens();
    return { count: addedCount };
  }

  // -------------------------------------------------------------------------
  // Find helpers
  // -------------------------------------------------------------------------

  /** Find a token by address+chainId from allTokens */
  findToken(address: string, chainId: number): Token | undefined {
    const addr = address.toLowerCase();
    const cid = Number(chainId);
    return this.allTokens.find(
      (t) => t.address.toLowerCase() === addr && Number(t.chainId) === cid
    );
  }
}

export const tokenListStore = new TokenListStore();
