/**
 * Wallet connection module.
 * Handles ERC-6963 multi-provider discovery, WalletConnect integration,
 * connect/disconnect flows, chain switching, and auto-approve/swap pending actions.
 */

import { WALLETCONNECT_PROJECT_ID, CHAIN_ID_HEX_MAP } from "./config.js";
import type { EIP1193Provider, WalletProviderInfo, WalletProviderDetail } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pending wallet action for auto-approve/swap after connect */
export interface PendingPostConnectAction {
  type: "approve" | "swap";
  card: HTMLElement;
  button?: HTMLButtonElement;
}

/** DOM elements required by the wallet module */
export interface WalletElements {
  connectWalletBtn: HTMLElement;
  walletConnected: HTMLElement;
  walletConnectedIcon: HTMLImageElement;
  walletConnectedName: HTMLElement;
  walletConnectedAddress: HTMLElement;
  disconnectWalletBtn: HTMLElement;
  walletMessage: HTMLElement;
  walletProviderModal: HTMLElement;
  walletProviderModalClose: HTMLElement;
  walletProviderList: HTMLElement;
  walletProviderNoWallet: HTMLElement;
}

/** Modal functions passed from modals.ts */
export interface WalletModalFunctions {
  lockBodyScroll: () => void;
  unlockBodyScroll: () => void;
  closeWalletProviderMenu: () => void;
}

/** Callbacks for cross-module interaction */
export interface WalletCallbacks {
  getCurrentChainId: () => number;
  onConnected: (pendingAction: PendingPostConnectAction | null) => void;
  onDisconnected: () => void;
  updateTransactionActionStates: () => void;
  updateTokenBalances: () => void;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const walletProvidersByUuid = new Map<string, WalletProviderDetail>();
let fallbackWalletProvider: EIP1193Provider | null = null;
let connectedWalletProvider: EIP1193Provider | null = null;
let connectedWalletAddressValue = "";
let connectedWalletInfo: WalletProviderInfo | null = null;
let pendingPostConnectAction: PendingPostConnectAction | null = null;
let isConnectingProvider = false;

// DOM element references (set during initWallet)
let elConnectWalletBtn: HTMLElement;
let elWalletConnected: HTMLElement;
let elWalletConnectedIcon: HTMLImageElement;
let elWalletConnectedName: HTMLElement;
let elWalletConnectedAddress: HTMLElement;
let elWalletMessage: HTMLElement;
let elWalletProviderModal: HTMLElement;
let elWalletProviderModalClose: HTMLElement;
let elWalletProviderList: HTMLElement;
let elWalletProviderNoWallet: HTMLElement;

// Injected dependencies
let modalFns: WalletModalFunctions;
let callbacks: WalletCallbacks;

// ---------------------------------------------------------------------------
// WalletConnect constants
// ---------------------------------------------------------------------------

const WALLETCONNECT_ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="32" height="32" rx="6" fill="#3B99FC"/>' +
      '<path d="M10.05 12.36c3.28-3.21 8.62-3.21 11.9 0l.4.39a.41.41 0 0 1 0 .58l-1.35 ' +
      "1.32a.21.21 0 0 1-.3 0l-.54-.53c-2.29-2.24-6.01-2.24-8.3 0l-.58.57a.21.21 0 0 " +
      "1-.3 0l-1.35-1.32a.41.41 0 0 1 0-.58l.42-.43Zm14.7 2.74 1.2 1.18a.41.41 0 0 1 0 " +
      ".58l-5.43 5.31a.42.42 0 0 1-.6 0l-3.85-3.77a.1.1 0 0 0-.15 0l-3.85 3.77a.42.42 0 " +
      "0 1-.6 0l-5.42-5.31a.41.41 0 0 1 0-.58l1.2-1.18a.42.42 0 0 1 .6 0l3.85 3.77a.1.1 " +
      "0 0 0 .15 0l3.85-3.77a.42.42 0 0 1 .6 0l3.85 3.77a.1.1 0 0 0 .15 0l3.85-3.77a.42" +
      '.42 0 0 1 .6 0Z" fill="#fff"/></svg>'
  );

const WALLETCONNECT_INFO: WalletProviderInfo = {
  uuid: "walletconnect",
  name: "WalletConnect",
  icon: WALLETCONNECT_ICON,
  rdns: "walletconnect",
};

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function getChainIdHex(chainId: number | string): string {
  const id = String(chainId || "").trim();
  if (!id) return "0x0";
  const mapped = CHAIN_ID_HEX_MAP[id];
  if (mapped) return mapped;
  const parsed = Number(id);
  if (!Number.isFinite(parsed) || parsed < 0) return "0x0";
  return "0x" + parsed.toString(16);
}

