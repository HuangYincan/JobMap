---
name: frontend-component-dev
description: Guide for developing React components following Domain Map conventions and architecture.
---

# Frontend Component Development

Develop Next.js 15 + React 19 components following Domain Map's architecture principles.

## Before Starting

1. **Check Architecture Alignment**
   - Review `tech/01-architecture.md` for patterns
   - Verify component fits "everything is a plugin" vision
   - Identify extension points for future plugins

2. **Understand Constraints**
   - Phase 1: No API calls, use mock data
   - Phase 2: API integration via App Router
   - No direct database access from client
   - Type safety: strict TypeScript mode

3. **Read Existing Patterns**
   - Study `src/components/map-shell.tsx` for conventions
   - Primary rail is collapsed-first: no brand wordmark. Collapsed search is a ghost nav icon (same 42px hit as Layers), not a filled chip. The menu control uses a sidebar glyph when collapsed and a chevron when open, and slides to the right of the rail as it expands. Typing in search sets `query` and opens Explore.
   - POI detail lives in `poi-detail.tsx` and covers the list inside the secondary sidebar. Domain photos use a carousel (arrows + dots), not a raw strip.
   - Job detail is a third panel (`jd-panel.tsx`) in the same flex cluster as Explore, 6px to the right. Do not nest JD inside the secondary sidebar, and do not absolutely position it at a fixed left (that clips on narrower windows). On viewports ≤767px the desktop rail and L2/L3 clusters hide. The bottom drawer owns search, ModeSwitcher, FilterPanel, SortSelector, POIList, POIDetailView, JdPanel, and SavedList (same compare table as desktop Saved L2) stacked in the same `--soft-strong` sheet (mini/half/full). Do not mount a second desktop Explore on mobile.
   - Liquid glass (pale fill, blur + saturate, inset highlight, hover more transparent) applies to **POI cards and job rows only**. L2 Explore / L3 JD **panel chrome** stays `--soft-strong` frost (~0.84–0.90 light, ~0.84–0.88 dark). Do not re-transparentize the shells.
   - UI chrome is always brand blue `#007AFF` across modes (hover, back, Apply, selected job, recruitment markers). 12px text on frost (chips, text buttons) uses `--blue-ink` `#0062CC` so it meets WCAG AA. Keep green only for semantic values (`--green` `#1B7F3A` salary and hours).
   - Domain POIs accumulate in a catalog (soft cap 300). Panning the map does not refetch. Each mode’s catalog lives in browser `sessionStorage` (`lib/mode-cache.ts`) — switching Domain ↔ Work restores the pool and does not re-hit AMap. Only the blue refresh icon clears that mode’s cache and researches. Result header: blue refresh icon next to the count; blue plus icon on the right adds ~300 more points. Distances always use the user location, falling back to the map center only if geolocation is missing. When the distance slider is set, draw a brand-blue `#007AFF` buffer circle on that same origin (`distanceFilterMeters`) with an east-edge handle that resizes the radius and snaps back to the 0.5km slider. Search is one `searchNearBy` from the user location by default; refresh pins the origin to the current view center. Radius is map-scale × 30 (over 50km falls back to AMap default 3000m). Serialize at 3 req/s. Do not fan out a 16-cell grid.
   - Map modes are Map + Work only. Intern / campus / social (and their leaves) live in `job-taxonomy.ts` as FilterPlugins on work.filters. District is `DISTRICT_PLUGIN` in `spatial-filters.ts` (address match today, PostGIS later). New industries add a plugin; do not add a new map mode. Mode switcher is icon-only: no label, no selected-state dot. Names stay in `title` / `aria-label`.
   - Default map mode is **work** (logged-in preference or guest). Language: logged-in preference, else browser.
   - Primary rail has no Settings item. Profile is a normal row (no persisted selected plate). Login/logout glyph stays ink, not blue. Profile L2 is `--soft-strong` frost in the same cluster as Explore: centered avatar (click → crop card), Update Profile green button, divider, then option boxes for language, default map, career prefs (status / families / industries / strengths) and notification toggles. Do not open a third panel for prefs. Guest copy is 未登录 / Not signed in + a person icon; signed-in `<strong>` is display name, `<small>` is phone or email (OAuth uses email).
   - Login is a centered split glass card (animated overlay orbs + left promo, close X + click outside). Method tabs are 手机 / 邮箱 / 其他登录: selected = blue underline, hover = lighter blue without underline. OTP send is a text button inside the input. Primary button is green 登录. Other contains GitHub / Google / X / WeChat via `POST /api/auth/oauth`. Keep `POST /api/auth/otp/send` for Aliyun SMS later. Never print or commit `.env` secrets. Green is allowed on Sign in / Update Profile / Save crop; everywhere else keep `#007AFF` chrome (small text uses `--blue-ink`).
   - Recent is **search history only** (committed queries / picked suggestions), persisted per account in the database. Guest recents stay empty or session-only — do not fake a cloud history. Picking a row goes through `replayRecentSearch` then `handleModeChange` so the current catalog is written to sessionStorage first; internship aliases to work.
   - Saved is the same contract for places/companies (`saved_places` / `/api/me/saved`). Guests who tap Saved or the detail bookmark open login; never invent a local cloud list. Detail `onToggleSave` writes the current POI snapshot (id, name, mode, kind, lng/lat). Company compare lives **inside Saved L2**: pick two recruitment rows, `lib/compare-saved.ts` builds the table from catalog/seed (snapshot fallback). Do not open a fourth panel. Layers opens an L2 frost card (`layers-panel.tsx`) with the saved overlay toggle (`lib/saved-overlay.ts`) and basemap styles. Overlay and style both persist in sessionStorage (`saved-overlay` / `map-style`). A user-picked style is not overwritten by system dark/light. Clicking a saved row flies via `resolveSavedForFly` + `setZoomAndCenter` (live catalog/seed first). Do not put the overlay switch on the rail itself, and do not keep a second basemap picker on the map chrome. Guests who flip the overlay open login.

   - Applications are the same contract (`applications` / `/api/me/applications`). JD Apply (`onApply`) records the click then follows the real URL. List them in Profile L2, not a fourth panel. Guests open login.
   - Job alerts (`notifications` / `/api/me/notifications`) respect Profile email/SMS toggles but only enqueue an in-account inbox this phase. Matching is `lib/job-alerts.ts` against career prefs + seed. Do not call Aliyun SMS or a mail provider. List queued items in Profile L2 under 岗位提醒.
   - Search tokens starting with `#` are filter plugins (`#大厂` → scale, `#互联网` → industry, `#秋招` → jobTaxonomy). Unknown tags stay in the keyword. Combine with leftover text via `parseSearchQuery` / `runPOIPipeline`. Empty search and empty Recent show `trendingForMode(mode)` chips — add new modes there, not inline in the panel.
   - Recruitment logos: prefer the career-site / subsidiary icon for that office; fall back to a curated company icon; then emoji. One company has many sites; one position has exactly one site. New sources implement `RecruitmentAdapter` in `lib/recruitment-adapters/` and register in `poi-service` — do not hardcode a second fetch path.
   - Check `src/lib/` for utilities (i18n, constants)
   - Review CSS approach (CSS Modules + custom properties)

