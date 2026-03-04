# CSS Audit Report: Inline Styles in `src/server.ts`

## Summary

The CSS is ~940 lines (lines 524–1464) inside a single `<style>` block in `INDEX_HTML`, plus ~12 inline `style=""` attributes scattered in HTML/JS. The overall direction is brutalist (high contrast, uppercase labels, no border-radius), but there are several inconsistencies and a few non-brutalist leftovers.

---

## 1. CSS Inconsistencies

### 1A. Border Width Inconsistencies (mixed 1px / 2px / 3px / 4px)

Primary structural borders alternate between `2px solid #000` and `1px solid #000` without a clear rule:

| Width | Selectors | Line(s) |
|-------|-----------|---------|
| **4px** | `.modal` (outer border), `label` border-left, `.slippage-label` border-left | 637, 550, 1089 |
| **3px** | `.wallet-address` border-left, `.refresh-indicator` border-left, `.tab.active` border-bottom | 1180, 1447, 1384 |
| **2px** | `input`/`select`, all buttons, modal header bottom, `.result-primary`, `.tx-actions` top, tabs container, `.details-toggle`, `.error-message`, `.mev-chain-message`, `.tokenlist-trust-warning`, `.unrecognized-token-info`, `.settings-section` bottom, `.tokenlist-toggle`, `.autocomplete-list`, `.wallet-provider-menu` | 558, 575, 596, 648, 690, 720, 827, 842, 946, 972, 1008, 1052, 1104, 1126, 1195, 1230, 1269, 1324, 1367, 1400, 1409, 1459 |
| **1px** | `.tokenlist-entry`, `.local-token-entry`, `.tokenlist-toggle::after`, `.unrecognized-token-address`, `.unrecognized-token-metadata`, `.settings-placeholder`, `.route-step`, `.refresh-indicator`, `.autocomplete-item` bottom, `.wallet-provider-option` bottom, `.settings-section-title` bottom, `.local-tokens-header` bottom, `.tx-status.error` | 773, 792, 854, 888, 957, 982, 1246, 1208, 1434, 1446, 1362 |

**Problem:** The distinction between 1px (secondary/inner) and 2px (primary/structural) is mostly consistent, but **border-left accents** use three different widths: 3px (`.wallet-address`, `.refresh-indicator`), 4px (`label`, `.slippage-label`), and 6px (`.result-primary` via `border-left-width: 6px`). These should all use the same width.

### 1B. Outline (Focus Ring) Inconsistencies

| Width | Selectors | Line(s) |
|-------|-----------|---------|
| **3px** | `input:focus`, `select:focus`, `button:focus`, `.mev-info-btn:focus`, `.settings-btn:focus`, `.add-to-wallet-btn:focus`, `.slippage-preset-btn:focus`, `.slippage-input-row input:focus` | 560, 579, 601, 729, 1060, 1113, 1128 |
| **2px** | `.modal-close:focus`, `.tokenlist-remove-btn:focus`, `.local-token-remove-btn:focus` | 668, 873, 925 |

**Problem:** Most elements get `outline: 3px solid #0055FF`, but three secondary buttons get `outline: 2px`. Should be uniform.

### 1C. Background Gray Shades (too many near-identical grays)

| Hex | Usage | Count |
|-----|-------|-------|
| `#f0f0f0` | hover states, disabled backgrounds, details-toggle bg, error tx-status bg | ~12 uses |
| `#f8f8f8` | mev-chain-message bg, settings-placeholder bg, unrecognized-token-metadata bg, details-content bg, error-message bg, reason box (inline) | ~6 uses |
| `#fafafa` | tokenlist-entry bg, local-token-entry bg, refresh-indicator bg | 3 uses |
| `#e8e8e8` | tx-status.success bg | 1 use |
| `#e0e0e0` | autocomplete-source bg, local-token-chain bg, wallet-provider-icon bg, autocomplete-logo bg, disabled tx-btn bg, spinner border | ~8 uses |
| `#ccc` | add-to-wallet-btn:disabled bg, tokenlist-toggle bg | 2 uses |

**Problem:** Six distinct gray shades (`#ccc`, `#e0e0e0`, `#e8e8e8`, `#f0f0f0`, `#f8f8f8`, `#fafafa`) for backgrounds that could be collapsed to 2–3 values. Brutalist design calls for fewer, more deliberate choices.

