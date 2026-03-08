import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import App from '../App.svelte';

describe('App', () => {
  it('renders app shell', () => {
    const { getByText } = render(App);
    expect(getByText('Compare DEX Routers')).toBeTruthy();
  });
});
