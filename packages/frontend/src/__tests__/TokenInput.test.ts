import { render, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import TokenInput from "../lib/components/TokenInput.svelte";
import { formStore } from "../lib/stores/formStore.svelte.js";
import { tokensStore } from "../lib/stores/tokensStore.svelte.js";
import { tokenListStore } from "../lib/stores/tokenListStore.svelte.js";

// Mock the API client
vi.mock("../lib/api.js", () => ({
  apiClient: {
    GET: vi.fn().mockResolvedValue({
      data: {
        tokens: [
          {
            address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            symbol: "USDC",
            name: "USD Coin",
            decimals: 6,
            chainId: 1,
            logoURI: "https://example.com/usdc.png",
          },
          {
            address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
            symbol: "USDT",
            name: "Tether USD",
            decimals: 6,
            chainId: 1,
          },
          {
            address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            symbol: "DAI",
            name: "Dai Stablecoin",
            decimals: 18,
            chainId: 1,
          },
        ],
      },
    }),
  },
}));

describe("TokenInput", () => {
  beforeEach(() => {
    formStore.chainId = 1;
    formStore.fromToken = null;
    formStore.toToken = null;
    tokenListStore.unrecognizedModal = null;
    // Reset tokens store
    Object.assign(tokensStore, {
      allTokens: [],
      isLoading: false,
      error: null,
    });
    // Re-enable fetch
    (tokensStore as unknown as { fetched: boolean }).fetched = false;
  });

  it('renders input field for "from" type', () => {
    const { getByPlaceholderText } = render(TokenInput, { props: { type: "from" } });
    expect(getByPlaceholderText("Sell token...")).toBeTruthy();
  });

  it('renders input field for "to" type', () => {
    const { getByPlaceholderText } = render(TokenInput, { props: { type: "to" } });
    expect(getByPlaceholderText("Receive token...")).toBeTruthy();
  });

  it("shows autocomplete dropdown after typing", async () => {
    const { getByPlaceholderText, queryAllByRole } = render(TokenInput, {
      props: { type: "from" },
    });
    const input = getByPlaceholderText("Sell token...");

    // Trigger fetch + input
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: "USD" } });

    // Wait for async operations
    await new Promise((r) => setTimeout(r, 10));

    const options = queryAllByRole("option");
    expect(options.length).toBeGreaterThanOrEqual(1);
  });

  it("shows the selected label and one full address", async () => {
    const address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    formStore.fromToken = { address, symbol: "USDC", decimals: 6 };
    const view = render(TokenInput, { type: "from" });
    await waitFor(() => expect(view.getByRole("textbox")).toHaveValue("USDC"));
    expect(view.getAllByText(address, { exact: true })).toHaveLength(1);
    expect(view.getByText(address)).toHaveClass("selected-token-address");
    expect(view.getByRole("button", { name: "Copy from token address" })).toBeVisible();
  });

  it("updates formStore.fromToken when from token selected", async () => {
    // Pre-populate tokens store
    tokensStore.allTokens = [
      {
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        symbol: "USDC",
        decimals: 6,
        name: "USD Coin",
        chainId: 1,
      },
    ];
    (tokensStore as unknown as { fetched: boolean }).fetched = true;

    const { getByPlaceholderText, getAllByRole } = render(TokenInput, { props: { type: "from" } });
    const input = getByPlaceholderText("Sell token...");

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: "USDC" } });
    await new Promise((r) => setTimeout(r, 10));

    const options = getAllByRole("option");
    if (options.length > 0) {
      const firstOption = options[0];
      if (firstOption) {
        await fireEvent.mouseDown(firstOption);
        expect(formStore.fromToken?.symbol).toBe("USDC");
        expect(formStore.fromToken?.address).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      }
    }
  });

  it("updates formStore.toToken when to token selected", async () => {
    tokensStore.allTokens = [
      {
        address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        symbol: "USDT",
        decimals: 6,
        name: "Tether USD",
        chainId: 1,
      },
    ];
    (tokensStore as unknown as { fetched: boolean }).fetched = true;

    const { getByPlaceholderText, getAllByRole } = render(TokenInput, { props: { type: "to" } });
    const input = getByPlaceholderText("Receive token...");

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: "USDT" } });
    await new Promise((r) => setTimeout(r, 10));

    const options = getAllByRole("option");
    if (options.length > 0) {
      const firstOption = options[0];
      if (firstOption) {
        await fireEvent.mouseDown(firstOption);
        expect(formStore.toToken?.symbol).toBe("USDT");
      }
    }
  });

  it("shows full address in autocomplete dropdown items", async () => {
    tokensStore.allTokens = [
      {
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        symbol: "USDC",
        decimals: 6,
        name: "USD Coin",
        chainId: 1,
      },
    ];
    (tokensStore as unknown as { fetched: boolean }).fetched = true;

    const { getByPlaceholderText, container } = render(TokenInput, { props: { type: "from" } });
    const input = getByPlaceholderText("Sell token...");

    await fireEvent.input(input, { target: { value: "DAI" } });
    await new Promise((r) => setTimeout(r, 0));
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: "USDC" } });
    await new Promise((r) => setTimeout(r, 10));

    // Find address elements in the dropdown
    const addrElements = container.querySelectorAll(".autocomplete-addr");
    if (addrElements.length > 0) {
      const firstEl = addrElements[0];
      if (firstEl) {
        const addr = firstEl.textContent ?? "";
        // Should be full address, not truncated
        expect(addr).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
        expect(addr).not.toContain("...");
      }
    }
  });

  it("hides clear buttons when fields are empty", () => {
    const { queryByRole } = render(TokenInput, { props: { type: "from" } });

    expect(queryByRole("button", { name: "Clear from token" })).toBeNull();
  });

  it("shows clear button when text is typed", async () => {
    const { getByPlaceholderText, getByRole } = render(TokenInput, { props: { type: "from" } });
    const input = getByPlaceholderText("Sell token...");

    await fireEvent.input(input, { target: { value: "USDC" } });

    expect(getByRole("button", { name: "Clear from token" })).toBeTruthy();
  });

  it("shows clear button when a token is selected", () => {
    formStore.toToken = {
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      symbol: "USDT",
      decimals: 6,
      name: "Tether USD",
    };

    const { getByRole } = render(TokenInput, { props: { type: "to" } });

    expect(getByRole("button", { name: "Clear to token" })).toBeTruthy();
  });

  it("clears only the connected field, hides dropdown, and returns focus", async () => {
    tokensStore.allTokens = [
      {
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        symbol: "USDC",
        decimals: 6,
        name: "USD Coin",
        chainId: 1,
      },
    ];
    (tokensStore as unknown as { fetched: boolean }).fetched = true;

    formStore.fromToken = {
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      symbol: "USDC",
      decimals: 6,
      name: "USD Coin",
    };
    formStore.toToken = {
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      symbol: "USDT",
      decimals: 6,
      name: "Tether USD",
    };

    const { getByPlaceholderText, getByRole, queryByRole } = render(TokenInput, {
      props: { type: "from" },
    });
    const input = getByPlaceholderText("Sell token...") as HTMLInputElement;

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: "USD" } });
    await new Promise((r) => setTimeout(r, 10));

    expect(queryByRole("option")).toBeTruthy();

    const clearButton = getByRole("button", { name: "Clear from token" });
    await fireEvent.mouseDown(clearButton);
    await fireEvent.click(clearButton);

    expect(formStore.fromToken).toBeNull();
    expect(formStore.toToken?.symbol).toBe("USDT");
    expect(input.value).toBe("");
    expect(queryByRole("option")).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(queryByRole("button", { name: "Clear from token" })).toBeNull();
  });

  it("preventDefault on clear mousedown avoids unrecognized token modal", async () => {
    const { getByPlaceholderText, getByRole, queryByText } = render(TokenInput, {
      props: { type: "from" },
    });
    const input = getByPlaceholderText("Sell token...") as HTMLInputElement;

    await fireEvent.input(input, { target: { value: "0x1234" } });

    const clearButton = getByRole("button", { name: "Clear from token" });
    const mouseDownEvent = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    clearButton.dispatchEvent(mouseDownEvent);
    await fireEvent.click(clearButton);

    expect(mouseDownEvent.defaultPrevented).toBe(true);
    expect(tokenListStore.unrecognizedModal).toBeNull();
    expect(queryByText(/Add Unrecognized Token/i)).toBeNull();
  });

  it("swaps the opposite token when selecting a duplicate from token", async () => {
    tokensStore.allTokens = [
      {
        address: "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2",
        symbol: "WETH",
        decimals: 18,
        name: "Wrapped Ether",
        chainId: 1,
      },
    ];
    (tokensStore as unknown as { fetched: boolean }).fetched = true;

    formStore.fromToken = {
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      symbol: "USDC",
      decimals: 6,
      name: "USD Coin",
    };
    formStore.toToken = {
      address: "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2",
      symbol: "WETH",
      decimals: 18,
      name: "Wrapped Ether",
    };

    const { getByPlaceholderText, getAllByRole } = render(TokenInput, { props: { type: "from" } });
    const input = getByPlaceholderText("Sell token...");

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: "WETH" } });
    await new Promise((r) => setTimeout(r, 10));

    await fireEvent.mouseDown(getAllByRole("option")[0]!);

    expect(formStore.fromToken).toMatchObject({
      address: "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2",
    });
    expect(formStore.toToken).toMatchObject({
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      symbol: "USDC",
    });
  });

  it("swaps the opposite token when selecting a duplicate to token", async () => {
    tokensStore.allTokens = [
      {
        address: "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2",
        symbol: "WETH",
        decimals: 18,
        name: "Wrapped Ether",
        chainId: 1,
      },
    ];
    (tokensStore as unknown as { fetched: boolean }).fetched = true;

    formStore.fromToken = {
      address: "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2",
      symbol: "WETH",
      decimals: 18,
      name: "Wrapped Ether",
    };
    formStore.toToken = {
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      symbol: "USDC",
      decimals: 6,
      name: "USD Coin",
    };

    const { getByPlaceholderText, getAllByRole } = render(TokenInput, { props: { type: "to" } });
    const input = getByPlaceholderText("Receive token...");

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: "WETH" } });
    await new Promise((r) => setTimeout(r, 10));

    await fireEvent.mouseDown(getAllByRole("option")[0]!);

    expect(formStore.toToken?.symbol).toBe("WETH");
    expect(formStore.fromToken).toMatchObject({
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      symbol: "USDC",
    });
  });

  it("clears the other side when duplicate selection swaps against a null current token", async () => {
    tokensStore.allTokens = [
      {
        address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        symbol: "USDT",
        decimals: 6,
        name: "Tether USD",
        chainId: 1,
      },
    ];
    (tokensStore as unknown as { fetched: boolean }).fetched = true;

    formStore.fromToken = null;
    formStore.toToken = {
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      symbol: "USDT",
      decimals: 6,
      name: "Tether USD",
    };

    const { getByPlaceholderText, getAllByRole } = render(TokenInput, { props: { type: "from" } });
    const input = getByPlaceholderText("Sell token...");

    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: "USDT" } });
    await new Promise((r) => setTimeout(r, 10));

    await fireEvent.mouseDown(getAllByRole("option")[0]!);

    expect(formStore.fromToken).toMatchObject({
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    });
    expect(formStore.toToken).toBeNull();
  });

  it("updates both input displays after a duplicate selection swap", async () => {
    tokensStore.allTokens = [
      {
        address: "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2",
        symbol: "WETH",
        decimals: 18,
        name: "Wrapped Ether",
        chainId: 1,
      },
    ];
    (tokensStore as unknown as { fetched: boolean }).fetched = true;

    formStore.fromToken = {
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      symbol: "USDC",
      decimals: 6,
      name: "USD Coin",
    };
    formStore.toToken = {
      address: "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2",
      symbol: "WETH",
      decimals: 18,
      name: "Wrapped Ether",
    };

    const { getByPlaceholderText, getAllByRole } = render(TokenInput, { props: { type: "from" } });
    const { getByPlaceholderText: getToPlaceholder } = render(TokenInput, {
      props: { type: "to" },
    });
    const fromInput = getByPlaceholderText("Sell token...") as HTMLInputElement;
    const toInput = getToPlaceholder("Receive token...") as HTMLInputElement;

    expect(fromInput.value).toBe("USDC");
    expect(toInput.value).toBe("WETH");
    await fireEvent.focus(fromInput);
    await fireEvent.input(fromInput, { target: { value: "WETH" } });
    await new Promise((r) => setTimeout(r, 10));

    await fireEvent.mouseDown(getAllByRole("option")[0]!);
    await waitFor(() => {
      expect(fromInput.value).toBe("WETH");
      expect(toInput.value).toBe("USDC");
    });
  });

  it("preserves the captured current token across multi-character typing before duplicate selection", async () => {
    tokensStore.allTokens = [
      {
        address: "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2",
        symbol: "WETH",
        decimals: 18,
        name: "Wrapped Ether",
        chainId: 1,
      },
    ];
    (tokensStore as unknown as { fetched: boolean }).fetched = true;

    formStore.fromToken = {
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      symbol: "USDC",
      decimals: 6,
      name: "USD Coin",
    };
    formStore.toToken = {
      address: "0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2",
      symbol: "WETH",
      decimals: 18,
      name: "Wrapped Ether",
    };

    const { getByPlaceholderText, getAllByRole } = render(TokenInput, { props: { type: "from" } });
    const fromInput = getByPlaceholderText("Sell token...") as HTMLInputElement;

    await fireEvent.focus(fromInput);
    for (const value of ["W", "WE", "WET", "WETH"]) {
      await fireEvent.input(fromInput, { target: { value } });
      await new Promise((r) => setTimeout(r, 10));
    }

    await fireEvent.mouseDown(getAllByRole("option")[0]!);

    await waitFor(() => {
      expect(formStore.fromToken?.symbol).toBe("WETH");
      expect(formStore.toToken).toMatchObject({
        symbol: "USDC",
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      });
      expect(fromInput.value).toBe("WETH");
    });
  });
});

