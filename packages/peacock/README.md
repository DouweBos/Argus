# @argus/peacock

Peacock — the Argus design system. Dark-theme, glass-morphism component library used by the Argus desktop app and any future Argus surfaces.

## Install in another session package

```json
"dependencies": {
  "@argus/peacock": "workspace:*"
}
```

Then import tokens once at the app entry and components as needed:

```ts
import "@argus/peacock/tokens.css";
import { Button, SessionCard, TitleBar } from "@argus/peacock";
```

## Browse the system

```bash
pnpm --filter @argus/peacock storybook
```

Visit http://localhost:6006.

## Structure

- `src/styles/tokens.css` — all CSS custom properties (colors, type, spacing, shadows, radii)
- `src/icons/Icons.tsx` — 43 hand-rolled SVG icons + `ArgusLogo`
- `src/components/` — primitives (Button, Badge, Chip, Card, Input, Kbd, Eyebrow, DiffStat, ThinkingDots) + composites (TitleBar, SidebarNav, SessionCard, ChatInput, ToolCallRow, HomeCTA)
- `src/tokens/Tokens.stories.tsx` — token reference
