import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import SlippagePresets from '../lib/components/SlippagePresets.svelte';
import { formStore } from '../lib/stores/formStore.svelte.js';

describe('SlippagePresets', () => {
  beforeEach(() => {
    // Reset to default
    formStore.slippageBps = 50;
  });

  it('renders all preset buttons (3, 10, 50, 100, 300 bps)', () => {
    const { getByText } = render(SlippagePresets);

    // Presets are displayed as percentages: 3→0.03%, 10→0.1%, 50→0.5%, 100→1%, 300→3%
    expect(getByText('0.03%')).toBeTruthy();
    expect(getByText('0.1%')).toBeTruthy();
    expect(getByText('0.5%')).toBeTruthy();
    expect(getByText('1%')).toBeTruthy();
    expect(getByText('3%')).toBeTruthy();
  });

  it('shows 50 bps as default active preset', () => {
    const { getByText } = render(SlippagePresets);

    const btn50 = getByText('0.5%');
    expect(btn50.closest('button')?.classList.contains('active')).toBe(true);
  });

  it('clicking preset updates formStore.slippageBps', async () => {
    const { getByText } = render(SlippagePresets);

    const btn100 = getByText('1%');
    await fireEvent.click(btn100);

    expect(formStore.slippageBps).toBe(100);
  });

  it('clicking 3 bps preset sets slippage to 3', async () => {
    const { getByText } = render(SlippagePresets);

    await fireEvent.click(getByText('0.03%'));
    expect(formStore.slippageBps).toBe(3);
  });

  it('clicking 300 bps preset sets slippage to 300', async () => {
    const { getByText } = render(SlippagePresets);

    await fireEvent.click(getByText('3%'));
    expect(formStore.slippageBps).toBe(300);
  });

  it('selected preset button has active class', async () => {
    const { getByText } = render(SlippagePresets);

    // Click 10 bps
    const btn10 = getByText('0.1%');
    await fireEvent.click(btn10);

    // 0.1% button should now be active
    expect(btn10.closest('button')?.classList.contains('active')).toBe(true);

    // 0.5% button should no longer be active
    const btn50 = getByText('0.5%');
    expect(btn50.closest('button')?.classList.contains('active')).toBe(false);
  });

  it('custom input updates slippage to custom value', async () => {
    const { getByPlaceholderText } = render(SlippagePresets);

    const customInput = getByPlaceholderText('Custom bps');
    await fireEvent.input(customInput, { target: { value: '75' } });

    expect(formStore.slippageBps).toBe(75);
  });

  it('custom input deactivates preset buttons', async () => {
    const { getByPlaceholderText, getByText } = render(SlippagePresets);

    const customInput = getByPlaceholderText('Custom bps');
    await fireEvent.input(customInput, { target: { value: '75' } });

    // None of the presets should be active
    const btn50 = getByText('0.5%');
    expect(btn50.closest('button')?.classList.contains('active')).toBe(false);

    const btn100 = getByText('1%');
    expect(btn100.closest('button')?.classList.contains('active')).toBe(false);
  });

  it('clearing custom input reverts to default 50 bps', async () => {
    const { getByPlaceholderText } = render(SlippagePresets);

    const customInput = getByPlaceholderText('Custom bps');
    await fireEvent.input(customInput, { target: { value: '75' } });
    expect(formStore.slippageBps).toBe(75);

    // Clear custom input
    await fireEvent.input(customInput, { target: { value: '' } });
    expect(formStore.slippageBps).toBe(50);
  });

  it('shows current slippage value in bps and percentage', () => {
    const { getByText } = render(SlippagePresets);

    // Default 50 bps = 0.50%
    expect(getByText(/50 bps/)).toBeTruthy();
    expect(getByText(/0.50%/)).toBeTruthy();
  });
});
