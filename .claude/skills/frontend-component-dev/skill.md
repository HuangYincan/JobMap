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
   - Job detail is a third panel (`jd-panel.tsx`) in the same flex cluster as Explore, 6px to the right. Do not nest JD inside the secondary sidebar, and do not absolutely position it at a fixed left (that clips on narrower windows). On viewports ≤767px the desktop rail and L2/L3 clusters hide. The bottom drawer owns search, ModeSwitcher, FilterPanel, SortSelector, POIList, POIDetailView, JdPanel, and SavedList (same compare table as desktop Saved L2) stacked in the same `--soft-strong` sheet (mini/half/full). Half/full: avatar on the right of `mobileToolbar` opens the account sheet (Profile + Layers / Saved / Recent). The `mobileToolbar` left cluster is ModeSwitcher + five icon buttons (Layers / Saved / Explore / Recent / AI assistant, i18n `aria-label` + `title`, 40px touch target, active blue `#007AFF`, same `aria-pressed` pattern as the desktop rail). Layers / Saved / Recent open their sheets in the full drawer (Saved guests open login); Explore just switches the sheet back to the default; AI opens a drawer-embedded agent sheet (`mobileSheet === "agent"`, full drawer) — same sheet pattern as Saved / Layers / Recent, not a separate floating overlay: the toolbar item sets `mobileSheetBack("explore")` + `mobileSheet("agent")` + `setDrawer("full")`, and `AgentPanel` renders with `embedded` (position static, fills the sheet body; message list scrolls internally, input pinned at the sheet bottom). The floating ball **and its anchored AgentPanel** are hidden ≤767px (`.panel { display: none }`; the old full-width bottom-sheet overlay with z-index 13 is removed), so the toolbar item is the only mobile AI entry — `agentOpen` drives the desktop ball only. Tapping an already-active item returns to Explore (mirrors the avatar re-tap). Back buttons in Saved / Layers / Recent / Agent return to their source via `mobileSheetBack` (toolbar entry → Explore; account sub-nav entry → account). Mini: avatar to the right of the search field expands to full account. Tapping the avatar again while already on the account sheet returns to Explore. Embedded Profile / Recent keep a visible close (do not hide `styles.close` when `embedded`). Account / Saved / Layers also expose `mobileBackBtn`. Preference cards in the drawer must be fluid (`max-width: 100%`, `min-width: 0`); `.sheet` must come after `.sidebar` so `width: 100%` wins over the desktop 380px. Mobile search suggestions appear only in half/full (`drawer !== "mini"`). They are an absolute liquid-glass overlay (`mobileSearchStack` + `mobileSuggestions`) over the list, never an in-flow block that pushes chips/results down, and never a sibling in the input flex row. Clicking a job replaces the company page with `JdPanel` in the drawer — do not `display: none` the JD panel at 767px. Avatar crop opens via `createPortal(..., document.body)` so Profile’s `pointer-events: none` cluster cannot swallow it. Do not mount a second desktop Explore on mobile.
   - Liquid glass (pale fill, blur + saturate, inset highlight, hover more transparent) applies to **POI cards and job rows only**. L2 Explore / L3 JD **panel chrome** stays `--soft-strong` frost (~0.84–0.90 light, ~0.84–0.88 dark). Do not re-transparentize the shells.
   - UI chrome is always brand blue `#007AFF` across modes (hover, back, Apply, selected job, recruitment markers). 12px text on frost (chips, text buttons) uses `--blue-ink` `#0062CC` so it meets WCAG AA. Keep green only for semantic values (`--green` `#1B7F3A` salary and hours).
   - Domain POIs accumulate in a catalog (soft cap 300). Panning the map does not refetch. Each mode’s catalog lives in browser `sessionStorage` (`lib/mode-cache.ts`) — switching Domain ↔ Work restores the pool and does not re-hit AMap. Only the blue refresh icon clears that mode’s cache and researches. **When curated data changes (coordinate fixes, import refreshes), bump `MODE_CACHE_VERSION` so stale session caches invalidate and refetch.** Result header: blue refresh icon next to the count; blue plus icon on the right adds ~300 more points. Distances always use the user location, falling back to the map center only if geolocation is missing. When the distance slider is set, draw a brand-blue `#007AFF` buffer circle on that same origin (`distanceFilterMeters`) with an east-edge handle that resizes the radius and snaps back to the 0.5km slider. Search is one `searchNearBy` from the user location by default; refresh pins the origin to the current view center. Radius is map-scale × 30 (over 50km falls back to AMap default 3000m). Serialize at 3 req/s. Do not fan out a 16-cell grid.
   - Map modes are Map + Work only. Intern / campus / social (and their leaves) live in `job-taxonomy.ts` as FilterPlugins on work.filters. District is `DISTRICT_PLUGIN` in `spatial-filters.ts` (address text first, coarse box if the address names no district). Public work reads also push selected districts into `SpatialClip` as `ILIKE` + coarse box. New industries add a plugin; do not add a new map mode. Mode switcher is icon-only: no label, no selected-state dot. Names stay in `title` / `aria-label`.
   - Default map mode is **work** (logged-in preference or guest). Language: logged-in preference, else browser.
   - Primary rail has no Settings item. Profile is a normal row (no persisted selected plate). Login/logout glyph stays ink, not blue. Profile L2 is `--soft-strong` frost in the same cluster as Explore: centered avatar (click → crop card), Update Profile green button, divider, then option boxes for language, default map, career prefs (status / families / industries / strengths) and notification toggles. Do not open a third panel for prefs. Guest copy is 未登录 / Not signed in + a person icon; signed-in `<strong>` is display name, `<small>` is phone or email (OAuth uses email).
   - Login is a centered split glass card (animated overlay orbs + left promo, close X + click outside). Method tabs are 手机 / 邮箱 / 其他登录: selected = blue underline, hover = lighter blue without underline. On ≤720px hide the promo/logo, keep tabs left-aligned with larger gap and vertical dividers, 44px tap. OTP send is a text button inside the input. Primary button is green 登录. Other is one full-width icon+label row each: GitHub / Google / WeChat via `POST /api/auth/oauth` — do not add X. Keep `POST /api/auth/otp/send` for Aliyun SMS later. Never print or commit `.env` secrets. Green is allowed on Sign in / Update Profile / Save crop; everywhere else keep `#007AFF` chrome (small text uses `--blue-ink`).
   - Recent is **search history only** (committed persistable queries / picked suggestions). Persistable modes live in `lib/persistable.ts` (`work` / `internship`; add `college` when that catalog lands). Signed-in rows go to `/api/me/search-history`. Guests write `dm.guest-search-history.v1` in localStorage (cap 30). Domain / AMap queries never record. Login uploads persistable guest rows then clears the local store; sign-out reloads guest history. Picking a row goes through `replayRecentSearch` then `handleModeChange` so the current catalog is written to sessionStorage first; internship aliases to work.
   - Saved is the same persistability gate (`saved_places` / `/api/me/saved`). Only recruitment catalog POIs (`isPersistablePoi`). Domain AMap bookmarks are hidden; POST returns 400 `NOT_PERSISTABLE`. Guests who tap Saved or a persistable bookmark open login; never invent a local cloud list. Company compare lives **inside Saved L2**: pick two recruitment rows, `lib/compare-saved.ts` builds the table from catalog/seed (snapshot fallback). Do not open a fourth panel. Layers opens an L2 frost card (`layers-panel.tsx`) with the saved overlay toggle (`lib/saved-overlay.ts`) and basemap styles. Overlay and style both persist in sessionStorage (`saved-overlay` / `map-style`). A user-picked style is not overwritten by system dark/light. Clicking a saved row flies via `resolveSavedForFly` + `setZoomAndCenter` (live catalog/seed first). Do not put the overlay switch on the rail itself, and do not keep a second basemap picker on the map chrome. Guests who flip the overlay open login.

   - Applications are the same contract (`applications` / `/api/me/applications`). JD Apply (`onApply`) records the click then follows the real URL. List them in Profile L2, not a fourth panel. Guests open login.
   - Job alerts (`notifications` / `/api/me/notifications`) respect Profile email/SMS toggles but only enqueue an in-account inbox this phase. Matching is `lib/job-alerts.ts` against career prefs + seed. Do not call Aliyun SMS or a mail provider. List queued items in Profile L2 under 岗位提醒.
   - Search tokens starting with `#` are filter plugins (`#大厂` → scale, `#互联网` → industry, `#秋招` → jobTaxonomy, `#技术` / `#产品` / `#运营` / `#设计` → roleFamily, `#西湖区` → district, `#在招` → onlyOpen, `#班车` / `#住宿` → benefit toggles, `#硕士` → education). internship and work share `WORK_FILTERS`. Unknown tags stay in the keyword (`#西湖` is the lake). Job-title aliases live in `JOB_ALIAS_GROUPS` (`FE`/`frontend` = 前端; short codes are token-aware). Domain place aliases live in `PLACE_ALIAS_GROUPS` (`westlake` / `West Lake` = 西湖). Company aliases live in `COMPANY_ALIAS_GROUPS` (`alibaba` = 阿里巴巴; `bytedance` = 字节跳动). Combine with leftover text via `parseSearchQuery` / `runPOIPipeline`. Picking a `#` suggestion, a Recent / trending chip, or a `/api/suggest` tag row goes through `applyTagSuggestion` so the plugin lands in `filters` and the typed query is cleared. Applied plugins show as removable chips (`activeFilterChips` / `removeFilterChip`) under the search box. Empty search boxes show **no** candidate tags. Recent L2 still shows `trendingForMode(mode)` chips — add new modes there, not inline in the panel. Domain suggestion picks upsert a session `DomainPOI` via `suggestionToDomainPoi` + `mergePoisById` so a card exists (not persistable). Domain exposes a `price` range (from `priceLevel`) and `priceAsc` / `priceDesc`; both modes include a `relevance` sort. Desktop and mobile search are `role="combobox"`; arrow keys share `lib/suggest-nav.ts`.
   - Recruitment logos: prefer the career-site / subsidiary icon for that office; fall back to a curated company icon; then emoji. One company has many sites; one position has exactly one site. Work list prefers `GET /api/pois` (`fetchWorkCatalogFromApi`) so imported SQL rows show on the map; no-DB fallback is the offline catalog (`loadOfflineWorkCatalog`). **Work mode loads by viewport**: on `moveend`/`zoomend` (debounced ~300ms via `createViewportLoader`, single in-flight) it fetches `/api/pois` for the current `bounds` + `filters.maxTier` (LOD from `lib/lod.ts`: company `tier` = visible-min-zoom 0..21, `maxTierForZoom(zoom) = floor(zoom)`, company shows when `tier <= zoom`; 0=always visible, 21=never, default 12 — see `tech/19`) and **incrementally merges** into the catalog by `poi.id` (`loadWorkViewport` — markers reuse, never clear existing). Domain mode keeps refresh-only updates and never viewport-loads. **Work mode shows authentic positions only** (`isAuthenticPositionId`: `radar-*` snapshot rows and `portal-*` verified career portals) and client-side hides expired/non-open jobs (`lib/position-alive.ts` `isAlivePosition`: `status==='open'` and `deadline` empty or `>= today`). Seed / official-career example jobs are development scaffolding — never shown on the map (2026-08-17 decision); the seed still supplies the coordinate skeleton and tests. **Pin coordinates are curated data — audit them with `npm run audit:pins`** (AMap geocoding + regeocoding, needs `AMAP_WEB_KEY`; three-layer check: address→coords, coords→address, position→company). After coordinate fixes, bump `MODE_CACHE_VERSION` and re-run `import:seed:apply` so both browser sessions and the DB pick up the change. Keep catalog ids (`slug` / `slug:site.id`) — do not rebuild them through `sourceCompanyToPois` on the read path (`sourceCompanyToCatalogPois` / `mergeCompaniesIntoPois` instead). New write sources implement `RecruitmentAdapter` in `lib/recruitment-adapters/` and register in the import planner. `radar/` drops are the mapped xiaozhao-radar freshness snapshot (city text, no coords) — matched slugs merge onto curated pins; radar-only companies stay off the map until geocoded. Official career pages start as JSON drops in `data/recruitment/official-career/` (Alibaba / ByteDance / Tencent / NetEase / Huawei / Ant + 之江实验室 samples). Same-slug `sites.id` must be `${slug}-site` or the merge adds a second pin. Do not hardcode a second fetch path. The `/api/pois` reader is `apiRecruitmentAdapter` (`kind: catalog`), not official-career. Closed / paused rows stay in the import plan but do not appear on the no-DB read path. Missing office points are planned by `lib/site-geocode.ts` / `npm run geocode:sites` (`AMAP_WEB_KEY` + `geocodeAddressRest` when applying). To put city-text radar sites on the map at a **real** Hangzhou office, run `npm run geocode:sites:apply` (`scripts/geocode-sites-apply.mjs`): place-text search → regeo verify → copy-on-write `site.location` in the radar drop. Wrong-entity traps and hand-curated offices live in `data/recruitment/geocode-overrides.json` (`{ "<slug>": { name, address, lng, lat } }` or `{ "<slug>": { "exclude": true } }`). After any drop coordinate change, bump `MODE_CACHE_VERSION`, re-run `import:seed:apply` (when Postgres is up) and `audit:pins`. Do not call AMap REST without `AMAP_WEB_KEY`, and never print that key.
   - Check `src/lib/` for utilities (i18n, constants)
  - Review CSS approach (CSS Modules + custom properties)
  - Home `page.tsx` is a Server Component and only renders `HomeMap`. `home-map.tsx` is the Client Component that `next/dynamic`s `MapShell` with `ssr: false` — Next 15 rejects `ssr: false` in Server Components. Do not put that dynamic call back on `page.tsx`. Rail panels (detail / JD / auth / Profile / Recent / Saved / Layers) are `next/dynamic` inside MapShell; keep Explore search/list/filter sync. Do not add react-virtuoso / framer-motion / zustand / Tailwind — inventory is `tech/12-bundle-notes.md`.
  - Public read APIs (`/api/pois`, `/api/pois/[id]`, `/api/search`, `/api/suggest`) share `loadServerCatalog`. Work prefers imported Postgres rows (`loadWorkCatalogFromDb`) and falls back to seed + official-career JSON (`loadOfflineWorkCatalog`). Domain list/detail on the server is `DOMAIN_SEED` (browser still uses AMap). Work typed autocomplete goes through `fetchSearchSuggest` → `/api/suggest` (job rows carry `poiId`); the client caches that response 5 minutes / 100 keys. Offline / empty falls back to `suggestRecruitment`. Empty-q `/api/suggest` still returns `trendingForMode` as `hotSearches`; the search box does not render them. Signed-in Recent is `/api/me/search-history`; guests use `lib/guest-search-history.ts`.

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

