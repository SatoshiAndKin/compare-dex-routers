declare global {
  interface Window {
    __config: {
      defaultTokens: Record<string, { from: string; to: string }>;
      walletConnectProjectId: string;
    };
  }
}

import "./types.js";
import { DEFAULT_TOKENS, WALLETCONNECT_PROJECT_ID } from "./config.js";
import { initTheme } from "./theme.js";
import { initChainSelector, getCurrentChainId } from "./chain-selector.js";
import type { ChainSelectorElements, ChainSelectorCallbacks } from "./chain-selector.js";
import {
  initModals,
  lockBodyScroll,
  unlockBodyScroll,
  closeWalletProviderMenu,
  openSwapConfirmModal,
  updateSwapConfirmModalText,
  openMevModal as modalsOpenMevModal,
  renderMevChainContent,
} from "./modals.js";
import type { ModalElements, ModalCallbacks } from "./modals.js";
import {
  initWallet,
  hasConnectedWallet,
  getConnectedProvider,
  getConnectedAddress,
  ensureWalletOnChain,
  triggerWalletConnectionFlow,
  setPendingPostConnectAction,
  setWalletMessage,
} from "./wallet.js";
import type { WalletElements, WalletModalFunctions, WalletCallbacks } from "./wallet.js";
import {
  initTokenManagement,
  renderLocalTokens,
  fetchTokenMetadata,
  handleUnrecognizedTokenSave,
  getUnrecognizedTokenState,
  setUnrecognizedTokenState,
  findTokenByAddress,
  getTokensForChain,
  initializeTokenlistSources,
  renderTokenlistSources,
} from "./token-management.js";
import type { TokenManagementElements, TokenManagementCallbacks } from "./token-management.js";
import { initAutocomplete, escapeHtml, refreshAutocomplete } from "./autocomplete.js";
import type { AutocompleteElements, AutocompleteCallbacks } from "./autocomplete.js";
import {
  initAmountFields,
  updateAmountFieldLabels,
  formatQuoteAmount,
  setDirectionMode,
  getActiveMode,
  scheduleAutoQuote,
  populateNonActiveField,
  setComputedAmount,
  getActiveAmount,
  isProgrammatic,
  setProgrammatic,
  getBestQuoteFromState as amountGetBestQuoteFromState,
} from "./amount-fields.js";
import type { AmountFieldElements, AmountFieldCallbacks } from "./amount-fields.js";
import {
  initSlippage,
  getSlippageBps,
  setSlippageBps,
  updateSlippagePresetActive,
} from "./slippage.js";
import type { SlippageElements } from "./slippage.js";
import {
  initUrlSync,
  readCompareParamsFromForm,
  saveUserPreferences,
  loadPreferences,
  getSavedTokensForChain,
  applyDefaults,
  cloneCompareParams,
  compareParamsToSearchParams,
  updateUrlFromCompareParams,
  restoreFromUrlAndPreferences,
  applyTokenFormattingAfterLoad,
} from "./url-sync.js";
import type { UrlSyncElements, UrlSyncCallbacks } from "./url-sync.js";
import { formatChainDisplay } from "./chain-selector.js";
import { CHAIN_NAMES } from "./config.js";
import {
  initBalance,
  updateTokenBalances,
  updateFromTokenBalance,
  updateToTokenBalance,
  clearBalances,
  clearBalanceCache,
} from "./balance.js";
import type { BalanceElements, BalanceCallbacks } from "./balance.js";
import {
  initTransactions,
  isAddressLike,
  handleTokenRefClick,
  updateTransactionActionStates,
  onApproveClick,
  onSwapClick,
  executeSwapFromCard,
  setupResultClickHandler,
} from "./transactions.js";
import type { TransactionCallbacks } from "./transactions.js";
import {
  initAutoRefresh,
  stopAutoRefresh,
  pauseAutoRefreshForTransaction,
  resumeAutoRefreshAfterTransaction,
  runCompareAndMaybeStartAutoRefresh,
  forceUpdateRefreshIndicator,
} from "./auto-refresh.js";
import type { AutoRefreshElements, AutoRefreshCallbacks } from "./auto-refresh.js";
import {
  initQuoteDisplay,
  cancelInProgressFetches,
  clearResultDisplay,
  requestAndRenderCompare,
  getProgressiveQuoteState,
  getCurrentQuoteChainId,
  getBestQuoteFromState,
  hasQuoteResults,
  getNextRequestId,
  setupTabSwitching,
  resetCurrentQuoteChainId,
  formatErrorWithTokenRefs,
  showError,
} from "./quote-display.js";
import type { QuoteDisplayElements, QuoteDisplayCallbacks } from "./quote-display.js";