function walletName(info: WalletProviderInfo | null): string {
  if (!info || typeof info.name !== "string" || !info.name.trim()) {
    return "Wallet";
  }
  return info.name.trim();
}

function createWalletIcon(
  iconUri: string | undefined,
  altText: string,
  className: string
): HTMLImageElement {
  const icon = document.createElement("img");
  icon.className = className;
  icon.alt = altText;
  if (typeof iconUri === "string" && iconUri) {
    icon.src = iconUri;
  } else {
    icon.style.display = "none";
  }
  icon.onerror = () => {
    icon.src = "";
    icon.style.display = "none";
  };
  return icon;
}

// ---------------------------------------------------------------------------
// Exported state accessors
// ---------------------------------------------------------------------------

/** Returns true if a wallet is currently connected with an address */
export function hasConnectedWallet(): boolean {
  return Boolean(connectedWalletProvider && connectedWalletAddressValue);
}

/** Returns the connected EIP-1193 provider, or null */
export function getConnectedProvider(): EIP1193Provider | null {
  return connectedWalletProvider;
}

/** Returns the connected wallet address (empty string if not connected) */
export function getConnectedAddress(): string {
  return connectedWalletAddressValue;
}

/** Returns whether a wallet connection is currently in progress */
export function getIsConnectingProvider(): boolean {
  return isConnectingProvider;
}

/** Returns the current pending post-connect action, or null */
export function getPendingPostConnectAction(): PendingPostConnectAction | null {
  return pendingPostConnectAction;
}

/** Sets the pending post-connect action (for auto-approve/swap) */
export function setPendingPostConnectAction(action: PendingPostConnectAction | null): void {
  pendingPostConnectAction = action;
}

// ---------------------------------------------------------------------------
// Wallet message UI
// ---------------------------------------------------------------------------

/** Display a message in the wallet status area */
export function setWalletMessage(message: string, isError = false): void {
  elWalletMessage.textContent = message;
  elWalletMessage.classList.toggle("error", isError);
}

// ---------------------------------------------------------------------------
// Internal wallet state management
// ---------------------------------------------------------------------------

function setWalletGlobals(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  win.__selectedWalletProvider = connectedWalletProvider;
  win.__selectedWalletAddress = connectedWalletAddressValue;
  win.__selectedWalletInfo = connectedWalletInfo;
}

function updateWalletStateUi(): void {
  if (connectedWalletProvider && connectedWalletAddressValue) {
    elConnectWalletBtn.hidden = true;
    elWalletConnected.hidden = false;
    elWalletConnectedName.textContent = walletName(connectedWalletInfo);
    // Never truncate addresses — project convention (AGENTS.md)
    elWalletConnectedAddress.textContent = connectedWalletAddressValue;

    const icon =
      connectedWalletInfo && typeof connectedWalletInfo.icon === "string"
        ? connectedWalletInfo.icon
        : "";
    if (icon) {
      elWalletConnectedIcon.hidden = false;
      elWalletConnectedIcon.src = icon;
      elWalletConnectedIcon.onerror = () => {
        elWalletConnectedIcon.src = "";
        elWalletConnectedIcon.hidden = true;
      };
    } else {
      elWalletConnectedIcon.hidden = true;
      elWalletConnectedIcon.removeAttribute("src");
      elWalletConnectedIcon.onerror = null;
    }
  } else {
    elConnectWalletBtn.hidden = false;
    elWalletConnected.hidden = true;
    elWalletConnectedName.textContent = "";
    elWalletConnectedAddress.textContent = "";
    elWalletConnectedIcon.hidden = true;
    elWalletConnectedIcon.removeAttribute("src");
    elWalletConnectedIcon.onerror = null;
  }
}

// ---------------------------------------------------------------------------
// Connect / Disconnect
// ---------------------------------------------------------------------------

async function connectToWalletProvider(
  provider: EIP1193Provider,
  info: WalletProviderInfo | Record<string, string>
): Promise<void> {
  if (!provider || typeof provider.request !== "function") {
    setWalletMessage("Wallet provider is not available.", true);
    return;
  }

  isConnectingProvider = true;

  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const account = Array.isArray(accounts) ? (accounts[0] as string | undefined) : null;
    if (typeof account !== "string" || !account) {
      throw new Error("No account returned by wallet");
    }

    connectedWalletProvider = provider;
    connectedWalletAddressValue = account;
    connectedWalletInfo = (info as WalletProviderInfo) || { name: "Wallet", icon: "" };

    setWalletGlobals();
    modalFns.closeWalletProviderMenu();
    updateWalletStateUi();
    callbacks.updateTransactionActionStates();
    setWalletMessage("");
    callbacks.updateTokenBalances();

    // Execute pending post-connect action (auto-approve/auto-swap)
    const action = pendingPostConnectAction;
    pendingPostConnectAction = null;
    isConnectingProvider = false;
    callbacks.onConnected(action);
  } catch (err: unknown) {
    isConnectingProvider = false;
    const code = err && typeof err === "object" ? (err as Record<string, unknown>).code : undefined;
    if (code === 4001) {
      setWalletMessage("Wallet connection was canceled.", true);
      pendingPostConnectAction = null;
      return;
    }
    const detail = err instanceof Error ? err.message : String(err);
    setWalletMessage("Wallet connection failed: " + detail, true);
  }
}