## Component Structure

```typescript
"use client";  // If using hooks or browser APIs

import { useEffect, useState } from "react";
import styles from "./component-name.module.css";
import { t } from "@/lib/i18n";
import { CONSTANTS } from "@/lib/constants";

type ComponentProps = {
  // Props interface
};

export function ComponentName({ prop }: ComponentProps) {
  // State
  const [state, setState] = useState(initial);

  // Effects with cleanup
  useEffect(() => {
    // Side effects
    return () => {
      // Cleanup
    };
  }, [dependencies]);

  // Event handlers
  const handleEvent = () => {
    // Logic
  };

  // Render
  return (
    <div className={styles.container}>
      {/* JSX */}
    </div>
  );
}
```

## Styling Guidelines

### CSS Modules
- One `.module.css` per component
- Use semantic class names (`.container`, `.header`, not `.mt-4`)
- Leverage CSS custom properties from `globals.css`

```css
/* component.module.css */
.container {
  background: var(--soft);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.title {
  color: var(--ink);
  font-size: 16px;
  font-weight: 600;
}
```

### Custom Properties (globals.css)
```css
--soft: rgba(255, 255, 255, 0.58);
--ink: rgb(31, 41, 55);
--muted: rgb(107, 114, 128);
--blue: rgb(0, 122, 255);
--shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
--radius: 12px;
```

