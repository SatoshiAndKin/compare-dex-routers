# Farcaster Miniapp Integration

## Package
`@farcaster/miniapp-sdk` 0.3.0 is bundled by Vite and loaded on demand.

## Manifest
Serve at `GET /.well-known/farcaster.json`:
```json
{
  "accountAssociation": { "header": "...", "payload": "...", "signature": "..." },
  "miniapp": {
    "version": "1",
    "name": "Compare DEX Routers",
    "homeUrl": "https://yourapp.com/?miniApp=true",
    "iconUrl": "https://yourapp.com/icon.png",
    "primaryCategory": "finance"
  }
}
```
Account association fields from env vars: FARCASTER_ACCOUNT_ASSOCIATION_HEADER, _PAYLOAD, _SIGNATURE.

## HTML Meta Tag
```html
<meta name="fc:miniapp" content='{"version":"1","imageUrl":"...","button":{"title":"Compare DEX","action":{"type":"launch_frame","name":"Compare DEX Routers","url":"..."}}}' />
```

## Dual-Mode Detection
```js
const { sdk } = await import('@farcaster/miniapp-sdk');
const isMiniApp = await sdk.isInMiniApp();
if (isMiniApp) {
  sdk.actions.ready(); // dismiss splash
  const provider = await sdk.wallet.getEthereumProvider(); // built-in wallet
}
```

## Viewport
- Mobile: full device
- Web: 424x695px fixed
- Safe area insets: `sdk.context.client.safeAreaInsets`

## Key Rules
- Only load SDK conditionally (detect miniapp context first)
- In miniapp: bypass ERC-6963/WalletConnect, use SDK wallet directly
- In browser: all existing behavior unchanged, no SDK side effects
