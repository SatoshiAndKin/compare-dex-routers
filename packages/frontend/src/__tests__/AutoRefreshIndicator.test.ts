import { render } from "@testing-library/svelte";
import { describe, it, expect, beforeEach } from "vitest";
import AutoRefreshIndicator from "../lib/components/AutoRefreshIndicator.svelte";
import { autoRefreshStore } from "../lib/stores/autoRefreshStore.svelte.js";

describe("AutoRefreshIndicator", () => {
  beforeEach(() => {
    autoRefreshStore.stop();
  });

  it.each([
    { active: false, paused: false, loading: false, text: "—" },
    { active: true, paused: false, loading: false, text: "7s" },
    { active: true, paused: true, loading: false, text: "Paused" },
    { active: true, paused: true, loading: true, text: "…" },
  ])("shows $text in the countdown slot", ({ active, paused, loading, text }) => {
    autoRefreshStore.active = active;
    autoRefreshStore.paused = paused;
    autoRefreshStore.countdown = 7;
    const { getByRole } = render(AutoRefreshIndicator, {
      label: "Refresh DEX quotes",
      timerLabel: "DEX auto-refresh",
      loading,
    });
    expect(getByRole("timer", { name: "DEX auto-refresh" })).toHaveTextContent(text);
    expect(getByRole("button", { name: "Refresh DEX quotes" })).toHaveAttribute(
      "aria-disabled",
      String(loading)
    );
  });
});
