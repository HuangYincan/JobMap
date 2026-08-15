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