function disconnectWallet(): void {
  connectedWalletProvider = null;
  connectedWalletAddressValue = "";
  connectedWalletInfo = null;
  setWalletGlobals();
  modalFns.closeWalletProviderMenu();
  updateWalletStateUi();
  callbacks.updateTransactionActionStates();
  callbacks.onDisconnected();
  setWalletMessage("Wallet disconnected.");
}

// ---------------------------------------------------------------------------
// WalletConnect
// ---------------------------------------------------------------------------

function isWalletConnectAvailable(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!(WALLETCONNECT_PROJECT_ID && (window as any).__WalletConnectEthereumProvider);
}

async function connectViaWalletConnect(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const EthereumProvider = (window as any).__WalletConnectEthereumProvider;
  if (!EthereumProvider) {
    setWalletMessage("WalletConnect module is not available. Try refreshing.", true);
    return;
  }
  if (!WALLETCONNECT_PROJECT_ID) {
    setWalletMessage("WalletConnect is not configured (missing project ID).", true);
    return;
  }
  try {
    const wcProvider = await EthereumProvider.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      optionalChains: [1, 8453, 42161, 10, 137, 56, 43114],
      metadata: {
        name: "Compare DEX Routers",
        description: "Compare DEX Router Quotes",
        url: location.origin,
        icons: [],
      },
      showQrModal: true,
    });

    wcProvider.on("disconnect", () => {
      disconnectWallet();
    });

    await wcProvider.connect();
    await connectToWalletProvider(wcProvider as EIP1193Provider, WALLETCONNECT_INFO);
  } catch (err: unknown) {
    const code = err && typeof err === "object" ? (err as Record<string, unknown>).code : undefined;
    if (code === 4001) {
      setWalletMessage("WalletConnect connection was canceled.", true);
      pendingPostConnectAction = null;
      return;
    }
    const detail = err instanceof Error ? err.message : String(err);
    setWalletMessage("WalletConnect failed: " + detail, true);
  }
}

// ---------------------------------------------------------------------------
// Wallet provider menu rendering
// ---------------------------------------------------------------------------

function openWalletProviderMenuImpl(providers: WalletProviderDetail[]): void {
  elWalletProviderList.innerHTML = "";
  elWalletProviderNoWallet.hidden = true;

  providers.forEach((detail) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "wallet-provider-option";

    const providerInfo = detail.info || ({} as WalletProviderInfo);
    const providerName = walletName(providerInfo);
    const icon = createWalletIcon(
      providerInfo.icon,
      providerName + " icon",
      "wallet-provider-icon"
    );
    const name = document.createElement("span");
    name.className = "wallet-provider-name";
    name.textContent = providerName;

    option.appendChild(icon);
    option.appendChild(name);

    option.addEventListener("click", () => {
      void connectToWalletProvider(detail.provider, providerInfo);
    });

    elWalletProviderList.appendChild(option);
  });

  // Add WalletConnect option if available
  if (isWalletConnectAvailable()) {
    const wcOption = document.createElement("button");
    wcOption.type = "button";
    wcOption.className = "wallet-provider-option";

    const wcIcon = createWalletIcon(
      WALLETCONNECT_INFO.icon,
      "WalletConnect icon",
      "wallet-provider-icon"
    );
    const wcName = document.createElement("span");
    wcName.className = "wallet-provider-name";
    wcName.textContent = "WalletConnect";

    wcOption.appendChild(wcIcon);
    wcOption.appendChild(wcName);

    wcOption.addEventListener("click", () => {
      void connectViaWalletConnect();
    });

    elWalletProviderList.appendChild(wcOption);
  }

  elWalletProviderModal.classList.add("show");
  modalFns.lockBodyScroll();
  elWalletProviderModalClose.focus();
}

// ---------------------------------------------------------------------------
// ERC-6963 provider discovery
// ---------------------------------------------------------------------------

function getAnnouncedWalletProviders(): WalletProviderDetail[] {
  return Array.from(walletProvidersByUuid.values());
}

