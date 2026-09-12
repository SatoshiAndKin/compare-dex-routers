/**
 * Token list store — manages multiple token lists (default + custom), local tokens,
 * deduplication, export/import, and the unrecognized-token modal state.
 *
 * Default lists are loaded client-side (Uniswap from tokens.uniswap.org,
 * project tokenlist from the API's /tokenlist endpoint which serves the
 * committed static file). Custom lists are fetched directly by the browser.
 */

import { apiClient } from "../api.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

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
  isRefreshing = $state(false);
  lastRefreshedAt = $state<number | null>(null);
  private attempts = new Map<string, number>();
  private pending = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private automatic = false;
  private lifecycle = new AbortController();
  private visibilityChanged = () => {
    void this.refresh(false);
  };

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

  /** Register all list identities before asynchronous requests can change them. */
  async init(): Promise<void> {
    if (this.initialized || this.isInitializing) return;
    this.isInitializing = true;
    this.activate();
    let defaultEnabled = true;
    try {
      defaultEnabled = localStorage.getItem(DEFAULT_TOKENLIST_ENABLED_KEY) !== "false";
    } catch {
      /* Storage is optional. */
    }
    const saved = this._loadPersistedCustomLists() ?? [];
    const unique = new Map(saved.map((entry) => [this._normalizeUrl(entry.url), entry]));
    if (!unique.has(this._normalizeUrl(DEFAULT_UNISWAP_URL))) {
      unique.set(this._normalizeUrl(DEFAULT_UNISWAP_URL), {
        url: DEFAULT_UNISWAP_URL,
        name: "Uniswap Labs Default",
        enabled: true,
      });
    }
    this.lists = [
      { url: null, name: "Built-in Tokenlist", enabled: defaultEnabled, tokens: [] },
      ...[...unique.values()].map((entry) => ({ ...entry, tokens: [] as Token[] })),
    ];
    try {
      await Promise.all(this.lists.map((entry) => this.refreshList(entry.url)));
      this.initialized = true;
      this._saveCustomLists();
    } finally {
      this.isInitializing = false;
      this.scheduleRefresh();
    }
  }

  /** Start one daily timer, suspended while the page is hidden. */
  startRefresh(): void {
    this.activate();
    if (this.automatic) return;
    this.automatic = true;
    document.addEventListener("visibilitychange", this.visibilityChanged);
    if (this.initialized) void this.refresh(false);
  }

  stopRefresh(): void {
    this.automatic = false;
    clearTimeout(this.refreshTimer);
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.lifecycle.abort();
    for (const [key, pending] of this.pending) {
      pending.controller.abort();
      this.attempts.delete(key);
    }
    this.pending.clear();
    this.isRefreshing = false;
  }

  /** Manual requests bypass the daily interval; duplicate requests share work. */
  async refresh(manual = true): Promise<void> {
    if (!manual && document.visibilityState === "hidden") {
      clearTimeout(this.refreshTimer);
      return;
    }
    this.activate();
    await Promise.all(
      this.lists
        .filter((entry) => entry.enabled)
        .map((entry) => {
          const attempted = this.attempts.get(entry.url ?? "__default__");
          if (!manual && attempted !== undefined && Date.now() - attempted < REFRESH_INTERVAL_MS)
            return;
          return this.refreshList(entry.url);
        })
    );
    this.scheduleRefresh();
  }

  private activate(): void {
    if (this.lifecycle.signal.aborted) this.lifecycle = new AbortController();
  }

  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer);
    if (!this.automatic || !this.initialized || document.visibilityState === "hidden") return;
    const deadlines = this.lists
      .filter((entry) => entry.enabled)
      .map((entry) => (this.attempts.get(entry.url ?? "__default__") ?? 0) + REFRESH_INTERVAL_MS);
    if (!deadlines.length) return;
    this.refreshTimer = setTimeout(
      () => {
        void this.refresh(false);
      },
      Math.max(0, Math.min(...deadlines) - Date.now())
    );
  }

  private refreshList(url: string | null): Promise<void> {
    const key = url ?? "__default__";
    const pending = this.pending.get(key);
    if (pending) return pending.promise;
    const controller = new AbortController();
    const lifecycle = this.lifecycle.signal;
    const signal = AbortSignal.any([controller.signal, lifecycle, AbortSignal.timeout(30_000)]);
    this.attempts.set(key, Date.now());
    this.isRefreshing = true;
    const promise = (async () => {
      try {
        const update = url
          ? await this._fetchCustomList(url, signal)
          : await this.loadDefaultList(signal);
        signal.throwIfAborted();
        this.lists = this.lists.map((entry) =>
          entry.url === url ? { ...entry, error: undefined, ...update } : entry
        );
        this.lastRefreshedAt = Date.now();
        this._saveCustomLists();
      } catch (error) {
        if (controller.signal.aborted || lifecycle.aborted) return;
        this.lists = this.lists.map((entry) =>
          entry.url === url
            ? {
                ...entry,
                error: error instanceof Error ? error.message : "Token list request failed",
              }
            : entry
        );
      } finally {
        if (this.pending.get(key)?.controller === controller) this.pending.delete(key);
        this.isRefreshing = this.pending.size > 0;
      }
    })();
    this.pending.set(key, { controller, promise });
    return promise;
  }

  private async loadDefaultList(
    signal: AbortSignal
  ): Promise<{ name: string; tokens: Token[]; error?: string }> {
    const { data, error } = await apiClient.GET("/tokenlist", { signal, cache: "no-cache" });
    if (!data || error) throw new Error("Cannot refresh the built-in token list.");
    const name = data.name ?? DEFAULT_TOKENLIST_NAME;
    // The API exposes configured files separately, plus their aggregate tokens.
    const entries = data.tokenlists ?? [];
    const tokens = entries.length
      ? entries.flatMap((entry) => this.parseTokens(entry.tokens, entry.name))
      : this.parseTokens(data.tokens, name);
    const errors = entries.flatMap((entry) =>
      entry.error ? [`${entry.name}: ${entry.error}`] : []
    );
    return { name, tokens, ...(errors.length ? { error: errors.join(" ") } : {}) };
  }

  private parseTokens(value: unknown, name: string): Token[] {
    if (!Array.isArray(value)) throw new Error("Invalid tokenlist: missing tokens array");
    return value
      .filter(
        (token): token is Record<string, unknown> =>
          token !== null &&
          typeof token === "object" &&
          typeof token.decimals === "number" &&
          Number.isInteger(token.decimals) &&
          token.decimals >= 0 &&
          token.decimals <= 255 &&
          typeof token.address === "string" &&
          typeof token.chainId === "number"
      )
      .map((token) => ({
        address: token.address as string,
        chainId: token.chainId as number,
        name: typeof token.name === "string" ? token.name : "",
        symbol: typeof token.symbol === "string" ? token.symbol : "",
        decimals: token.decimals as number,
        ...(typeof token.logoURI === "string" ? { logoURI: token.logoURI } : {}),
        _source: name,
      }));
  }

  private _loadPersistedCustomLists(): PersistedList[] | null {
    try {
      const raw = localStorage.getItem(CUSTOM_TOKENLISTS_KEY);
      if (raw) {
        const saved: unknown = JSON.parse(raw);
        if (Array.isArray(saved))
          return saved.filter(
            (entry): entry is PersistedList =>
              entry !== null &&
              typeof entry === "object" &&
              typeof entry.url === "string" &&
              typeof entry.name === "string" &&
              typeof entry.enabled === "boolean"
          );
      }
    } catch {
      // corrupt data
    }
    return null;
  }

  private async _fetchCustomList(
    url: string,
    signal?: AbortSignal
  ): Promise<{ tokens: Token[]; name: string }> {
    this.activate();
    signal ??= AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(30_000)]);
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal,
      cache: "no-cache",
    });
    if (!response.ok) throw new Error(`Failed to fetch tokenlist: HTTP ${response.status}`);
    const data = (await response.json()) as { name?: unknown; tokens?: unknown } | null;
    signal.throwIfAborted();
    const name = typeof data?.name === "string" ? data.name : url;
    return { name, tokens: this.parseTokens(data?.tokens, name) };
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
      this.attempts.set(trimmed, Date.now());
      this._saveCustomLists();
      this.scheduleRefresh();
      return null; // success
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  /** Remove a custom list by URL */
  removeList(url: string): void {
    this.pending.get(url)?.controller.abort();
    this.pending.delete(url);
    this.attempts.delete(url);
    this.lists = this.lists.filter((l) => l.url !== url);
    this._saveCustomLists();
    this.scheduleRefresh();
  }

  /** Toggle enabled state of a list (by url, null = default) */
  toggleList(url: string | null): void {
    const key = url ?? "__default__";
    if (this.lists.some((entry) => entry.url === url && entry.enabled)) {
      if (this.pending.has(key)) this.attempts.delete(key);
      this.pending.get(key)?.controller.abort();
      this.pending.delete(key);
      this.isRefreshing = this.pending.size > 0;
    }
    this.lists = this.lists.map((l) => {
      if (l.url === url) return { ...l, enabled: !l.enabled };
      return l;
    });
    this._saveCustomLists();
    if (this.automatic) void this.refresh(false);
  }

  private _normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.origin.toLowerCase() + parsed.pathname.replace(/\/+$/, "") + parsed.search;
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
