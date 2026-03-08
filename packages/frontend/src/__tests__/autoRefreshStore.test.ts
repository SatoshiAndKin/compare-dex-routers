import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { autoRefreshStore, AUTO_REFRESH_SECONDS } from '../lib/stores/autoRefreshStore.svelte.js';

// Reset store state between tests
function resetStore() {
  autoRefreshStore.stop();
}

describe('autoRefreshStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    resetStore();
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // AUTO_REFRESH_SECONDS constant
  // ---------------------------------------------------------------------------

  it('AUTO_REFRESH_SECONDS is 15 (matching original config)', () => {
    expect(AUTO_REFRESH_SECONDS).toBe(15);
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  it('is inactive initially', () => {
    expect(autoRefreshStore.active).toBe(false);
    expect(autoRefreshStore.countdown).toBe(0);
    expect(autoRefreshStore.paused).toBe(false);
    expect(autoRefreshStore.inFlight).toBe(false);
    expect(autoRefreshStore.errorMessage).toBe('');
  });

  // ---------------------------------------------------------------------------
  // start()
  // ---------------------------------------------------------------------------

  it('activates with correct countdown on start()', () => {
    const cb = vi.fn();
    autoRefreshStore.start(15, cb);

    expect(autoRefreshStore.active).toBe(true);
    expect(autoRefreshStore.countdown).toBe(15);
    expect(autoRefreshStore.paused).toBe(false);
    expect(autoRefreshStore.inFlight).toBe(false);
  });

  it('countdown decrements each second', () => {
    const cb = vi.fn();
    autoRefreshStore.start(5, cb);

    expect(autoRefreshStore.countdown).toBe(5);

    vi.advanceTimersByTime(1000);
    expect(autoRefreshStore.countdown).toBe(4);

    vi.advanceTimersByTime(1000);
    expect(autoRefreshStore.countdown).toBe(3);

    vi.advanceTimersByTime(1000);
    expect(autoRefreshStore.countdown).toBe(2);
  });

  it('fires callback when countdown reaches 0', () => {
    const cb = vi.fn();
    autoRefreshStore.start(3, cb);

    vi.advanceTimersByTime(3000);

    expect(cb).toHaveBeenCalledOnce();
  });

  it('does NOT fire callback before countdown reaches 0', () => {
    const cb = vi.fn();
    autoRefreshStore.start(5, cb);

    vi.advanceTimersByTime(4000); // 4 seconds — 1 short

    expect(cb).not.toHaveBeenCalled();
  });

  it('clears previous timer when start() is called again', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    autoRefreshStore.start(10, cb1);
    vi.advanceTimersByTime(3000); // 3 ticks

    // Start a new countdown — should cancel cb1's timer
    autoRefreshStore.start(5, cb2);
    expect(autoRefreshStore.countdown).toBe(5);

    vi.advanceTimersByTime(5000); // fire cb2
    expect(cb2).toHaveBeenCalledOnce();
    expect(cb1).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // stop()
  // ---------------------------------------------------------------------------

  it('stop() deactivates and resets state', () => {
    const cb = vi.fn();
    autoRefreshStore.start(10, cb);

    autoRefreshStore.stop();

    expect(autoRefreshStore.active).toBe(false);
    expect(autoRefreshStore.countdown).toBe(0);
    expect(autoRefreshStore.paused).toBe(false);
    expect(autoRefreshStore.inFlight).toBe(false);
  });

  it('stop() prevents the callback from firing', () => {
    const cb = vi.fn();
    autoRefreshStore.start(3, cb);

    vi.advanceTimersByTime(2000);
    autoRefreshStore.stop();

    vi.advanceTimersByTime(5000); // advance beyond original countdown
    expect(cb).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // pause() / resume()
  // ---------------------------------------------------------------------------

  it('pause() stops countdown decrement', () => {
    const cb = vi.fn();
    autoRefreshStore.start(10, cb);

    vi.advanceTimersByTime(2000); // countdown → 8
    autoRefreshStore.pause();

    expect(autoRefreshStore.paused).toBe(true);
    expect(autoRefreshStore.countdown).toBe(8);

    vi.advanceTimersByTime(5000); // should NOT decrement while paused
    expect(autoRefreshStore.countdown).toBe(8);
    expect(cb).not.toHaveBeenCalled();
  });

  it('resume() restarts countdown after pause', () => {
    const cb = vi.fn();
    autoRefreshStore.start(10, cb);

    vi.advanceTimersByTime(2000); // countdown → 8
    autoRefreshStore.pause();
    expect(autoRefreshStore.paused).toBe(true);

    vi.advanceTimersByTime(3000); // still paused — no decrement

    autoRefreshStore.resume();
    expect(autoRefreshStore.paused).toBe(false);
    expect(autoRefreshStore.countdown).toBe(8); // still 8 after resume

    vi.advanceTimersByTime(1000); // countdown → 7
    expect(autoRefreshStore.countdown).toBe(7);
  });

  it('resume() fires callback after enough ticks post-resume', () => {
    const cb = vi.fn();
    autoRefreshStore.start(5, cb);

    vi.advanceTimersByTime(2000); // countdown → 3
    autoRefreshStore.pause();

    vi.advanceTimersByTime(10000); // paused — no fire

    autoRefreshStore.resume();
    vi.advanceTimersByTime(3000); // 3 more ticks → fires callback

    expect(cb).toHaveBeenCalledOnce();
  });

  it('pause() on inactive store is a no-op', () => {
    expect(() => autoRefreshStore.pause()).not.toThrow();
    expect(autoRefreshStore.paused).toBe(false);
  });

  it('resume() when not paused is a no-op', () => {
    const cb = vi.fn();
    autoRefreshStore.start(10, cb);

    expect(autoRefreshStore.paused).toBe(false);
    expect(() => autoRefreshStore.resume()).not.toThrow();

    vi.advanceTimersByTime(1000);
    expect(autoRefreshStore.countdown).toBe(9); // still counting normally
  });

  // ---------------------------------------------------------------------------
  // reset()
  // ---------------------------------------------------------------------------

  it('reset() restarts the countdown from the given value', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    autoRefreshStore.start(10, cb1);
    vi.advanceTimersByTime(4000); // countdown → 6

    autoRefreshStore.reset(15, cb2);
    expect(autoRefreshStore.countdown).toBe(15);
    expect(autoRefreshStore.active).toBe(true);

    vi.advanceTimersByTime(15000);
    expect(cb2).toHaveBeenCalledOnce();
    expect(cb1).not.toHaveBeenCalled();
  });

  it('new manual compare resets the timer (stop then start)', () => {
    const autoRefreshCb = vi.fn();

    // Initial comparison starts auto-refresh
    autoRefreshStore.start(15, autoRefreshCb);
    vi.advanceTimersByTime(10000); // 10 seconds in

    // User triggers new comparison: stop the old timer
    autoRefreshStore.stop();
    expect(autoRefreshStore.active).toBe(false);
    expect(autoRefreshCb).not.toHaveBeenCalled();

    // After new comparison, start fresh timer
    const newCb = vi.fn();
    autoRefreshStore.start(15, newCb);
    expect(autoRefreshStore.countdown).toBe(15);

    vi.advanceTimersByTime(15000);
    expect(newCb).toHaveBeenCalledOnce();
    expect(autoRefreshCb).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // inFlight state
  // ---------------------------------------------------------------------------

  it('setInFlight(true) marks as in-flight', () => {
    autoRefreshStore.start(10, vi.fn());
    autoRefreshStore.setInFlight(true);
    expect(autoRefreshStore.inFlight).toBe(true);
  });

  it('countdown does NOT decrement while inFlight', () => {
    const cb = vi.fn();
    autoRefreshStore.start(5, cb);

    autoRefreshStore.setInFlight(true);
    vi.advanceTimersByTime(5000); // should be blocked by inFlight

    expect(autoRefreshStore.countdown).toBe(5); // not decremented
    expect(cb).not.toHaveBeenCalled();
  });

  it('countdown resumes after setInFlight(false)', () => {
    const cb = vi.fn();
    autoRefreshStore.start(5, cb);

    autoRefreshStore.setInFlight(true);
    vi.advanceTimersByTime(2000); // blocked

    autoRefreshStore.setInFlight(false);
    vi.advanceTimersByTime(5000); // now fires

    expect(cb).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // errorMessage
  // ---------------------------------------------------------------------------

  it('setErrorMessage sets the error message', () => {
    autoRefreshStore.setErrorMessage('Something went wrong');
    expect(autoRefreshStore.errorMessage).toBe('Something went wrong');
  });

  it('setErrorMessage with empty string clears the error', () => {
    autoRefreshStore.setErrorMessage('Error');
    autoRefreshStore.setErrorMessage('');
    expect(autoRefreshStore.errorMessage).toBe('');
  });

  it('stop() clears the error message', () => {
    autoRefreshStore.start(10, vi.fn());
    autoRefreshStore.setErrorMessage('Error');
    autoRefreshStore.stop();
    expect(autoRefreshStore.errorMessage).toBe('');
  });
});
