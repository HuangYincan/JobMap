# Domain Map Frontend

**Status:** Phase 2–4 client slice on `feature/phase-2-multi-mode`  
**Framework:** Next.js 15.5 (App Router) + React 19 + TypeScript 5.9  
**Map Engine:** AMap JavaScript API v2.0 (`loadAMap`, not an npm package)

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your AMap credentials

# Run development server
npm run dev

# Open browser
open http://localhost:3000
```

## Environment Variables

Required for map functionality:

```bash
# .env.local
NEXT_PUBLIC_AMAP_KEY=your_amap_key_here
NEXT_PUBLIC_AMAP_SECURITY_CODE=your_security_code_here
```

**Note:** These are `NEXT_PUBLIC_*` variables, meaning they are exposed to the browser. Only use client-safe API keys with domain restrictions configured in AMap console.

### Obtaining AMap Credentials

1. Register at [AMap Open Platform](https://lbs.amap.com/)
2. Create a JavaScript API application
3. Configure allowed domains (localhost for development)
4. Copy Key and Security Code to `.env.local`

### Fallback Behavior

If AMap credentials are missing, the app displays a CSS-only fallback map placeholder. The shell UI remains functional for development/testing without live map tiles.

## Project Structure

```
server/
├── src/
│   ├── app/                 # App Router + /api/*
│   ├── components/          # MapShell, Explore, detail, JD, Profile, Layers
│   └── lib/                 # search, modes, account-store, server-catalog
├── tests/                   # node:test — cd server && npm test
├── package.json
└── README.md
```

Never print or commit `.env` / `.env.local`.

## Test

```bash
./node_modules/.bin/tsc --noEmit
node --test tests/*.test.mjs
```

Do not run `npx tsc` from the repo root.

## Features

### Desktop UI
- Collapsed-first rail (58px). Search is a ghost 42px icon; typing opens Explore.
- Modes: Map + Work. Intern / campus / social are work filters.
- L2 frost cards: Explore, Profile, Recent, Saved, Layers. L3 JD docks in the same flex cluster.
- Liquid glass on POI / job cards only. Panel chrome stays `--soft-strong`.
- UI chrome is always `#007AFF`. Green is salary / hours / Sign in / Update Profile.

### Mobile UI
- ≤767px hides the rail and desktop L2/L3. The frost drawer owns search, list, detail, and JD.
- **Touch Optimized:** Larger tap targets, mobile-first layout

### Map Controls
- **Zoom:** +/- buttons with level indicator
- **Compass:** Reset to north (300ms smooth animation), needle rotates with map
- **Locate:** Return to user GPS position with accuracy circle
- **Map Style:** Switch between Standard/Satellite/Dark
- **3D Control:** Middle-button drag for rotation (X-axis) and pitch (Y-axis)
- **Scale:** Auto-repositioning (desktop bottom-left, mobile top-left)

### Interaction Details

#### Middle Button 3D Control
- **Press middle mouse button** and drag to rotate/pitch the map
- **X-axis (left/right):** Rotation 0-360°, sensitivity 0.13
- **Y-axis (up/down):** Pitch 0-83°, sensitivity 0.15
- **Cursor:** Changes to grab/grabbing during interaction

#### Sidebar Animation
- **Timing:** 350ms cubic-bezier(0.32, 0.72, 0, 1) for smooth ease-out
- **Choreography:** Collapse → text fades out (200ms), then width shrinks; Expand → width grows, then text fades in (250ms, 100ms delay)
- **Tooltips:** Appear on hover when sidebar collapsed

#### Geolocation
- **Automatic:** Tries to get user location on initial load
- **Accuracy Circle:** Shows GPS accuracy radius (minimum 30m)
- **Zoom Adaptation:** Circle visible at zoom ≥15, dot icon at lower zoom
- **Permission Handling:** Gracefully falls back to default center if denied

## Development

### Commands

```bash
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm run start        # Run production server
npm run lint         # Run ESLint
npm run typecheck    # Run TypeScript compiler check
```

### Code Style

- **TypeScript:** Strict mode enabled
- **React:** Server/Client components (use `"use client"` directive)
- **CSS:** CSS Modules for component styles
- **Formatting:** Consistent 2-space indentation
- **Naming:** PascalCase components, camelCase variables/functions

### Browser Support

- **Primary:** Modern evergreen browsers (Chrome, Safari, Firefox, Edge)
- **Tested:** macOS Safari, macOS Chrome
- **Mobile:** Responsive layout tested in DevTools, real device testing pending

## Internationalization

The app supports English and Chinese. Language detection is automatic via `navigator.language`.

```typescript
import { t } from '@/lib/i18n';

// Usage
t('search', 'en')     // → "Search"
t('search', 'zh')     // → "搜索"
```

See `docs/i18n.md` for full documentation.

## Architecture

### Map Adapter Pattern

The frontend is designed to support multiple map engines via an adapter pattern:

```typescript
// lib/map-adapter.ts
export type MapAdapter = "fallback" | "amap";
export function getMapAdapter(): MapAdapter {
  return process.env.NEXT_PUBLIC_AMAP_KEY ? "amap" : "fallback";
}
```

Currently, only AMap is implemented. Future adapters (Mapbox, Leaflet, etc.) can be added as plugins.

### Data Flow (Phase 2)

```
API Routes (Phase 2)
    ↓
React Server Components
    ↓
Client Components (map-shell.tsx)
    ↓
Map Engine (AMap)
```

Currently, the shell uses **mock data** (`places` array). Phase 2 will replace this with API calls.

### Plugin Readiness

The frontend establishes foundations for plugin architecture but is not yet fully modular. Phase 2+ will extract:
- Map controls as plugins
- Map layers as plugins
- Navigation items as plugin-contributed
- Event bus for plugin communication

## Styling

### Design System

```css
/* globals.css - CSS custom properties */
--soft: rgba(255, 255, 255, 0.58);      /* Glassmorphism background */
--line: rgba(0, 0, 0, 0.08);            /* Border color */
--ink: rgb(31, 41, 55);                 /* Primary text */
--muted: rgb(107, 114, 128);            /* Secondary text */
--blue: rgb(0, 122, 255);               /* Accent color */
--shadow: 0 2px 8px rgba(0, 0, 0, 0.08); /* Elevation shadow */
```

### Dark Mode

Automatic switching via `prefers-color-scheme: dark`:
- Map style switches to "whitesmoke" (dark theme)
- Button backgrounds adjust to `rgba(28, 28, 30, 0.72)`
- System-level preference, no manual toggle

### Responsive Breakpoint

```css
@media (max-width: 767px) {
  /* Mobile styles */
}
```

Desktop-first for main shell, mobile-optimized for drawer and controls.

## Known Limitations

1. **No offline support:** Requires network for map tiles
2. **Single map engine:** AMap only, no multi-engine switching yet
3. **Mock data:** `places` array hardcoded, awaits Phase 2 API
4. **No authentication:** User identity UI present but non-functional
5. **No error boundary:** Map initialization errors not caught at React boundary
6. **Accessibility:** ARIA labels present, screen reader testing pending

## Testing

### Manual Testing Checklist

- [ ] Map loads with AMap tiles
- [ ] Geolocation prompts and centers on user
- [ ] Zoom in/out buttons work
- [ ] Compass resets to north smoothly
- [ ] Locate button returns to user position
- [ ] Map style picker switches themes
- [ ] Middle-button drag rotates and pitches
- [ ] Sidebar expands/collapses smoothly
- [ ] Tooltips appear on collapsed sidebar
- [ ] Mobile drawer switches states
- [ ] Dark mode switches automatically

### Automated Tests (TODO for Phase 2)

- [ ] Unit tests for i18n functions
- [ ] Unit tests for map adapter selection
- [ ] Component tests for Icon rendering
- [ ] Integration tests for map initialization
- [ ] E2E tests for full user journey

## Troubleshooting

### Map Not Loading

**Issue:** Blank screen or "Loading map..." message  
**Check:**
1. `NEXT_PUBLIC_AMAP_KEY` and `NEXT_PUBLIC_AMAP_SECURITY_CODE` set in `.env.local`
2. AMap console shows key is active and domain is allowed
3. Browser console for script loading errors
4. Network tab for blocked requests (CORS/CSP)

### Geolocation Not Working

**Issue:** Map doesn't center on user location  
**Check:**
1. Browser permissions (click lock icon in address bar)
2. HTTPS required for geolocation (localhost exception exists)
3. Console for permission denied errors
4. Falls back to default center (120.15, 30.27) if permission denied

### Animations Jerky

**Issue:** Sidebar collapse/expand looks choppy  
**Check:**
1. Browser dev tools "Performance" tab
2. Hardware acceleration enabled
3. Too many other processes running
4. Try a different browser (Safari usually smoothest)

### Dark Mode Not Switching

**Issue:** Map stays light when system is dark  
**Check:**
1. System preferences > Appearance > Dark
2. Hard refresh browser (Cmd+Shift+R)
3. Check console for errors in theme listener

## Phase 2 Integration Points

When Phase 2 begins, update these areas:

1. **Replace Mock Data**
   ```typescript
   // Current
   const places = [/* hardcoded */];
   
   // Phase 2
   const { data: places } = await fetch('/api/maps/123/entities');
   ```

2. **Add Authentication**
   ```typescript
   // Wrap with auth provider
   <AuthProvider>
     <MapShell />
   </AuthProvider>
   ```

3. **API Routes**
   - `GET /api/maps` - List user's maps
   - `GET /api/maps/[id]` - Map details
   - `GET /api/maps/[id]/entities` - Spatial query

4. **Loading States**
   - Add Suspense boundaries
   - Skeleton loaders for sidebar/drawer
   - Error boundaries for API failures

## Contributing

See `CONTRIBUTING.md` in the repository root.

## License

See `LICENSE` in the repository root.

---

**Phase 1 Complete** - Shell ready for Phase 2 API integration  
**Last Updated:** 2026-08-15
