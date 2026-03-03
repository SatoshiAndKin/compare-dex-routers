# Farcaster Mini App SDK Research

## What It Is
Mini Apps are web apps that render inside Farcaster clients (Warpcast, Coinbase Wallet) via WebView/iframe.

## Key Package
- Client: `@farcaster/miniapp-sdk` (v0.2.3, CDN: `https://esm.sh/@farcaster/miniapp-sdk`)
- Server: `@farcaster/frame-node` (optional, for webhook verification)

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
The `accountAssociation` is generated via https://farcaster.xyz/~/developers/new

## Embed Meta Tags
```html
<meta name="fc:miniapp" content='{"version":"1","imageUrl":"...","button":{"title":"Compare DEX","action":{"type":"launch_frame","name":"FlashProfits","url":"..."}}}' />
```

## Wallet Integration
```js
const provider = sdk.wallet.getEthereumProvider(); // EIP-1193 provider
```
Inside Farcaster, the host provides the wallet context automatically.
Also has `sdk.actions.swapToken()` to delegate to host's native swap UI.

## Viewport
- Mobile: full device dimensions
- Web: 424x695px fixed (must be responsive at this width)
- Safe area insets available via `sdk.context.client.safeAreaInsets`

## Dual-Mode Pattern
```js
import { sdk } from '@farcaster/miniapp-sdk';
const isMiniApp = await sdk.isInMiniApp();
if (isMiniApp) {
  sdk.actions.ready(); // dismiss splash screen
  // Use sdk.wallet.getEthereumProvider() for wallet
} else {
  // Normal browser behavior
}
```

## Integration Steps for Our App
1. Add `GET /.well-known/farcaster.json` route
2. Add `<meta name="fc:miniapp">` to HTML head
3. Conditional inline JS: detect miniapp context, call `sdk.actions.ready()`, use SDK wallet
4. Respect viewport constraints (424x695px responsive)

## Setup Required (User)
1. Enable Developer Mode at https://farcaster.xyz/~/settings/developer-tools
2. Generate domain association at https://farcaster.xyz/~/developers/new
3. Host manifest at /.well-known/farcaster.json
