# Farcaster Miniapp Integration

## Package
`@farcaster/miniapp-sdk` loaded via CDN: `https://esm.sh/@farcaster/miniapp-sdk`

## Manifest
Serve at `GET /.well-known/farcaster.json`:
```json
{
  "accountAssociation": { "header": "...", "payload": "...", "signature": "..." },
  "miniapp": {
    "version": "1",
    "name": "FlashProfits",
    "homeUrl": "https://yourapp.com/?miniApp=true",
    "iconUrl": "https://yourapp.com/icon.png",
    "primaryCategory": "finance"
  }
}
```
Account association fields from env vars: FARCASTER_ACCOUNT_ASSOCIATION_HEADER, _PAYLOAD, _SIGNATURE.

## HTML Meta Tag
```html
<meta name="fc:miniapp" content='{"version":"1","imageUrl":"...","button":{"title":"Compare DEX","action":{"type":"launch_frame","name":"FlashProfits","url":"..."}}}' />
```

## Dual-Mode Detection
```js
const { sdk } = await import('https://esm.sh/@farcaster/miniapp-sdk');
const isMiniApp = await sdk.isInMiniApp();
if (isMiniApp) {
  sdk.actions.ready(); // dismiss splash
  const provider = sdk.wallet.getEthereumProvider(); // built-in wallet
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