console.log(
  "[client] bundle loaded, chains configured",
  Object.keys(DEFAULT_TOKENS).length,
  "chains,",
  WALLETCONNECT_PROJECT_ID ? "WC enabled" : "WC disabled"
);

// ---------------------------------------------------------------------------
// Theme toggle initialization
// ---------------------------------------------------------------------------

const themeBtn = document.getElementById("themeBtn") as HTMLButtonElement | null;
const themeIcon = document.getElementById("themeIcon");
if (themeBtn && themeIcon) {
  initTheme(themeBtn, themeIcon);
}

// ---------------------------------------------------------------------------
// Chain selector initialization
// ---------------------------------------------------------------------------

const chainSelectorElements: ChainSelectorElements = {
  chainIdInput: document.getElementById("chainId") as HTMLInputElement,
  chainDropdown: document.getElementById("chainDropdown") as HTMLElement,
};

const chainSelectorCallbacks: ChainSelectorCallbacks = {
  onChainChange: () => {
    // Chain change side-effects are handled by the inline JS 'change' listener
  },
  getCurrentChainId: () => getCurrentChainId(),
};

initChainSelector(chainSelectorElements, chainSelectorCallbacks);

// ---------------------------------------------------------------------------
// Modals initialization
// ---------------------------------------------------------------------------

function getEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing modal element: #${id}`);
  return el;
}

const modalElements: ModalElements = {
  mevModal: getEl("mevModal"),
  mevModalClose: getEl("mevModalClose"),
  mevInfoBtn: getEl("mevInfoBtn"),
  mevChainContent: getEl("mevChainContent"),
  settingsModal: getEl("settingsModal"),
  settingsBtn: getEl("settingsBtn"),
  settingsModalClose: getEl("settingsModalClose"),
  swapConfirmModal: getEl("swapConfirmModal"),
  swapConfirmModalClose: getEl("swapConfirmModalClose"),
  swapConfirmModalText: getEl("swapConfirmModalText"),
  swapConfirmWaitBtn: getEl("swapConfirmWaitBtn"),
  swapConfirmProceedBtn: getEl("swapConfirmProceedBtn"),
  walletProviderModal: getEl("walletProviderModal"),
  walletProviderModalClose: getEl("walletProviderModalClose"),
  walletProviderList: getEl("walletProviderList"),
  walletProviderNoWallet: getEl("walletProviderNoWallet"),
  unrecognizedTokenModal: getEl("unrecognizedTokenModal"),
  unrecognizedTokenModalClose: getEl("unrecognizedTokenModalClose"),
  unrecognizedTokenAddress: getEl("unrecognizedTokenAddress"),
  unrecognizedTokenLoading: getEl("unrecognizedTokenLoading"),
  unrecognizedTokenMetadata: getEl("unrecognizedTokenMetadata"),
  unrecognizedTokenError: getEl("unrecognizedTokenError"),
  unrecognizedTokenCancelBtn: getEl("unrecognizedTokenCancelBtn"),
  unrecognizedTokenSaveBtn: getEl("unrecognizedTokenSaveBtn") as HTMLButtonElement,
};

// Bridge callbacks: the inline JS exposes these on window for us to wire up.
// During init the inline script hasn't run yet, so we read at call time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const win = window as any;

// Pending swap card state (used by swap confirmation modal)
let pendingSwapCard: HTMLElement | null = null;

