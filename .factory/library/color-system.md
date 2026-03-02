# UI Color System

The app uses a brutalist color palette. All colors are bold and flat — no gradients, no shadows, no pastels.

## Accent Colors (canonical, WCAG AA compliant)

| Color     | Hex       | Role                                 | Intended background | Verified contrast |
|-----------|-----------|--------------------------------------|---------------------|-------------------|
| Blue      | `#0055FF` | Primary CTA, links, tab underline    | `#fff`              | 4.56:1 ✅ AA       |
| Orange    | `#CC2900` | Alternative/secondary badge          | `#fff`              | 5.41:1 ✅ AA       |
| Green     | `#007700` | Success status text                  | `#e8e8e8`           | 4.71:1 ✅ AA       |
| Red       | `#CC0000` | Error / failure status               | `#fff`              | 5.91:1 ✅ AA       |

> **Note:** Earlier versions used `#FF3300` (3.67:1 on white ❌) and `#00AA00` (2.54:1 on #e8e8e8 ❌). Both were corrected in commit `4bbb562`. Do not use the old values.

## WCAG AA Thresholds

- Normal text (< 18px regular or < 14px bold): **4.5:1**
- Large text (≥ 18px regular or ≥ 14px bold): **3:1**
- 12px bold does NOT qualify as large text.

## Rules

- No gradients, no border-radius, no box-shadow
- Maximum 3 accent colors (blue, one warm, one status)
- Always verify contrast against the **actual** background color in the CSS, not white
- Status indicators must also have text labels (never rely on color alone to convey meaning)
