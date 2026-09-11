import { beforeEach, describe, expect, it } from "vitest";
import { settingsStore } from "../lib/stores/settingsStore.svelte.js";
describe("wallet RPC settings guidance", () => {
  beforeEach(() => settingsStore.closeSettings());
  it("opens and closes the settings dialog", () => {
    expect(settingsStore.isSettingsOpen).toBe(false);
    settingsStore.openSettings();
    expect(settingsStore.isSettingsOpen).toBe(true);
    settingsStore.closeSettings();
    expect(settingsStore.isSettingsOpen).toBe(false);
  });
});
