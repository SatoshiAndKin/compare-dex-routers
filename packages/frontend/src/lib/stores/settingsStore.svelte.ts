/** State for the settings panel. Transactions use the connected wallet RPC. */
class SettingsStore {
  isSettingsOpen = $state(false);
  focusCoinbaseFee = $state(false);
  openSettings(section?: "coinbase-fee"): void {
    this.focusCoinbaseFee = section === "coinbase-fee";
    this.isSettingsOpen = true;
  }
  closeSettings(): void {
    this.isSettingsOpen = false;
  }
}
export const settingsStore = new SettingsStore();