const modalCallbacks: ModalCallbacks = {
  getCurrentChainId: () => getCurrentChainId(),
  hasConnectedWallet: () => hasConnectedWallet(),
  renderLocalTokens: () => renderLocalTokens(),
  addMevRpcToWallet: (type: string) => {
    if (typeof win.__cb_addMevRpcToWallet === "function")
      (win.__cb_addMevRpcToWallet as (t: string) => void)(type);
  },
  getProgressiveQuoteState: () => {
    const state = getProgressiveQuoteState();
    return {
      complete: state.complete,
      spandex: state.spandex,
      spandexError: state.spandexError,
      curve: state.curve,
      curveError: state.curveError,
      singleRouterMode: state.singleRouterMode,
    };
  },
  executeSwapFromCard: async (card: HTMLElement) => {
    await executeSwapFromCard(card);
  },
  getPendingSwapCard: () => pendingSwapCard,
  setPendingSwapCard: (card: HTMLElement | null) => {
    pendingSwapCard = card;
  },
  fetchTokenMetadata: (address: string, chainId: number) =>
    void fetchTokenMetadata(address, chainId),
  handleUnrecognizedTokenSave: () => handleUnrecognizedTokenSave(),
  getFromInput: () => document.getElementById("from"),
  getToInput: () => document.getElementById("to"),
  getUnrecognizedTokenState: () => {
    const state = getUnrecognizedTokenState();
    return { targetInput: state.targetInput };
  },
  setUnrecognizedTokenState: (state) => {
    setUnrecognizedTokenState(state as { targetInput: "from" | "to" | null });
  },
  getConnectWalletBtn: () => document.getElementById("connectWalletBtn"),
  getIsConnectingProvider: () =>
    typeof win.__cb_getIsConnectingProvider === "function"
      ? (win.__cb_getIsConnectingProvider as () => boolean)()
      : false,
  getPendingPostConnectAction: () =>
    typeof win.__cb_getPendingPostConnectAction === "function"
      ? (win.__cb_getPendingPostConnectAction as () => unknown)()
      : null,
  setPendingPostConnectAction: (action: unknown) => {
    if (typeof win.__cb_setPendingPostConnectAction === "function")
      (win.__cb_setPendingPostConnectAction as (a: unknown) => void)(action);
  },
};

initModals(modalElements, modalCallbacks);

// ---------------------------------------------------------------------------
// Wallet initialization
// ---------------------------------------------------------------------------

const walletElements: WalletElements = {
  connectWalletBtn: getEl("connectWalletBtn"),
  walletConnected: getEl("walletConnected"),
  walletConnectedIcon: getEl("walletConnectedIcon") as HTMLImageElement,
  walletConnectedName: getEl("walletConnectedName"),
  walletConnectedAddress: getEl("walletConnectedAddress"),
  disconnectWalletBtn: getEl("disconnectWalletBtn"),
  walletMessage: getEl("walletMessage"),
  walletProviderModal: modalElements.walletProviderModal,
  walletProviderModalClose: modalElements.walletProviderModalClose,
  walletProviderList: modalElements.walletProviderList,
  walletProviderNoWallet: modalElements.walletProviderNoWallet,
};

const walletModalFns: WalletModalFunctions = {
  lockBodyScroll,
  unlockBodyScroll,
  closeWalletProviderMenu,
};

const walletCallbacks: WalletCallbacks = {
  getCurrentChainId: () => getCurrentChainId(),
  onConnected: (pendingAction) => {
    if (pendingAction) {
      if (pendingAction.type === "approve" && pendingAction.card && pendingAction.button) {
        void onApproveClick(pendingAction.card, pendingAction.button);
      } else if (pendingAction.type === "swap" && pendingAction.card) {
        void onSwapClick(pendingAction.card);
      }
    }
  },
  onDisconnected: () => {
    clearBalances();
  },
  updateTransactionActionStates: () => updateTransactionActionStates(),
  updateTokenBalances: () => updateTokenBalances(),
};

initWallet(walletElements, walletModalFns, walletCallbacks);

// ---------------------------------------------------------------------------
// Token management initialization
// ---------------------------------------------------------------------------

