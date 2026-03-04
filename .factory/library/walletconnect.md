# WalletConnect Integration

## Package
`@walletconnect/ethereum-provider` loaded via ESM CDN: `https://esm.sh/@walletconnect/ethereum-provider@2`

## Key Integration Points
- EIP-1193 compliant — drops into existing `connectToWalletProvider(provider, info)` flow
- `showQrModal: true` provides built-in QR code modal
- New env var: `WALLETCONNECT_PROJECT_ID` (from https://dashboard.reown.com/)

## Code Pattern
```js
const { EthereumProvider } = await import('https://esm.sh/@walletconnect/ethereum-provider@2');
const provider = await EthereumProvider.init({
  projectId: WALLETCONNECT_PROJECT_ID,
  optionalChains: [1, 8453, 42161, 10, 137, 56, 43114],
  metadata: { name: 'Compare DEX Routers', description: '...', url: location.origin, icons: [] },
  showQrModal: true
});
await provider.connect();
connectToWalletProvider(provider, { uuid: 'walletconnect', name: 'WalletConnect', icon: '...', rdns: 'walletconnect' });
```

## Disconnect
```js
provider.on('disconnect', () => disconnectWallet());
```

## Without Project ID
Hide WC option or show friendly error. No unhandled exceptions.
