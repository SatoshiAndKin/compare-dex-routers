import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, beforeEach } from "vitest";
import AmountFields from "../lib/components/AmountFields.svelte";
import { formStore } from "../lib/stores/formStore.svelte.js";
import { comparisonStore } from "../lib/stores/comparisonStore.svelte.js";
import { makeQuote, FROM, TO } from "./quote-fixture.js";
import { tick } from "svelte";

describe("AmountFields", () => {
  beforeEach(() => {
    comparisonStore.invalidate();
    // Reset form state
    formStore.mode = "exactIn";
    formStore.sellAmount = "";
    formStore.receiveAmount = "";
    formStore.fromToken = null;
    formStore.toToken = null;
  });

  it.each(["exactIn", "targetOut"] as const)(
    "shows the selected %s quote alongside the exact amount without losing precision",
    async (mode) => {
      formStore.mode = mode;
      formStore.fromToken = { address: FROM, symbol: "USDC", decimals: 18 };
      formStore.toToken = { address: TO, symbol: "USDT", decimals: 18 };
      formStore.sellAmount = "4161.636507410085088097";
      formStore.receiveAmount = "1454.297535508463832644";
      const quote = makeQuote({
        mode,
        input_amount: formStore.sellAmount,
        output_amount: formStore.receiveAmount,
      });
      comparisonStore.quotes = [quote];
      comparisonStore.recommendation = "0x";
      const view = render(AmountFields);
      const sell = view.getByLabelText("YOU SELL USDC") as HTMLInputElement;
      const receive = view.getByLabelText("YOU RECEIVE USDT") as HTMLInputElement;
      expect(sell.value).toBe(quote.input_amount);
      expect(receive.value).toBe(quote.output_amount);
      comparisonStore.isLoading = true;
      comparisonStore.isStale = true;
      await tick();
      expect(sell.value).toBe(quote.input_amount);
      expect(receive.value).toBe(quote.output_amount);
      expect(view.getByText("Previous estimate")).toBeVisible();
      comparisonStore.isLoading = false;
      comparisonStore.isStale = false;
      comparisonStore.quotes = [
        makeQuote({
          ...quote,
          input_amount: "4000.000000000000000001",
          output_amount: "1400.000000000000000002",
        }),
      ];
      await tick();
      expect(mode === "exactIn" ? receive.value : sell.value).toBe(
        mode === "exactIn" ? "1400.000000000000000002" : "4000.000000000000000001"
      );
      const otherMode = mode === "exactIn" ? "Exact Output" : "Exact Input";
      await fireEvent.click(view.getByRole("button", { name: otherMode }));
      expect(mode === "exactIn" ? formStore.receiveAmount : formStore.sellAmount).toBe(
        mode === "exactIn" ? "1400.000000000000000002" : "4000.000000000000000001"
      );
    }
  );

  it("does not show an old quote for another token pair", () => {
    formStore.fromToken = { address: TO, symbol: "USDT", decimals: 6 };
    formStore.toToken = { address: FROM, symbol: "USDC", decimals: 6 };
    comparisonStore.quotes = [makeQuote()];
    comparisonStore.recommendation = "0x";
    const view = render(AmountFields);
    expect((view.getByLabelText("YOU RECEIVE USDC") as HTMLInputElement).value).toBe("");
    expect(view.getByText("Waiting for quote")).toBeVisible();
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
