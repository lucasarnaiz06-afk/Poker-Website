# Design system

Goal: very clean, calm, readable. Think Linear / Vercel dashboard quality applied to poker. Users should understand
any screen at a glance; advanced info is one click away, never in the way.

## Tokens (CSS variables in `client/app/globals.css`, Tailwind names in `client/tailwind.config.ts`)
- Surfaces: `bg` (page), `surface` (cards/panels), `surface-2` (inputs, hovers), `surface-3` (pressed/selected), `line` (1px borders).
- Text: `fg` (primary), `muted` (secondary), `subtle` (tertiary/placeholders).
- Intent: `accent` emerald (primary actions, your turn, positive money), `accent-fg` text on accent, `gold` (chips, pot,
  winners), `danger` (fold, losses, destructive), `warning`, `info`.
- Table: `felt`, `felt-dark` (radial gradient felt), `rail` (table edge).
- Cards: `suit-red`, `suit-black`; 4-colour deck uses `suit-blue` (diamonds) and `suit-green` (clubs).
- Dark theme is default; `[data-theme="light"]` exists for pages outside the table.
- Font: Inter via `next/font` exposed as `--font-sans`; JetBrains Mono as `--font-mono`. Use `.tabular` for all chip amounts.
  The pixel font (`font-pixel`) and the pixel card PNGs in `/public/cards` are an optional "Classic pixel" deck style only.

## Rules
- Spacing on a 4 px grid; panels `rounded-xl border border-line bg-surface`; inputs `rounded-lg bg-surface-2`.
- One primary action per view. Destructive actions confirm.
- Money: positive `text-accent`, negative `text-danger`, format with thousands separators; show BB equivalents where useful.
- Motion: 150-250 ms ease-out; respect `prefers-reduced-motion`. No bouncing, no gimmicks.
- Accessibility: visible focus rings, 4.5:1 contrast, every icon button has an `aria-label`, keyboard shortcuts for table actions
  (F fold, C check/call, R raise/bet, Enter confirm, Esc cancel) shown as hints.
- Empty, loading and error states for every data view (skeletons, not spinners, for page loads).
- Responsive: works at 375 px (phone portrait); the table reflows to a vertical oval on narrow screens.