### Responsive Design
```css
/* Mobile-first approach */
.container {
  padding: 12px;
}

@media (min-width: 768px) {
  .container {
    padding: 24px;
  }
}
```

### Dark Mode
```css
/* Automatic via prefers-color-scheme */
@media (prefers-color-scheme: dark) {
  .container {
    background: rgba(28, 28, 30, 0.72);
  }
}
```

## Animation Standards

Follow Apple design principles:

```css
.element {
  transition: width 0.35s cubic-bezier(0.32, 0.72, 0, 1);
}
```

**Timing:**
- Fast: 200-250ms (fade, small movements)
- Standard: 300-350ms (width, height, scale)
- Slow: 400-500ms (complex choreography)

**Easing:** `cubic-bezier(0.32, 0.72, 0, 1)` for smooth ease-out

**Choreography:** Sequence animations for polish
- Exit → Transform → Enter (collapse/expand pattern)
- Use delays for staggered effects

## TypeScript Practices

### Strict Mode
```typescript
// tsconfig.json already has strict: true
// No implicit any, proper null checks

// Good
const value: string | null = getValue();
if (value !== null) {
  use(value);
}

// Bad (will error)
const value = getValue();
use(value);  // Error if getValue can return null
```

### Type Imports
```typescript
import type { Language } from "@/lib/i18n";  // Type-only import
```

### Props Interface
```typescript
interface ButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}

export function Button({ label, onClick, disabled = false }: ButtonProps) {
  // ...
}
```

## Internationalization

```typescript
import { t, type Language } from "@/lib/i18n";

// In component
const [lang, setLang] = useState<Language>('en');

<button>{t('save', lang)}</button>
```

Add new keys to `src/lib/i18n.ts`:
```typescript
const translations = {
  en: {
    save: "Save",
    newKey: "New Text",
  },
  zh: {
    save: "保存",
    newKey: "新文本",
  },
};
```

## Accessibility Checklist

- [ ] Semantic HTML (`<button>`, `<nav>`, `<aside>`)
- [ ] ARIA labels on icons/controls: `aria-label="Save map"`
- [ ] Keyboard accessible: all interactive elements are `<button>` or have `tabIndex`
- [ ] Focus visible: don't disable outline without replacement
- [ ] Color contrast: text meets WCAG AA (4.5:1)
- [ ] Screen reader friendly: use `aria-live` for dynamic updates

## Performance

### Avoid Re-renders
```typescript
// Memoize expensive computations
const result = useMemo(() => expensiveCalc(data), [data]);

// Memoize callbacks passed to children
const handleClick = useCallback(() => {
  // handler
}, [dependencies]);

// Memoize components
export const Component = React.memo(ComponentImpl);
```

### Cleanup Side Effects
```typescript
useEffect(() => {
  const listener = (e) => handle(e);
  window.addEventListener('resize', listener);

  return () => {
    window.removeEventListener('resize', listener);
  };
}, []);
```

### Lazy Loading (Phase 2+)
```typescript
import dynamic from 'next/dynamic';

const HeavyComponent = dynamic(() => import('./HeavyComponent'), {
  loading: () => <Loading />,
  ssr: false,  // Client-only if needed
});
```

## Constants Over Magic Numbers

