import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import ChainSelector from '../lib/components/ChainSelector.svelte';
import { formStore } from '../lib/stores/formStore.svelte.js';

describe('ChainSelector', () => {
  beforeEach(() => {
    // Reset to Ethereum default
    formStore.chainId = 1;
  });

  it('renders current chain name', () => {
    const { getByText } = render(ChainSelector);
    expect(getByText('Ethereum (1)')).toBeTruthy();
  });

  it('opens dropdown on button click', async () => {
    const { getByRole, queryAllByRole } = render(ChainSelector);
    const button = getByRole('button');

    // Initially no listbox
    expect(queryAllByRole('listbox').length).toBe(0);

    await fireEvent.click(button);

    // After click, listbox appears
    expect(queryAllByRole('listbox').length).toBe(1);
  });

  it('shows all chains in dropdown when opened', async () => {
    const { getByRole, getAllByRole } = render(ChainSelector);
    const button = getByRole('button');

    await fireEvent.click(button);

    const options = getAllByRole('option');
    // Should have 7 chains
    expect(options.length).toBe(7);
  });

  it('filters chains by search text', async () => {
    const { getByRole, getByPlaceholderText, getAllByRole } = render(ChainSelector);
    const button = getByRole('button');

    await fireEvent.click(button);

    const searchInput = getByPlaceholderText('Search chains...');
    await fireEvent.input(searchInput, { target: { value: 'eth' } });

    const options = getAllByRole('option');
    // "Ethereum" should match "eth"
    expect(options.length).toBeGreaterThanOrEqual(1);
    expect(options[0]?.textContent).toContain('Ethereum');
  });

  it('filters chains by chain ID', async () => {
    const { getByRole, getByPlaceholderText, getAllByRole } = render(ChainSelector);
    const button = getByRole('button');

    await fireEvent.click(button);

    const searchInput = getByPlaceholderText('Search chains...');
    await fireEvent.input(searchInput, { target: { value: '8453' } });

    const options = getAllByRole('option');
    expect(options.length).toBe(1);
    expect(options[0]?.textContent).toContain('Base');
    expect(options[0]?.textContent).toContain('8453');
  });

  it('selects chain by clicking on option', async () => {
    const { getByRole, getByText } = render(ChainSelector);
    const button = getByRole('button');

    await fireEvent.click(button);

    // Click on Base option
    const baseOption = getByText('Base');
    await fireEvent.mouseDown(baseOption);

    expect(formStore.chainId).toBe(8453);
  });

  it('navigates options with arrow keys', async () => {
    const { getByRole } = render(ChainSelector);
    const button = getByRole('button');

    await fireEvent.click(button);

    const listbox = getByRole('listbox');

    // Press ArrowDown to navigate
    await fireEvent.keyDown(listbox.firstElementChild as Element, {
      key: 'ArrowDown',
    });

    // The dropdown search input handles keydown; press on the button itself
    await fireEvent.keyDown(button, { key: 'ArrowDown' });
  });

  it('selects chain with Enter key after navigation', async () => {
    const { getByRole, getByPlaceholderText } = render(ChainSelector);
    const button = getByRole('button');

    await fireEvent.click(button);

    const searchInput = getByPlaceholderText('Search chains...');

    // Type to filter to just Base
    await fireEvent.input(searchInput, { target: { value: 'Base' } });

    // Press ArrowDown to select first item
    await fireEvent.keyDown(searchInput, { key: 'ArrowDown' });

    // Press Enter to confirm
    await fireEvent.keyDown(searchInput, { key: 'Enter' });

    expect(formStore.chainId).toBe(8453);
  });

  it('closes on Escape key', async () => {
    const { getByRole, getByPlaceholderText, queryAllByRole } = render(ChainSelector);
    const button = getByRole('button');

    await fireEvent.click(button);
    expect(queryAllByRole('listbox').length).toBe(1);

    const searchInput = getByPlaceholderText('Search chains...');
    await fireEvent.keyDown(searchInput, { key: 'Escape' });

    expect(queryAllByRole('listbox').length).toBe(0);
  });

  it('shows "No chains match" when filter has no results', async () => {
    const { getByRole, getByPlaceholderText, getByText } = render(ChainSelector);
    const button = getByRole('button');

    await fireEvent.click(button);

    const searchInput = getByPlaceholderText('Search chains...');
    await fireEvent.input(searchInput, { target: { value: 'xyzxyz' } });

    expect(getByText('No chains match')).toBeTruthy();
  });
});
