/**
 * Auto-refresh store for periodic quote updates.
 *
 * Ported from src/client/auto-refresh.ts.
 * Manages countdown timer, pause/resume for transactions, and refresh cycle.
 * AUTO_REFRESH_SECONDS matches the original (15 seconds).
 */

export const AUTO_REFRESH_SECONDS = 15;

class AutoRefreshStore {
  countdown = $state(0);
  active = $state(false);
  paused = $state(false);
  inFlight = $state(false);
  errorMessage = $state('');

  private timerId: ReturnType<typeof setInterval> | null = null;
  private onRefreshCallback: (() => void) | null = null;

  /**
   * Start countdown timer. Calls onRefresh when countdown reaches 0.
   * Cancels any in-progress countdown first.
   */
  start(seconds: number, onRefresh: () => void): void {
    this._clearTimer();
    this.onRefreshCallback = onRefresh;
    this.countdown = seconds;
    this.active = true;
    this.paused = false;
    this.inFlight = false;
    this.errorMessage = '';
    this._startTimer();
  }

  /** Stop auto-refresh and clear all state. */
  stop(): void {
    this._clearTimer();
    this.countdown = 0;
    this.active = false;
    this.paused = false;
    this.inFlight = false;
    this.errorMessage = '';
    this.onRefreshCallback = null;
  }

  /** Pause the countdown (e.g., during a transaction). */
  pause(): void {
    if (!this.active || this.paused) return;
    this.paused = true;
    this._clearTimer();
  }

  /** Resume the countdown after a pause. */
  resume(): void {
    if (!this.active || !this.paused) return;
    this.paused = false;
    this._startTimer();
  }

  /**
   * Reset the countdown with a new duration and callback.
   * Equivalent to stop() + start().
   */
  reset(seconds: number, onRefresh: () => void): void {
    this.start(seconds, onRefresh);
  }

  /**
   * Signal that an auto-refresh fetch is in progress.
   * The countdown is paused visually while inFlight is true.
   */
  setInFlight(value: boolean): void {
    this.inFlight = value;
  }

  /**
   * Set an error message to display in the refresh indicator.
   * Pass empty string to clear.
   */
  setErrorMessage(msg: string): void {
    this.errorMessage = msg;
  }

  private _clearTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private _startTimer(): void {
    this._clearTimer();
    this.timerId = setInterval(() => {
      // Skip tick if paused or a refresh is in-flight
      if (this.paused || this.inFlight) return;

      this.countdown -= 1;

      if (this.countdown <= 0) {
        this._clearTimer();
        const cb = this.onRefreshCallback;
        if (cb) {
          cb();
        }
      }
    }, 1000);
  }
}

export const autoRefreshStore = new AutoRefreshStore();