const fromInput = document.getElementById("from") as HTMLInputElement;
const toInput = document.getElementById("to") as HTMLInputElement;
const fromWrapper = document.getElementById("fromWrapper") as HTMLElement;
const toWrapper = document.getElementById("toWrapper") as HTMLElement;
const fromIcon = document.getElementById("fromIcon") as HTMLImageElement;
const toIcon = document.getElementById("toIcon") as HTMLImageElement;

const tokenManagementElements: TokenManagementElements = {
  tokenlistUrlInput: getEl("tokenlistUrlInput") as HTMLInputElement,
  addTokenlistBtn: getEl("addTokenlistBtn") as HTMLButtonElement,
  tokenlistMessage: getEl("tokenlistMessage"),
  tokenlistSourcesList: getEl("tokenlistSourcesList"),
  exportLocalTokensBtn: getEl("exportLocalTokensBtn") as HTMLButtonElement,
  importLocalTokensInput: getEl("importLocalTokensInput") as HTMLInputElement,
  localTokensToggle: getEl("localTokensToggle"),
  localTokensMessage: getEl("localTokensMessage"),
  localTokensContent: getEl("localTokensContent"),
  unrecognizedTokenModal: modalElements.unrecognizedTokenModal,
  unrecognizedTokenLoading: getEl("unrecognizedTokenLoading"),
  unrecognizedTokenMetadata: getEl("unrecognizedTokenMetadata"),
  unrecognizedTokenName: getEl("unrecognizedTokenName"),
  unrecognizedTokenSymbol: getEl("unrecognizedTokenSymbol"),
  unrecognizedTokenDecimals: getEl("unrecognizedTokenDecimals"),
  unrecognizedTokenError: getEl("unrecognizedTokenError"),
  unrecognizedTokenSaveBtn: getEl("unrecognizedTokenSaveBtn") as HTMLButtonElement,
  fromInput,
  toInput,
};

const tokenManagementCallbacks: TokenManagementCallbacks = {
  getCurrentChainId: () => getCurrentChainId(),
  escapeHtml: (str: string) => escapeHtml(str),
  refreshAutocomplete: () => refreshAutocomplete(),
  findTokenByAddress: (address: string, chainId: number) => findTokenByAddress(address, chainId),
  formatTokenDisplay: (symbol: string, address: string) => {
    if (typeof win.formatTokenDisplay === "function")
      return (win.formatTokenDisplay as (s: string, a: string) => string)(symbol, address);
    const sym = String(symbol || "").trim();
    const addr = String(address || "").trim();
    if (!addr) return sym || "";
    return sym ? sym + " (" + addr + ")" : addr;
  },
  handleTokenSwapIfNeeded: (
    currentInput: HTMLInputElement,
    newAddress: string,
    newDisplay: string
  ) => {
    if (typeof win.handleTokenSwapIfNeeded === "function")
      (win.handleTokenSwapIfNeeded as (i: HTMLInputElement, a: string, d: string) => void)(
        currentInput,
        newAddress,
        newDisplay
      );
  },
  updateTokenInputIcon: (
    input: HTMLInputElement,
    icon: HTMLImageElement,
    wrapper: HTMLElement,
    token: unknown
  ) => {
    if (typeof win.updateTokenInputIcon === "function")
      (
        win.updateTokenInputIcon as (
          i: HTMLInputElement,
          ic: HTMLImageElement,
          w: HTMLElement,
          t: unknown
        ) => void
      )(input, icon, wrapper, token);
  },
  clearTokenInputIcon: (wrapper: HTMLElement, icon: HTMLImageElement) => {
    if (typeof win.clearTokenInputIcon === "function")
      (win.clearTokenInputIcon as (w: HTMLElement, i: HTMLImageElement) => void)(wrapper, icon);
  },
  updateFromTokenBalance: () => {
    void updateFromTokenBalance();
  },
  updateToTokenBalance: () => {
    void updateToTokenBalance();
  },
  updateAmountFieldLabels: () => updateAmountFieldLabels(),
  isAddressLike: (address: string) => isAddressLike(address),
  openUnrecognizedTokenModal: (address: string, chainId: number, targetInput: string) => {
    if (typeof win.openUnrecognizedTokenModal === "function")
      (win.openUnrecognizedTokenModal as (a: string, c: number, t: string) => void)(
        address,
        chainId,
        targetInput
      );
  },
  closeUnrecognizedTokenModal: () => {
    if (typeof win.closeUnrecognizedTokenModal === "function")
      (win.closeUnrecognizedTokenModal as () => void)();
  },
  getFromIcon: () => fromIcon,
  getToIcon: () => toIcon,
  getFromWrapper: () => fromWrapper,
  getToWrapper: () => toWrapper,
};

