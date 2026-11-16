import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, beforeEach } from "vitest";
import ChainSelector from "../lib/components/ChainSelector.svelte";
import { formStore } from "../lib/stores/formStore.svelte.js";

describe("ChainSelector", () => {
  beforeEach(() => {
    formStore.chainId = 1;
  });

  it("shows only the chain name in the trigger and focuses search when it opens", async () => {
    const view = render(ChainSelector);
    const trigger = view.getByRole("button", { name: "Ethereum" });
    expect(view.queryByRole("listbox")).toBeNull();
    await fireEvent.click(trigger);
    expect(view.getByRole("combobox", { name: "Search chains" })).toHaveFocus();
    expect(view.getByRole("option", { name: "Ethereum (1)" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(view.getByRole("option", { name: "Arbitrum (42161)" })).toBeVisible();
  });

  it("filters by name or ID and selects a match with Enter", async () => {
    const view = render(ChainSelector);
    await fireEvent.click(view.getByRole("button"));
    const search = view.getByRole("combobox", { name: "Search chains" });
    await fireEvent.input(search, { target: { value: "XYZ" } });
    expect(view.getByRole("status")).toHaveTextContent("No chains match");
    await fireEvent.input(search, { target: { value: "ETH" } });
    expect(view.getAllByRole("option")).toEqual([
      view.getByRole("option", { name: "Ethereum (1)" }),
    ]);
    await fireEvent.input(search, { target: { value: "8453" } });
    expect(view.getAllByRole("option")).toEqual([
      view.getByRole("option", { name: "Base (8453)" }),
    ]);
    await fireEvent.keyDown(search, { key: "Enter" });
    expect(formStore.chainId).toBe(8453);
    expect(view.getByRole("button", { name: "Base" })).toHaveFocus();
    expect(view.queryByRole("listbox")).toBeNull();
  });

  it("moves the active option with arrows and cancels with Escape", async () => {
    const view = render(ChainSelector);
    const trigger = view.getByRole("button", { name: "Ethereum" });
    await fireEvent.click(trigger);
    const search = view.getByRole("combobox", { name: "Search chains" });
    await fireEvent.keyDown(search, { key: "ArrowDown" });
    await fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search).toHaveAttribute(
      "aria-activedescendant",
      view.getByRole("option", { name: "Base (8453)" }).id
    );
    await fireEvent.keyDown(search, { key: "Escape" });
    expect(formStore.chainId).toBe(1);
    expect(trigger).toHaveFocus();
    expect(view.queryByRole("listbox")).toBeNull();
  });

  it("dismisses a single search match without selecting it on an outside pointer press", async () => {
    const view = render(ChainSelector);
    await fireEvent.click(view.getByRole("button"));
    await fireEvent.input(view.getByRole("combobox"), { target: { value: "8453" } });
    await fireEvent.pointerDown(document.body);
    expect(formStore.chainId).toBe(1);
    expect(view.queryByRole("listbox")).toBeNull();
  });
});