**Bad:**
```typescript
const width = open ? 276 : 58;
const duration = 300;
```

**Good:**
```typescript
import { SIDEBAR } from '@/lib/map-constants';

const width = open ? SIDEBAR.EXPANDED_WIDTH : SIDEBAR.COLLAPSED_WIDTH;
const duration = SIDEBAR.WIDTH_TRANSITION_MS;
```

## Error Handling

### Loading States
```typescript
const [loading, setLoading] = useState(true);
const [error, setError] = useState<Error | null>(null);

if (loading) return <Loading />;
if (error) return <Error message={error.message} />;
```

### Error Boundaries (Phase 2)
```typescript
// Wrap components that can fail
<ErrorBoundary fallback={<ErrorUI />}>
  <MapComponent />
</ErrorBoundary>
```

## Testing (Phase 2)

### Unit Tests
```typescript
// component.test.tsx
import { render, screen } from '@testing-library/react';
import { Button } from './Button';

test('renders button with label', () => {
  render(<Button label="Click me" onClick={() => {}} />);
  expect(screen.getByText('Click me')).toBeInTheDocument();
});
```

### Component Tests
```typescript
test('calls onClick when clicked', () => {
  const handleClick = jest.fn();
  render(<Button label="Click" onClick={handleClick} />);
  
  fireEvent.click(screen.getByText('Click'));
  expect(handleClick).toHaveBeenCalledTimes(1);
});
```

## Plugin Architecture

Design components to be extensible:

### Good (Plugin-Ready)
```typescript
// Accept plugin-provided items
interface NavItem {
  id: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

function Sidebar({ items }: { items: NavItem[] }) {
  return (
    <nav>
      {items.map(item => (
        <button key={item.id} onClick={item.onClick}>
          {item.icon} {item.label}
        </button>
      ))}
    </nav>
  );
}
```

### Bad (Hard-coded)
```typescript
function Sidebar() {
  return (
    <nav>
      <button>Layers</button>
      <button>Saved</button>
      {/* Hard-coded list */}
    </nav>
  );
}
```

## File Organization

```
src/
├── app/
│   ├── page.tsx              # Routes
│   └── layout.tsx
├── components/
│   ├── component-name.tsx    # Component logic
│   ├── component-name.module.css  # Component styles
│   └── component-name.test.tsx    # Tests (Phase 2)
└── lib/
    ├── utilities.ts          # Shared functions
    └── constants.ts          # Shared constants
```

## Code Review Checklist

Before submitting:

- [ ] TypeScript strict mode passes
- [ ] No magic numbers (use constants)
- [ ] No unused imports/variables
- [ ] All interactive elements have ARIA labels
- [ ] Responsive at mobile breakpoint (767px)
- [ ] Dark mode looks correct
- [ ] Animations are smooth (60fps)
- [ ] Event listeners cleaned up in useEffect
- [ ] Comments explain "why", not "what"
- [ ] Follows existing code style
- [ ] No console.log/debugger statements

## Common Pitfalls

### ❌ Don't
```typescript
// Direct API calls in Phase 1
const data = await fetch('/api/maps');

// Inline styles (use CSS Modules)
<div style={{ color: 'blue' }}>

// Any types
const value: any = getValue();

// Magic numbers
if (width < 768) { /* ... */ }
```

### ✅ Do
```typescript
// Mock data in Phase 1
const data = mockMaps;

// CSS Modules
<div className={styles.container}>

// Proper types
const value: string | null = getValue();

// Named constants
if (width < MOBILE_BREAKPOINT) { /* ... */ }
```

## Reference

- Next.js Docs: https://nextjs.org/docs
- React Docs: https://react.dev/
- TypeScript: https://www.typescriptlang.org/docs
- CSS Modules: https://github.com/css-modules/css-modules
- WCAG Guidelines: https://www.w3.org/WAI/WCAG21/quickref/

## Questions?

Check existing components first (`map-shell.tsx`), then refer to architecture docs in `tech/`.
