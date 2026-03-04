# WalletConnect Integration Research

## Recommendation: `@walletconnect/ethereum-provider` with `showQrModal: true`

### How It Fits
- App uses ERC-6963 for browser extension wallets, raw EIP-1193 `provider.request()` calls
- WalletConnect's `EthereumProvider` is EIP-1193 compliant - drops into existing `connectToWalletProvider()` flow
- No client-side viem needed (server-side only)

### Loading Strategy (no bundler)
Since the app has no build step (tsx runs server-side only), load via ESM CDN:
```html
<script type="module">
  const { EthereumProvider } = await import('https://esm.sh/@walletconnect/ethereum-provider@2');
  window.__WalletConnectProvider = EthereumProvider;
</script>
```

### Integration Code
```js
const provider = await EthereumProvider.init({
  projectId: 'YOUR_PROJECT_ID',
  optionalChains: [1, 8453, 42161, 10, 137, 56, 43114],
  metadata: {
    name: 'Compare DEX Routers',
    description: 'Compare quotes from multiple DEX routers',
    url: 'https://yourapp.com',
    icons: ['https://yourapp.com/icon.png']
  },
  showQrModal: true
});
await provider.connect();
connectToWalletProvider(provider, { uuid: 'walletconnect', name: 'WalletConnect', icon: '...', rdns: 'walletconnect' });
```

### Setup
1. Go to https://dashboard.reown.com/
2. Create project, copy Project ID
3. Add as `WALLETCONNECT_PROJECT_ID` env var
4. Server injects into HTML template

### Key Points
- Adds ~200-500KB client-side JS (provider + WebSocket + crypto polyfills)
- Free tier available
- `showQrModal: true` provides built-in QR modal
- Mobile wallets (MetaMask Mobile, Rainbow, Trust, etc.) connect via QR scan
- Requires HTTPS in production (localhost exempt for dev)