### 1D. Text Gray Shades

| Hex | Usage |
|-----|-------|
| `#666` | Placeholder text, secondary text, muted labels, field labels, hints, disabled text |
| `#999` | `.mev-chain-message.other` border, disabled `.tx-btn` border |
| `#856404` | `.tokenlist-trust-warning strong` |

**Problem:** `#666` is the workhorse muted color, but `#999` appears twice for completely different purposes (border colors, not text). `#856404` is a one-off warm brown only for the trust warning strong tag.

### 1E. `.btn-small.btn-secondary` Overrides `.btn-secondary`

- Line 1070–1073: `.btn-secondary { background: #000; color: #fff; }` → hover: `#333`
- Line 1152–1156: `.btn-small.btn-secondary { background: #666; border-color: #666; }` → hover: `#555`

**Problem:** Two visually different "secondary" buttons. The small variant is gray (#666) while the standard is black (#000). This creates an inconsistent secondary button identity.

### 1F. Mixed `border-left` Accent Widths

- `label`: `border-left: 4px solid #0055FF` (line 550)
- `.slippage-label`: `border-left: 4px solid #0055FF` (line 1089)
- `.wallet-address`: `border-left: 3px solid #0055FF` (line 1180)
- `.refresh-indicator`: `border-left: 3px solid #0055FF` (line 1447)
- `.result-primary`: `border-left-width: 6px` (line 1270)

**Problem:** The blue left-accent motif is used in three different widths (3px, 4px, 6px).

### 1G. Settings Section Border Uses `#e0e0e0` Instead of `#000`

- Line 742: `.settings-section { border-bottom: 2px solid #e0e0e0; }` — uses light gray
- Everything else structural uses `#000` for 2px borders

**Problem:** Inside the settings modal, section dividers use a soft gray `#e0e0e0` instead of the black borders used everywhere else at the same weight. This feels like a different design language.

---

## 2. Non-Brutalist Patterns

### 2A. `border-radius: 50%` (Spinner)

- Line 974: `.unrecognized-token-loading::before { border-radius: 50%; }`

**Assessment:** This is a loading spinner (circular element). A circle naturally requires border-radius. However, a brutalist alternative would be a text-only indicator (e.g., blinking `[LOADING...]`) or a square spinner. Acceptable exception, but noted.

### 2B. `transition: transform 0.15s` (Toggle Switch)

- Line 855: `.tokenlist-toggle::after { transition: transform 0.15s; }`

**Assessment:** Smooth animation on the toggle knob. Brutalist design favors instant state changes. Could be removed for a hard snap.

### 2C. `animation: spin 0.8s linear infinite` (Spinner)

- Line 975–978: Spinning animation for loading indicator.

**Assessment:** Same as 2A — functional animation for loading. Acceptable, but a text-based loading indicator would be more brutalist.

### 2D. `rgba(0, 0, 0, 0.7)` Semi-Transparent Overlay

- Line 624: `.modal-overlay { background: rgba(0, 0, 0, 0.7); }`

**Assessment:** Semi-transparency is a soft, modern UI pattern. A brutalist alternative would be `background: #000` (fully opaque) or no overlay at all.

### 2E. Soft Background Tints for States

- `#fff0f0` (error backgrounds) — lines 798, 1009
- `#fff8f0` (warning background) — line 949
- `#FFF3CD` (trust warning) — line 826

**Assessment:** Pastel-tinted backgrounds are decorative. Brutalist design would use plain white or plain black backgrounds with text/border color alone to convey state.

### 2F. Multiple Hover Background Transitions

All hover states use `#f0f0f0`, which is subtle. Brutalist design typically uses starker hover states (e.g., inverting to `background: #000; color: #fff`).

---

## 3. Inline `style=""` Attributes (Should Be in `<style>` Block)

| Line | Element | Inline Style |
|------|---------|--------------|
| 1503 | `#walletConnected` | `gap: 0.5rem` |
| 1507 | `#disconnectWalletBtn` | `font-size: 0.75rem; padding: 0.25rem 0.5rem` |
| 1562 | Submit button wrapper div | `margin-top: 1rem; padding-top: 0.75rem; border-top: 2px solid #000` |
| 1622 | Settings section title | `display: inline` |
| 3779 | Router calldata field value | `font-size: 0.625rem; word-break: break-all` |
| 3812 | Provider field | `margin-top: 0.5rem` |
| 3867 | Curve field | `margin-top: 0.5rem` |
| 3905–3909 | Reason box (JS-generated) | Full inline styles for padding, border, background, font-size, font-weight, etc. |

**Problem:** These bypass the stylesheet, making them harder to maintain and inconsistent with the CSS-class approach used everywhere else.

---

## 4. Recommended Consistent Values

### Borders
- **Structural (primary):** `2px solid #000`
- **Internal (secondary/dividers):** `1px solid #000`
- **Accent left-border:** `4px solid #0055FF` (standardize from current 3/4/6px mix)
- **Modal outer:** `4px solid #000` (keep as intentional emphasis)
- **Result card left accent:** `4px solid <accent-color>` (reduce from 6px to match)

### Focus Rings
- **All interactive elements:** `outline: 3px solid #0055FF; outline-offset: 0` (standardize; remove the 2px variants)

### Background Grays (collapse from 6 → 3)
- **Hover / interactive:** `#f0f0f0`
- **Content panels / secondary surfaces:** `#f0f0f0` (merge `#f8f8f8` and `#fafafa` into this)
- **Badges / icons / placeholder images:** `#e0e0e0`
- **Eliminate:** `#e8e8e8`, `#fafafa`, `#f8f8f8` as separate values

### Text Colors
- **Primary:** `#000`
- **Secondary/muted:** `#666`
- **On dark backgrounds:** `#fff`
- **Eliminate:** `#856404` (use `#CC7A00` or `#666` instead), `#999` (use `#666`)

### Semantic Colors
- **Accent (primary action):** `#0055FF` / hover `#0046CC`
- **Alternative/secondary accent:** `#CC2900`
- **Success:** `#007700`
- **Error:** `#CC0000`
- **Warning:** `#CC7A00`
- **Warning background:** Remove tinted backgrounds (`#fff0f0`, `#fff8f0`, `#FFF3CD`); use `#f0f0f0` + colored border instead

### Fonts
- **Body:** `system-ui, -apple-system, sans-serif` ✓ (already consistent)
- **Data/addresses/code:** `monospace` ✓ (already consistent)
- Comment says "max 2 fonts" — this is correctly followed.

### Button Styles (standardize to 3 variants)
- **Primary:** `background: #0055FF; color: #fff; border: 2px solid #0055FF`
- **Secondary:** `background: #000; color: #fff; border: 2px solid #000` (remove the `#666` small-secondary variant)
- **Default/tertiary:** `background: #fff; color: #000; border: 2px solid #000`
- **Small modifier:** Only changes `font-size` and `padding`, not colors

### Spacing (already mostly consistent, but document the scale)
- Padding: `0.5rem` (standard), `0.75rem` (generous), `1rem` (section)
- Margin-bottom: `0.25rem` (tight), `0.5rem` (standard), `0.75rem` (group), `1rem` (section)
- Gap: `0.25rem` (tight), `0.5rem` (standard), `1rem` (wide)

---

## 5. What a CSS Consolidation Pass Should Achieve

1. **Unify border-left accent width** to a single value (4px) across labels, wallet-address, refresh-indicator, and result cards.
2. **Standardize focus outlines** to `3px solid #0055FF` for all interactive elements (fix the three 2px outliers).
3. **Collapse background grays** from 6 shades to 2–3. Merge `#f8f8f8`/`#fafafa` into `#f0f0f0`; keep `#e0e0e0` for badges/icons only.
4. **Remove pastel state backgrounds** (`#fff0f0`, `#fff8f0`, `#FFF3CD`) and replace with neutral gray + colored border for a starker brutalist look.
5. **Fix `.btn-small.btn-secondary`** to inherit `.btn-secondary` colors (#000) instead of introducing a third gray (#666).
6. **Unify `.settings-section` border** from `#e0e0e0` to `#000` to match the rest of the structural borders.
7. **Extract inline `style=""` attributes** into named CSS classes (especially the JS-generated reason box and the disconnect button overrides).
8. **Optionally remove the toggle transition** (line 855) for instant state changes, and consider replacing the spinner animation with a text-based `[LOADING...]` indicator for full brutalist commitment.
9. **Remove `rgba(0,0,0,0.7)` modal overlay** in favor of solid `#000` or a simpler high-contrast approach.
10. **Eliminate one-off color `#856404`** and `#999` — map to existing palette colors.