initTokenManagement(tokenManagementElements, tokenManagementCallbacks);

// ---------------------------------------------------------------------------
// Autocomplete initialization
// ---------------------------------------------------------------------------

const autocompleteElements: AutocompleteElements = {
  fromInput,
  toInput,
  fromAutocompleteList: getEl("fromAutocomplete"),
  toAutocompleteList: getEl("toAutocomplete"),
  fromWrapper,
  toWrapper,
  fromIcon,
  toIcon,
  chainIdInput: document.getElementById("chainId") as HTMLInputElement,
};

const autocompleteCallbacks: AutocompleteCallbacks = {
  getCurrentChainId: () => getCurrentChainId(),
  getTokensForChain: (chainId: number) => getTokensForChain(chainId),
  formatTokenDisplay: tokenManagementCallbacks.formatTokenDisplay,
  handleTokenSwapIfNeeded: tokenManagementCallbacks.handleTokenSwapIfNeeded,
  updateTokenInputIcon: tokenManagementCallbacks.updateTokenInputIcon,
  clearTokenInputIcon: tokenManagementCallbacks.clearTokenInputIcon,
  updateFromTokenBalance: () => void updateFromTokenBalance(),
  updateToTokenBalance: () => void updateToTokenBalance(),
  updateAmountFieldLabels: () => updateAmountFieldLabels(),
  findTokenByAddress: (address: string, chainId: number) => findTokenByAddress(address, chainId),
};

initAutocomplete(autocompleteElements, autocompleteCallbacks);

// ---------------------------------------------------------------------------
// Amount fields initialization
// ---------------------------------------------------------------------------

const sellAmountInput = document.getElementById("sellAmount") as HTMLInputElement;
const receiveAmountInput = document.getElementById("receiveAmount") as HTMLInputElement;
const sellAmountLabel = document.getElementById("sellAmountLabel") as HTMLElement;
const receiveAmountLabel = document.getElementById("receiveAmountLabel") as HTMLElement;
const sellAmountGroup = document.getElementById("sellAmountGroup") as HTMLElement;
const receiveAmountGroup = document.getElementById("receiveAmountGroup") as HTMLElement;
const targetOutNote = document.getElementById("targetOutNote") as HTMLElement;

const amountFieldElements: AmountFieldElements = {
  sellAmountInput,
  receiveAmountInput,
  sellAmountLabel,
  receiveAmountLabel,
  sellAmountGroup,
  receiveAmountGroup,
  targetOutNote,
  fromInput,
  toInput,
};

const amountFieldCallbacks: AmountFieldCallbacks = {
  scheduleAutoQuote: () => scheduleAutoQuote(),
  cancelInProgressFetches: () => cancelInProgressFetches(),
  readCompareParamsFromForm: () => readCompareParamsFromForm(),
  runCompareAndMaybeStartAutoRefresh: async (params, options) => {
    await runCompareAndMaybeStartAutoRefresh(params, options);
  },
  findTokenByAddress: (address: string, chainId: number) => findTokenByAddress(address, chainId),
  getCurrentChainId: () => getCurrentChainId(),
  getBestQuoteFromState: () => getBestQuoteFromState(),
  clearNonActiveField: () => setComputedAmount(""),
};

initAmountFields(amountFieldElements, amountFieldCallbacks);

// ---------------------------------------------------------------------------
// Slippage initialization
// ---------------------------------------------------------------------------

const slippageElements: SlippageElements = {
  slippageInput: document.getElementById("slippageBps") as HTMLInputElement,
  slippagePresetBtns: document.querySelectorAll(
    ".slippage-preset-compact"
  ) as NodeListOf<HTMLElement>,
};

