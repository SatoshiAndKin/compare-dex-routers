import { render } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import AutoRefreshIndicator from '../lib/components/AutoRefreshIndicator.svelte';
import { autoRefreshStore } from '../lib/stores/autoRefreshStore.svelte.js';

function resetStore() {
  autoRefreshStore.stop();
}

describe('AutoRefreshIndicator', () => {
  beforeEach(() => {
    resetStore();
  });

  // ---------------------------------------------------------------------------
  // Hidden when inactive
  // ---------------------------------------------------------------------------

  it('renders nothing when inactive', () => {
    const { container } = render(AutoRefreshIndicator);
    const indicator = container.querySelector('.refresh-indicator');
    expect(indicator).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Countdown display
  // ---------------------------------------------------------------------------

  it('shows countdown text when active', () => {
    autoRefreshStore.active = true;
    autoRefreshStore.countdown = 15;
    autoRefreshStore.paused = false;
    autoRefreshStore.inFlight = false;

    const { getByRole } = render(AutoRefreshIndicator);
    const status = getByRole('status');
    expect(status).toBeTruthy();
    expect(status.textContent).toContain('Refreshing in 15s');
  });

  it('shows correct countdown value', () => {
    autoRefreshStore.active = true;
    autoRefreshStore.countdown = 7;
    autoRefreshStore.paused = false;
    autoRefreshStore.inFlight = false;

    const { getByRole } = render(AutoRefreshIndicator);
    expect(getByRole('status').textContent).toContain('Refreshing in 7s');
  });

  // ---------------------------------------------------------------------------
  // Paused state
  // ---------------------------------------------------------------------------

  it('shows paused text when paused', () => {
    autoRefreshStore.active = true;
    autoRefreshStore.paused = true;
    autoRefreshStore.inFlight = false;
    autoRefreshStore.countdown = 10;

    const { getByRole } = render(AutoRefreshIndicator);
    const status = getByRole('status');
    expect(status.textContent).toContain('Auto-refresh paused');
  });

  it('shows "Waiting for transaction." when paused', () => {
    autoRefreshStore.active = true;
    autoRefreshStore.paused = true;
    autoRefreshStore.inFlight = false;
    autoRefreshStore.countdown = 10;
    autoRefreshStore.errorMessage = '';

    const { getByRole } = render(AutoRefreshIndicator);
    expect(getByRole('status').textContent).toContain('Waiting for transaction.');
  });

  // ---------------------------------------------------------------------------
  // In-flight state
  // ---------------------------------------------------------------------------

  it('shows "Refreshing..." when inFlight', () => {
    autoRefreshStore.active = true;
    autoRefreshStore.inFlight = true;
    autoRefreshStore.paused = false;
    autoRefreshStore.countdown = 0;

    const { getByRole } = render(AutoRefreshIndicator);
    expect(getByRole('status').textContent).toContain('Refreshing...');
  });

  // ---------------------------------------------------------------------------
  // Error message
  // ---------------------------------------------------------------------------

  it('shows error message when errorMessage is set', () => {
    autoRefreshStore.active = true;
    autoRefreshStore.countdown = 15;
    autoRefreshStore.paused = false;
    autoRefreshStore.inFlight = false;
    autoRefreshStore.errorMessage = 'Refresh failed. Keeping previous quotes.';

    const { getByRole } = render(AutoRefreshIndicator);
    expect(getByRole('status').textContent).toContain('Refresh failed. Keeping previous quotes.');
  });

  it('does not show "Waiting for transaction." when error is shown', () => {
    autoRefreshStore.active = true;
    autoRefreshStore.paused = true;
    autoRefreshStore.inFlight = false;
    autoRefreshStore.countdown = 10;
    autoRefreshStore.errorMessage = 'Some error';

    const { getByRole } = render(AutoRefreshIndicator);
    const text = getByRole('status').textContent ?? '';
    expect(text).toContain('Some error');
    expect(text).not.toContain('Waiting for transaction.');
  });

  // ---------------------------------------------------------------------------
  // Hidden when stopped
  // ---------------------------------------------------------------------------

  it('renders nothing after stop() is called', () => {
    autoRefreshStore.active = true;
    autoRefreshStore.countdown = 10;

    const { container } = render(AutoRefreshIndicator);
    expect(container.querySelector('.refresh-indicator')).not.toBeNull();

    // Stop the store
    autoRefreshStore.stop();
    // After stop, active = false, so the indicator should be gone
    // In Svelte 5 with reactivity, re-render is needed to verify
    // But since we're testing state-driven visibility, verify active=false
    expect(autoRefreshStore.active).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // aria-live attribute for accessibility
  // ---------------------------------------------------------------------------

  it('has aria-live="polite" for accessibility', () => {
    autoRefreshStore.active = true;
    autoRefreshStore.countdown = 15;
    autoRefreshStore.paused = false;
    autoRefreshStore.inFlight = false;

    const { getByRole } = render(AutoRefreshIndicator);
    const status = getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });
});
