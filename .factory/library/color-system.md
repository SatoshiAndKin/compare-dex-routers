# UI Color System

The app uses a brutalist color palette. All colors are bold and flat — no gradients, no shadows, no pastels.

## Accent Colors

| Color     | Hex       | Role                                 | Intended background | Verified contrast |
|-----------|-----------|--------------------------------------|---------------------|-------------------|
| Blue      | `#0055FF` | Primary CTA, links, tab underline    | `#fff`              | 4.56:1 ✅ AA       |
| Orange    | `#FF3300` | Alternative/secondary badge          | `#fff`              | 3.67:1 ❌ FAILS AA for small text — use `#CC2900` (5.0:1) instead |
| Green     | `#00AA00` | Success status text                  | `#e8e8e8`           | 2.54:1 ❌ FAILS AA — use `#007700` (4.7:1 on #e8e8e8) instead |
| Red       | `#CC0000` | Error / failure status               | `#fff`              | 5.91:1 ✅ AA       |

## Known WCAG AA Failures (to fix)

1. **`.result-recommendation.alternative` badge**: Uses `#FF3300` on `#fff` background. At 12px/bold, needs 4.5:1. Actual: 3.67:1. Fix: use `#CC2900` or darker.
2. **`.tx-status.success`**: Uses `#00AA00` text on `#e8e8e8` background. Actual: 2.54:1. Fix: use `#007700` for text, or change background to `#fff`.

## WCAG AA Thresholds

- Normal text (< 18px regular or < 14px bold): **4.5:1**
- Large text (≥ 18px regular or ≥ 14px bold): **3:1**
- 12px bold does NOT qualify as large text.

## Rules

- No gradients, no border-radius, no box-shadow
- Maximum 3 accent colors (blue, one warm, one status)
- Always verify contrast against the **actual** background color in the CSS, not white
- Status indicators must also have text labels (never rely on color alone to convey meaning)