initSlippage(slippageElements);

// ---------------------------------------------------------------------------
// URL sync initialization
// ---------------------------------------------------------------------------

const urlSyncElements: UrlSyncElements = {
  fromInput,
  toInput,
  sellAmountInput,
  receiveAmountInput,
  chainIdInput: document.getElementById("chainId") as HTMLInputElement,
  fromIcon,
  toIcon,
  fromWrapper,
  toWrapper,
};

const urlSyncCallbacks: UrlSyncCallbacks = {
  getCurrentChainId: () => getCurrentChainId(),
  hasConnectedWallet: () => hasConnectedWallet(),
  getConnectedAddress: () => getConnectedAddress(),
  getActiveMode: () => getActiveMode(),
  getSlippageBps: () => getSlippageBps(),
  findTokenByAddress: (address: string, chainId: number) => findTokenByAddress(address, chainId),
  formatTokenDisplay: tokenManagementCallbacks.formatTokenDisplay,
  updateTokenInputIcon: tokenManagementCallbacks.updateTokenInputIcon as (
    input: HTMLInputElement,
    icon: HTMLImageElement,
    wrapper: HTMLElement,
    token: import("./types.js").Token | undefined
  ) => void,
  clearTokenInputIcon: tokenManagementCallbacks.clearTokenInputIcon,
  updateAmountFieldLabels: () => updateAmountFieldLabels(),
  setDirectionMode: (mode: "exactIn" | "targetOut") => setDirectionMode(mode),
  updateSlippagePresetActive: (value: string) => updateSlippagePresetActive(value),
  setSlippageBps: (value: string) => setSlippageBps(value),
  formatChainDisplay: (chainId: string, chainName: string) =>
    formatChainDisplay(chainId, chainName),
  getChainName: (chainId: string) => CHAIN_NAMES[chainId] ?? "",
  extractAddressFromInput: (input: HTMLInputElement) => {
    if (typeof win.extractAddressFromInput === "function")
      return (win.extractAddressFromInput as (i: HTMLInputElement) => string)(input);
    // Fallback: check data-address then value
    const dataAddr = input.dataset.address;
    if (dataAddr && /^0x[a-fA-F0-9]{40}$/.test(dataAddr)) return dataAddr;
    const value = String(input.value || "").trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(value)) return value;
    if (dataAddr) return dataAddr;
    return value;
  },
};

initUrlSync(urlSyncElements, urlSyncCallbacks);

// ---------------------------------------------------------------------------
// Balance module initialization
// ---------------------------------------------------------------------------

const balanceElements: BalanceElements = {
  fromBalanceEl: getEl("fromBalance"),
  toBalanceEl: getEl("toBalance"),
  fromInput,
  toInput,
};

const balanceCallbacks: BalanceCallbacks = {
  getCurrentChainId: () => getCurrentChainId(),
  hasConnectedWallet: () => hasConnectedWallet(),
  getConnectedProvider: () => getConnectedProvider(),
  getConnectedAddress: () => getConnectedAddress(),
  findTokenByAddress: (address: string, chainId: number) => findTokenByAddress(address, chainId),
};

initBalance(balanceElements, balanceCallbacks);

// ---------------------------------------------------------------------------
// Quote display module initialization
// ---------------------------------------------------------------------------

const quoteDisplayElements: QuoteDisplayElements = {
  result: getEl("result"),
  recommendedContent: getEl("recommendedContent"),
  alternativeContent: getEl("alternativeContent"),
  tabRecommended: getEl("tabRecommended"),
  tabAlternative: getEl("tabAlternative"),
  submit: getEl("submit") as HTMLButtonElement,
};