function onAnnounceProvider(event: Event): void {
  const detail = (event as CustomEvent).detail as WalletProviderDetail | undefined;
  if (!detail || !detail.provider || !detail.info || typeof detail.info.uuid !== "string") {
    return;
  }

  if (walletProvidersByUuid.has(detail.info.uuid)) {
    return;
  }

  walletProvidersByUuid.set(detail.info.uuid, detail);
}

// ---------------------------------------------------------------------------
// Wallet connection flow
// ---------------------------------------------------------------------------

/** Triggers the wallet connection flow (opens provider menu or auto-connects) */
export function triggerWalletConnectionFlow(): void {
  setWalletMessage("");
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const announcedProviders = getAnnouncedWalletProviders();
  const wcAvailable = isWalletConnectAvailable();

  if (announcedProviders.length > 0 || wcAvailable) {
    openWalletProviderMenuImpl(announcedProviders);
    return;
  }

  if (fallbackWalletProvider) {
    void connectToWalletProvider(fallbackWalletProvider, {
      uuid: "window.ethereum",
      name: "Injected Wallet",
      icon: "",
      rdns: "window.ethereum",
    });
    return;
  }

  // No providers found — show the modal with "no wallet" message
  elWalletProviderList.innerHTML = "";
  elWalletProviderNoWallet.hidden = false;
  elWalletProviderModal.classList.add("show");
  modalFns.lockBodyScroll();
  elWalletProviderModalClose.focus();
}

// ---------------------------------------------------------------------------
// Chain switching
// ---------------------------------------------------------------------------

/** Ensure the wallet is connected to the specified chain, switching if needed */
export async function ensureWalletOnChain(
  provider: EIP1193Provider,
  chainId: number | string
): Promise<void> {
  const targetChainIdHex = getChainIdHex(chainId).toLowerCase();
  if (targetChainIdHex === "0x0") {
    throw new Error("Invalid chain ID");
  }

  const activeChainId = await provider.request({ method: "eth_chainId" });
  if (String(activeChainId || "").toLowerCase() === targetChainIdHex) {
    return;
  }

  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: targetChainIdHex }],
  });
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the wallet module.
 * Sets up ERC-6963 discovery, event listeners, and exposes functions on window.
 */
export function initWallet(
  elements: WalletElements,
  modal: WalletModalFunctions,
  cbs: WalletCallbacks
): void {
  // Store DOM element references
  elConnectWalletBtn = elements.connectWalletBtn;
  elWalletConnected = elements.walletConnected;
  elWalletConnectedIcon = elements.walletConnectedIcon;
  elWalletConnectedName = elements.walletConnectedName;
  elWalletConnectedAddress = elements.walletConnectedAddress;
  elWalletMessage = elements.walletMessage;
  elWalletProviderModal = elements.walletProviderModal;
  elWalletProviderModalClose = elements.walletProviderModalClose;
  elWalletProviderList = elements.walletProviderList;
  elWalletProviderNoWallet = elements.walletProviderNoWallet;

  // Store injected dependencies
  modalFns = modal;
  callbacks = cbs;

  // --- ERC-6963 provider discovery ---
  window.addEventListener("eip6963:announceProvider", onAnnounceProvider);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (window as any).ethereum !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fallbackWalletProvider = (window as any).ethereum as EIP1193Provider;
  }

  // --- Event listeners ---
  elConnectWalletBtn.addEventListener("click", triggerWalletConnectionFlow);
  elements.disconnectWalletBtn.addEventListener("click", disconnectWallet);

  // --- Initial state ---
  updateWalletStateUi();
  setWalletGlobals();
  callbacks.updateTransactionActionStates();

  // --- Expose on window for inline JS compatibility ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  win.hasConnectedWallet = hasConnectedWallet;
  win.getConnectedProvider = getConnectedProvider;
  win.getConnectedAddress = getConnectedAddress;
  win.triggerWalletConnectionFlow = triggerWalletConnectionFlow;
  win.setPendingPostConnectAction = setPendingPostConnectAction;
  win.ensureWalletOnChain = ensureWalletOnChain;
  win.setWalletMessage = setWalletMessage;
  win.disconnectWallet = disconnectWallet;
  win.__openWalletProviderMenuImpl = openWalletProviderMenuImpl;

  // Bridge callbacks for the modals module (replaces inline JS's window.__cb_* setters)
  win.__cb_hasConnectedWallet = hasConnectedWallet;
  win.__cb_getIsConnectingProvider = () => isConnectingProvider;
  win.__cb_getPendingPostConnectAction = () => pendingPostConnectAction;
  win.__cb_setPendingPostConnectAction = (action: PendingPostConnectAction | null) => {
    pendingPostConnectAction = action;
  };
}