describe("selected address copying", () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const from = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const to = "0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e";
  const writeText = vi.fn();
  beforeEach(() => {
    formStore.chainId = 1;
    formStore.fromToken = { address: from, symbol: "USDC", decimals: 6 };
    formStore.toToken = { address: to, symbol: "YFI", decimals: 18 };
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  });
  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  });
  it.each(["from", "to"] as const)(
    "copies the exact %s address and shows confirmation",
    async (type) => {
      const view = render(TokenInput, { type });
      const button = view.getByRole("button", { name: `Copy ${type} token address` });
      await fireEvent.click(button);
      await waitFor(() => expect(button).toHaveTextContent("Copied"));
      expect(writeText).toHaveBeenCalledExactlyOnceWith(type === "from" ? from : to);
      expect(formStore.fromToken?.address).toBe(from);
      expect(formStore.toToken?.address).toBe(to);
    }
  );
  it("shows a failed-copy message, preserves the address, and permits retry", async () => {
    writeText.mockRejectedValueOnce(new DOMException("Clipboard denied", "NotAllowedError"));
    const view = render(TokenInput, { type: "from" });
    const button = view.getByRole("button", { name: "Copy from token address" });
    await fireEvent.click(button);
    expect(await view.findByRole("alert")).toHaveTextContent(
      "Could not copy. Select and copy the full address."
    );
    expect(button).toHaveTextContent("Retry");
    expect(view.getByText(from)).toBeVisible();
    await fireEvent.click(button);
    await waitFor(() => expect(button).toHaveTextContent("Copied"));
    expect(view.queryByRole("alert")).toBeNull();
    expect(writeText).toHaveBeenLastCalledWith(from);
  });
  it("does not carry copy confirmation to a different selected token", async () => {
    const view = render(TokenInput, { type: "from" });
    const button = view.getByRole("button", { name: "Copy from token address" });
    await fireEvent.click(button);
    await waitFor(() => expect(button).toHaveTextContent("Copied"));
    formStore.fromToken = { address: to, symbol: "YFI", decimals: 18 };
    await waitFor(() => expect(button).toHaveTextContent("Copy"));
    expect(view.queryByText(from)).toBeNull();
    await fireEvent.click(button);
    expect(writeText).toHaveBeenLastCalledWith(to);
  });
});