const quoteDisplayCallbacks: QuoteDisplayCallbacks = {
  hasConnectedWallet: () => hasConnectedWallet(),
  getCurrentChainId: () => getCurrentChainId(),
  renderResultTokenIcon: (address, chainId) =>
    typeof win.renderResultTokenIcon === "function"
      ? (win.renderResultTokenIcon as (a: string, c: number | string) => string)(address, chainId)
      : "",
  getTokensForChain: (chainId: number) => getTokensForChain(chainId),
  handleTokenRefClick: (element, address) => handleTokenRefClick(element, address),
  formatErrorWithTokenRefs: (message, chainId) => formatErrorWithTokenRefs(message, chainId),
  updateTransactionActionStates: () => updateTransactionActionStates(),
  forceUpdateRefreshIndicator: () => forceUpdateRefreshIndicator(),
  populateNonActiveField: (quote) => populateNonActiveField(quote),
  clearNonActiveField: () => setComputedAmount(""),
  cloneCompareParams: (params) => cloneCompareParams(params),
  compareParamsToSearchParams: (params) => compareParamsToSearchParams(params),
  updateUrlFromCompareParams: (params) => updateUrlFromCompareParams(params),
  saveUserPreferences: (params) => saveUserPreferences(params),
  updateSwapConfirmModalText: () => updateSwapConfirmModalText(),
  isSwapConfirmModalOpen: () => modalElements.swapConfirmModal.classList.contains("show"),
  getBestQuoteFromState: () => getBestQuoteFromState(),
};

initQuoteDisplay(quoteDisplayElements, quoteDisplayCallbacks);

// ---------------------------------------------------------------------------
// Transactions module initialization
// ---------------------------------------------------------------------------

const transactionCallbacks: TransactionCallbacks = {
  hasConnectedWallet: () => hasConnectedWallet(),
  getConnectedProvider: () => getConnectedProvider(),
  getConnectedAddress: () => getConnectedAddress(),
  getCurrentChainId: () => getCurrentChainId(),
  setWalletMessage: (message, isError) => setWalletMessage(message, isError),
  triggerWalletConnectionFlow: () => triggerWalletConnectionFlow(),
  setPendingPostConnectAction: (action) => setPendingPostConnectAction(action),
  ensureWalletOnChain: (provider, chainId) => ensureWalletOnChain(provider, chainId),
  pauseAutoRefreshForTransaction: () => pauseAutoRefreshForTransaction(),
  resumeAutoRefreshAfterTransaction: () => resumeAutoRefreshAfterTransaction(),
  areQuotesStillLoading: () => {
    const state = getProgressiveQuoteState();
    return !state.complete;
  },
  openSwapConfirmModal: (card) => openSwapConfirmModal(card),
  getCurrentQuoteChainId: () => getCurrentQuoteChainId(),
};

initTransactions(transactionCallbacks);

// Set up click delegation for tx buttons on the result container
setupResultClickHandler(quoteDisplayElements.result);

// ---------------------------------------------------------------------------
// Auto-refresh module initialization
// ---------------------------------------------------------------------------

const autoRefreshElements: AutoRefreshElements = {
  refreshIndicator: getEl("refreshIndicator"),
  refreshCountdown: getEl("refreshCountdown"),
  refreshStatus: getEl("refreshStatus"),
  result: quoteDisplayElements.result,
};

const autoRefreshCallbacks: AutoRefreshCallbacks = {
  cloneCompareParams: (params) => cloneCompareParams(params),
  hasConnectedWallet: () => hasConnectedWallet(),
  getConnectedAddress: () => getConnectedAddress(),
  requestAndRenderCompare: (params, options) => requestAndRenderCompare(params, options),
  readCompareParamsFromForm: () => readCompareParamsFromForm(),
  hasQuoteResults: (payload) => hasQuoteResults(payload),
  getNextRequestId: () => getNextRequestId(),
};

initAutoRefresh(autoRefreshElements, autoRefreshCallbacks);

// Set up tab switching
setupTabSwitching();

// ---------------------------------------------------------------------------
// Expose functions on window for inline JS shims (temporary bridge)
// ---------------------------------------------------------------------------

