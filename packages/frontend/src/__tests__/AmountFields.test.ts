import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, beforeEach } from "vitest";
import AmountFields from "../lib/components/AmountFields.svelte";
import { formStore } from "../lib/stores/formStore.svelte.js";

describe("AmountFields", () => {
  beforeEach(() => {
    // Reset form state
    formStore.mode = "exactIn";
    formStore.sellAmount = "";
    formStore.receiveAmount = "";
    formStore.fromToken = null;
    formStore.toToken = null;
  });

  it("renders sell and receive inputs", () => {
    const { getByLabelText } = render(AmountFields);

    expect(getByLabelText("YOU SELL")).toBeTruthy();
    expect(getByLabelText("YOU RECEIVE")).toBeTruthy();
  });

  it("sell input is active in exactIn mode (default)", () => {
    const { container } = render(AmountFields);

    // Sell group should have 'active' class in exactIn mode
    const sellGroup = container.querySelector("#sell-amount")?.closest(".amount-group");
    expect(sellGroup?.classList.contains("active")).toBe(true);

    // Receive group should be computed
    const receiveGroup = container.querySelector("#receive-amount")?.closest(".amount-group");
    expect(receiveGroup?.classList.contains("computed")).toBe(true);
  });

  it("receive input is active in targetOut mode", async () => {
    formStore.mode = "targetOut";

    const { container } = render(AmountFields);

    // Receive group should have 'active' class in targetOut mode
    const receiveGroup = container.querySelector("#receive-amount")?.closest(".amount-group");
    expect(receiveGroup?.classList.contains("active")).toBe(true);

    // Sell group should be computed
    const sellGroup = container.querySelector("#sell-amount")?.closest(".amount-group");
    expect(sellGroup?.classList.contains("computed")).toBe(true);
  });

  it("Exact Output button switches from exactIn to targetOut", async () => {
    const { getByRole } = render(AmountFields);

    expect(formStore.mode).toBe("exactIn");

    const exactOutBtn = getByRole("button", { name: /exact output/i });
    await fireEvent.click(exactOutBtn);

    expect(formStore.mode).toBe("targetOut");
  });

  it("Exact Input button switches from targetOut back to exactIn", async () => {
    formStore.mode = "targetOut";

    const { getByRole } = render(AmountFields);

    const exactInBtn = getByRole("button", { name: /exact input/i });
    await fireEvent.click(exactInBtn);

    expect(formStore.mode).toBe("exactIn");
  });

  it("typing in sell input updates formStore.sellAmount", async () => {
    const { getByLabelText } = render(AmountFields);

    const sellInput = getByLabelText("YOU SELL");
    await fireEvent.input(sellInput, { target: { value: "1.5" } });

    expect(formStore.sellAmount).toBe("1.5");
  });

  it("typing in receive input updates formStore.receiveAmount and mode", async () => {
    const { getByLabelText } = render(AmountFields);

    const receiveInput = getByLabelText("YOU RECEIVE");
    await fireEvent.input(receiveInput, { target: { value: "100" } });

    expect(formStore.receiveAmount).toBe("100");
    expect(formStore.mode).toBe("targetOut");
  });

  it("focusing sell input switches mode to exactIn", async () => {
    formStore.mode = "targetOut";

    const { getByLabelText } = render(AmountFields);

    const sellInput = getByLabelText("YOU SELL");
    await fireEvent.focus(sellInput);

    expect(formStore.mode).toBe("exactIn");
  });

  it("focusing receive input switches mode to targetOut", async () => {
    const { getByLabelText } = render(AmountFields);

    const receiveInput = getByLabelText("YOU RECEIVE");
    await fireEvent.focus(receiveInput);

    expect(formStore.mode).toBe("targetOut");
  });

  it("shows token symbol in labels when tokens are selected", async () => {
    formStore.fromToken = {
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      symbol: "USDC",
      decimals: 6,
    };
    formStore.toToken = {
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      symbol: "USDT",
      decimals: 6,
    };

    const { getByLabelText } = render(AmountFields);

    expect(getByLabelText("YOU SELL USDC")).toBeTruthy();
    expect(getByLabelText("YOU RECEIVE USDT")).toBeTruthy();
  });

  it("Exact Output button is active when in targetOut mode", () => {
    formStore.mode = "targetOut";

    const { getByRole } = render(AmountFields);

    const exactOutBtn = getByRole("button", { name: /exact output/i });
    expect(exactOutBtn.classList.contains("active")).toBe(true);
  });
});
