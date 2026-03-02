# Security & Privacy Notes

Future considerations for the tokenlist management system.

---

## localStorage Privacy Concern

Custom tokenlist URLs and locally saved tokens are stored in localStorage in plaintext. This reveals the user's token interests and trading patterns to anyone with access to the browser.

**Potential mitigation:** Encrypt the localStorage data with the user's wallet signature. However, this is cumbersome for users with multiple wallet addresses — they'd need to decrypt/re-encrypt when switching wallets.

**Status:** Deferred to future mission. Needs design work on key management for multi-address users.
