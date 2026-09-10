/** State for the settings panel. Transactions use the connected wallet RPC. */
class SettingsStore {
  isSettingsOpen = $state(false);
  openSettings(): void {
    this.isSettingsOpen = true;
  }
  closeSettings(): void {
    this.isSettingsOpen = false;
  }
}
export const settingsStore = new SettingsStore();