// These are still needed by inline JS in server.ts for functions not yet extracted.
win.__cb_cancelInProgressFetches = () => cancelInProgressFetches();
win.__cb_runCompareAndMaybeStartAutoRefresh = (
  params: import("./types.js").CompareParams,
  options: { showLoading?: boolean }
) => runCompareAndMaybeStartAutoRefresh(params, options);
win.__cb_getBestQuoteFromState = () => getBestQuoteFromState();
win.__cb_clearNonActiveField = () => setComputedAmount("");
win.__cb_getProgressiveQuoteState = () => getProgressiveQuoteState();
win.__cb_executeSwapFromCard = (card: HTMLElement) => executeSwapFromCard(card);
win.__cb_getPendingSwapCard = () => pendingSwapCard;
win.__cb_setPendingSwapCard = (card: HTMLElement | null) => {
  pendingSwapCard = card;
};
win.__cb_updateTransactionActionStates = () => updateTransactionActionStates();
win.__cb_updateTokenBalances = () => updateTokenBalances();
win.__cb_onWalletConnected = (
  pendingAction: { type: string; card: HTMLElement; button?: HTMLButtonElement } | null
) => {
  if (pendingAction) {
    if (pendingAction.type === "approve" && pendingAction.card && pendingAction.button) {
      void onApproveClick(pendingAction.card, pendingAction.button);
    } else if (pendingAction.type === "swap" && pendingAction.card) {
      void onSwapClick(pendingAction.card);
    }
  }
};
win.__cb_onWalletDisconnected = () => clearBalances();
win.updateFromTokenBalance = () => void updateFromTokenBalance();
win.updateToTokenBalance = () => void updateToTokenBalance();
win.handleTokenRefClick = (element: HTMLElement, address: string) =>
  handleTokenRefClick(element, address);

// ---------------------------------------------------------------------------
// Chain change handler
// ---------------------------------------------------------------------------

const chainIdInput = document.getElementById("chainId") as HTMLInputElement;
chainIdInput.addEventListener("change", () => {
  stopAutoRefresh();
  clearResultDisplay();
  resetCurrentQuoteChainId();
  applyDefaults(Number(getCurrentChainId()));
  // Update modal content if modal is open
  if (modalElements.mevModal.classList.contains("show")) {
    renderMevChainContent();
  }
  // Clear balance cache on chain change and refetch balances
  clearBalanceCache();
  updateTokenBalances();
  updateAmountFieldLabels();
  renderTokenlistSources();
});

// ---------------------------------------------------------------------------
// Form submit handler
// ---------------------------------------------------------------------------

const form = document.getElementById("form") as HTMLFormElement;
form.addEventListener("submit", async (e: Event) => {
  e.preventDefault();
  const compareParams = readCompareParamsFromForm();
  await runCompareAndMaybeStartAutoRefresh(compareParams, { showLoading: true });
});

// ---------------------------------------------------------------------------
// URL restore and initial load
// ---------------------------------------------------------------------------

const urlRestoreResult = restoreFromUrlAndPreferences();
const shouldLoadFromUrlParams = urlRestoreResult.shouldLoadFromUrlParams;
const savedPrefs = urlRestoreResult.savedPrefs;

initializeTokenlistSources().then(() => {
  applyTokenFormattingAfterLoad(savedPrefs);

  const activeElement = document.activeElement;
  if (activeElement === fromInput) {
    refreshAutocomplete();
  }
  if (activeElement === toInput) {
    refreshAutocomplete();
  }

  if (shouldLoadFromUrlParams) {
    void runCompareAndMaybeStartAutoRefresh(readCompareParamsFromForm(), {
      showLoading: true,
      updateUrl: false,
    });
  }

  // Render local tokens on page load
  renderLocalTokens();

  // Fetch balances if wallet is already connected
  updateTokenBalances();
  // Update amount field labels with token symbols from loaded tokens
  updateAmountFieldLabels();
});

// Re-export for inline JS compatibility (avoid dead-code detection issues)
void formatQuoteAmount;
void populateNonActiveField;
void setComputedAmount;
void getActiveAmount;
void isProgrammatic;
void setProgrammatic;
void amountGetBestQuoteFromState;
void loadPreferences;
void getSavedTokensForChain;
void applyDefaults;
void cloneCompareParams;
void compareParamsToSearchParams;
void updateUrlFromCompareParams;
void restoreFromUrlAndPreferences;
void applyTokenFormattingAfterLoad;
void saveUserPreferences;
void showError;
void modalsOpenMevModal;

export {};