### Scrollbar Styling Best Practices

Apple-style scrollbars are implemented in `globals.css`. Key principles:

**Track (the background rail):**
- Should be **transparent** or extremely subtle
- **Don't use `:hover` states on the track** — once triggered, they persist and create visual artifacts
- Example bad pattern: `*:hover::-webkit-scrollbar-track { background: rgba(0,0,0,0.04); }` causes the gray background to stick

**Thumb (the draggable handle):**
- This is the main interactive element
- Recommended size: 12-16px width with 2-3px transparent border
- `background-clip: padding-box` creates the inset look
- **Do** provide hover feedback on the thumb: slightly darker/more opaque
- Example: `background: rgba(0,0,0,0.22)` → `rgba(0,0,0,0.35)` on hover

**Why this matters:**
- CSS `:hover` pseudo-class doesn't automatically clear when mouse leaves
- Adding hover state to the track creates a "sticky" background that only goes away on page refresh
- Focus the hover feedback on the thumb for clean, predictable behavior

**Reference implementation:**
See `server/src/app/globals.css` lines 76-126 for the full scrollbar setup.

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

### CSS Performance Optimization Gotchas

**⚠️ content-visibility pitfalls:**

`content-visibility: auto` is a Chrome optimization that skips rendering off-screen content. However:

- **Only use for uniform-height lists**: If list items have variable heights, the browser's estimated height (`contain-intrinsic-size`) will be wrong
- **Symptom of misuse**: Scrollbar jumps/bounces during scroll because the container's total height keeps changing
- **Example failure**: POI cards with 1-5 photos have heights from 120px to 300px. Using `contain-intrinsic-size: 148px` caused scrollbar position calculation errors
- **Solution**: Remove `content-visibility` for variable-height content, or use a proper virtual scrolling library (react-window) instead

**When NOT to use content-visibility:**
- Cards/items with dynamic content (photos, job lists, descriptions)
- Lists where item height depends on data
- Grids with variable aspect ratios

**When it's safe:**
- Fixed-height skeleton loaders
- Uniform table rows
- Icon grids with consistent sizing

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
- Bug Fixes Log: `tech/16-bug-fixes.md` — documented CSS pitfalls and solutions

## Questions?

Check existing components first (`map-shell.tsx`), then refer to architecture docs in `tech/`.

## Bug Fix Protocol

When fixing bugs:

1. **Document the fix** in `tech/16-bug-fixes.md`:
   - Clear symptom description
   - Root cause analysis
   - Solution with code references
   - Files modified and line numbers
   - Testing verification steps

2. **Update this skill** if the fix reveals a general pattern:
   - Add to "Common Pitfalls" section
   - Update relevant best practices
   - Include code examples

3. **Update tests** to prevent regression:
   - Modify test assertions to match new implementation
   - Add new test cases for the bug scenario
   - Verify all tests pass

4. **Verify in browser**:
   - Test the specific bug scenario
   - Check related functionality
   - Test in both light and dark modes
   - Test responsive breakpoints if relevant

5. **Run full verification**:
   ```bash
   npm test              # Unit tests
   npm run build         # TypeScript compilation
   ```
