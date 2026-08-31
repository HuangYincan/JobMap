---
name: liquid-glass-components
description: Build Apple-style glassmorphism UI components following liquid-glass-react patterns and Domain Map design system.
---

# Liquid Glass Components Development

Develop React components with liquid glass (glassmorphism) effects, following the reference implementation at https://github.com/rdev/liquid-glass-react and Domain Map's design system.

## Core Principles

**Glassmorphism Characteristics:**
- Semi-transparent background (`rgba` with alpha < 1)
- Backdrop blur filter (24px standard)
- Subtle border (1px, semi-transparent white)
- Soft shadow (layered, low opacity)
- High saturation boost (165%)

**Apple Design Language:**
- Smooth animations (cubic-bezier timing)
- Hierarchical layers
- Appropriate contrast for accessibility
- Dark mode support via system preference

## Before Starting

1. **Check Design Spec**
   - Review `tech/09-secondary-sidebar.md` for Domain Map specifications
   - Verify color tokens in `src/app/globals.css`
   - Confirm component fits the design system

2. **Understand Browser Support**
   - `backdrop-filter` requires modern browsers (Chrome 76+, Safari 9+)
   - Always include `-webkit-backdrop-filter` for Safari
   - Provide fallback for older browsers

3. **Performance Considerations**
   - Backdrop blur is GPU-intensive
   - Limit number of blurred elements on screen
   - Use `will-change: transform` sparingly

## Reference Implementation

### liquid-glass-react Structure

```typescript
// Core glassmorphism component from rdev/liquid-glass-react
interface GlassProps {
  blur?: number;           // Blur intensity (default: 24)
  opacity?: number;        // Background opacity (default: 0.72)
  saturation?: number;     // Saturation boost (default: 165%)
  borderOpacity?: number;  // Border opacity (default: 0.72)
  className?: string;
  children?: ReactNode;
}

// Usage pattern
<Glass blur={24} opacity={0.72}>
  <Content />
</Glass>
```

### Domain Map Adaptation

Our design system builds on this foundation:

```css
/* Base glass effect - src/app/globals.css */
:root {
  --glass-bg: rgba(255, 255, 255, 0.72);
  --glass-border: rgba(255, 255, 255, 0.72);
  --glass-blur: 24px;
  --glass-saturation: 165%;
}

@media (prefers-color-scheme: dark) {
  :root {
    --glass-bg: rgba(28, 28, 30, 0.72);
    --glass-border: rgba(255, 255, 255, 0.15);
  }
}
```

## Component Template

### Basic Glass Component

```tsx
// components/ui/glass-card.tsx
"use client";

import { ReactNode } from "react";
import styles from "./glass-card.module.css";

interface GlassCardProps {
  children: ReactNode;
  variant?: "default" | "elevated" | "interactive";
  className?: string;
  onClick?: () => void;
}

export function GlassCard({
  children,
  variant = "default",
  className = "",
  onClick,
}: GlassCardProps) {
  const interactive = variant === "interactive" || !!onClick;

  return (
    <div
      className={`${styles.card} ${styles[variant]} ${className}`}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      {children}
    </div>
  );
}
```

### Corresponding CSS Module

```css
/* components/ui/glass-card.module.css */
.card {
  /* Glass effect */
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation));

  /* Border */
  border: 1px solid var(--glass-border);
  border-radius: 16px;

  /* Shadow */
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.08),
    0 1px 2px rgba(0, 0, 0, 0.06);

  /* Transition */
  transition: all 0.3s cubic-bezier(0.32, 0.72, 0, 1);

  /* Layout */
  padding: 16px;
  position: relative;
  overflow: hidden;
}

/* Elevated variant - stronger shadow */
.elevated {
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.12),
    0 2px 4px rgba(0, 0, 0, 0.08);
}

/* Interactive variant - hover effects */
.interactive {
  cursor: pointer;
}

.interactive:hover {
  background: rgba(255, 255, 255, 0.85);
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.12),
    0 2px 4px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

.interactive:active {
  transform: translateY(0);
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.08),
    0 1px 2px rgba(0, 0, 0, 0.06);
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  .card {
    background: rgba(28, 28, 30, 0.72);
    border-color: rgba(255, 255, 255, 0.15);
  }

  .interactive:hover {
    background: rgba(28, 28, 30, 0.85);
  }
}

/* Fallback for browsers without backdrop-filter */
@supports not (backdrop-filter: blur(24px)) {
  .card {
    background: rgba(255, 255, 255, 0.95);
  }

  @media (prefers-color-scheme: dark) {
    .card {
      background: rgba(28, 28, 30, 0.95);
    }
  }
}
```

## Common Patterns

### 1. POI Card (Secondary Sidebar)

```tsx
// components/poi-card.tsx
<GlassCard variant="interactive" onClick={handleCardClick}>
  <div className={styles.cardHeader}>
    <img src={poi.icon} alt="" className={styles.icon} />
    <div className={styles.info}>
      <h3 className={styles.title}>{poi.name}</h3>
      <p className={styles.subtitle}>{poi.category} · {poi.location}</p>
    </div>
    <span className={styles.badge}>{poi.status}</span>
  </div>

  <div className={styles.cardMeta}>
    <span className={styles.rating}>⭐ {poi.rating}</span>
    <span className={styles.divider}>·</span>
    <span className={styles.highlight}>{poi.highlight}</span>
  </div>

  {poi.images && (
    <div className={styles.cardImages}>
      {poi.images.slice(0, 3).map((img, i) => (
        <img key={i} src={img} alt="" loading="lazy" />
      ))}
    </div>
  )}
</GlassCard>
```

### 2. Search Box

```tsx
// components/search-box.tsx
<GlassCard className={styles.searchBox}>
  <Icon name="search" className={styles.searchIcon} />
  <input
    type="text"
    placeholder={t('searchPlaceholder', lang)}
    value={query}
    onChange={handleChange}
    className={styles.searchInput}
  />
  {query && (
    <button onClick={handleClear} className={styles.clearButton}>
      ×
    </button>
  )}
</GlassCard>
```

### 3. Filter Panel

```tsx
// components/filter-panel.tsx
<GlassCard className={styles.filterPanel}>
  <div className={styles.filterHeader}>
    <h3>筛选条件</h3>
    <button onClick={handleReset}>重置</button>
  </div>

  <div className={styles.filterList}>
    <FilterSelect
      label="行业类型"
      options={industries}
      value={filters.industry}
      onChange={(v) => updateFilter('industry', v)}
    />
    {/* More filters */}
  </div>

  <button className={styles.applyButton} onClick={handleApply}>
    查看 {resultCount} 个结果
  </button>
</GlassCard>
```

### 4. Modal/Dialog

```tsx
// components/ui/glass-dialog.tsx
<div className={styles.overlay}>
  <GlassCard variant="elevated" className={styles.dialog}>
    <div className={styles.dialogHeader}>
      <h2>{title}</h2>
      <button onClick={onClose}>×</button>
    </div>
    <div className={styles.dialogContent}>
      {children}
    </div>
    <div className={styles.dialogActions}>
      <button onClick={onCancel}>取消</button>
      <button onClick={onConfirm}>确认</button>
    </div>
  </GlassCard>
</div>
```

## Advanced Techniques

### Layered Glass (Depth)

```css
/* Create depth with multiple glass layers */
.layer1 {
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(16px) saturate(150%);
  z-index: 1;
}

.layer2 {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(24px) saturate(165%);
  z-index: 2;
}

.layer3 {
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(32px) saturate(180%);
  z-index: 3;
}
```

### Animated Glass Expansion

```css
/* Sidebar detail expansion animation */
.sidebar {
  width: 420px;
  transition: width 0.35s cubic-bezier(0.32, 0.72, 0, 1);
}

.sidebar.detail {
  width: 640px;
}

/* Content fade during expansion */
.listView {
  opacity: 1;
  transition: opacity 0.2s ease-out;
}

.sidebar.detail .listView {
  opacity: 0;
  pointer-events: none;
}

.detailView {
  opacity: 0;
  transition: opacity 0.25s ease-out 0.1s;
}

.sidebar.detail .detailView {
  opacity: 1;
}
```

### Frosted Glass Variations

```css
/* Heavy frost - more blur, less transparency */
.heavyFrost {
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(40px) saturate(180%);
}

/* Light frost - less blur, more transparency */
.lightFrost {
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(16px) saturate(140%);
}

/* Tinted glass - add color tint */
.tintedGlass {
  background: rgba(0, 122, 255, 0.15);
  backdrop-filter: blur(24px) saturate(165%);
}
```

## Accessibility

### Contrast Requirements

```typescript
// Ensure text contrast meets WCAG AA (4.5:1)
// Test with browser DevTools or axe DevTools

// Good contrast on glass
.glassCard {
  background: rgba(255, 255, 255, 0.72);
  color: rgb(31, 41, 55);  // --text-primary
}

// Poor contrast - avoid
.glassCard {
  background: rgba(255, 255, 255, 0.3);  // Too transparent
  color: rgba(0, 0, 0, 0.5);             // Too light
}
```

### Focus Indicators

```css
/* Visible focus for keyboard navigation */
.interactive:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

/* Don't remove focus outline without replacement */
.interactive:focus {
  /* Keep default or provide alternative */
}
```

### ARIA Attributes

```tsx
<GlassCard
  role="button"
  tabIndex={0}
  aria-label={`${poi.name}, ${poi.category}, 评分 ${poi.rating}`}
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      handleClick();
    }
  }}
>
  {/* Content */}
</GlassCard>
```

## Performance Optimization

### GPU Acceleration

```css
/* Force GPU acceleration for smooth animations */
.glassCard {
  transform: translateZ(0);
  will-change: transform;  /* Use sparingly */
}

/* Remove will-change after animation */
.glassCard.animating {
  will-change: transform;
}

.glassCard:not(.animating) {
  will-change: auto;
}
```

### Reduce Blur on Mobile

```css
@media (max-width: 767px) {
  .glassCard {
    /* Lighter blur for mobile performance */
    backdrop-filter: blur(16px) saturate(150%);
  }
}
```

### Conditional Rendering

```tsx
// Disable glass effect on low-end devices
const supportsBackdropFilter = CSS.supports('backdrop-filter', 'blur(24px)');
const useGlass = supportsBackdropFilter && !isLowEndDevice();

<Card variant={useGlass ? 'glass' : 'solid'}>
  {children}
</Card>
```

## Testing

### Visual Regression

```typescript
// Capture glass component in different states
describe('GlassCard', () => {
  it('renders default state', async () => {
    render(<GlassCard>Content</GlassCard>);
    await expect(page).toMatchScreenshot('glass-card-default.png');
  });

  it('renders hover state', async () => {
    render(<GlassCard variant="interactive">Content</GlassCard>);
    await page.hover('[role="button"]');
    await expect(page).toMatchScreenshot('glass-card-hover.png');
  });

  it('renders dark mode', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    render(<GlassCard>Content</GlassCard>);
    await expect(page).toMatchScreenshot('glass-card-dark.png');
  });
});
```

### Accessibility Testing

```typescript
import { axe } from 'jest-axe';

test('GlassCard has no accessibility violations', async () => {
  const { container } = render(
    <GlassCard variant="interactive" onClick={() => {}}>
      Accessible Content
    </GlassCard>
  );

  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

## Common Pitfalls

### ❌ Don't

```css
/* Too much blur - performance hit */
.card {
  backdrop-filter: blur(100px);
}

/* Nested glass - visual noise */
.outerGlass {
  backdrop-filter: blur(24px);
}

.outerGlass .innerGlass {
  backdrop-filter: blur(24px);  /* Compounds, looks bad */
}

/* Missing dark mode */
.card {
  background: rgba(255, 255, 255, 0.72);
  /* No dark mode variant */
}
```

### ✅ Do

```css
/* Appropriate blur */
.card {
  backdrop-filter: blur(24px) saturate(165%);
}

/* Nested content without additional blur */
.outerGlass {
  backdrop-filter: blur(24px);
}

.outerGlass .content {
  /* No additional blur */
  background: transparent;
}

/* Complete dark mode support */
.card {
  background: var(--glass-bg);
  backdrop-filter: blur(24px) saturate(165%);
}

@media (prefers-color-scheme: dark) {
  :root {
    --glass-bg: rgba(28, 28, 30, 0.72);
  }
}
```

## Design Tokens

Always use design tokens from `globals.css`:

```css
/* Component-specific overrides (rare) */
.specialCard {
  --glass-bg: rgba(0, 122, 255, 0.12);     /* Tinted blue */
  --glass-blur: 32px;                       /* Extra blur */
  --glass-saturation: 180%;                 /* More vivid */

  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation));
}
```

## Browser Support

| Browser | Version | Support |
|---------|---------|---------|
| Chrome  | 76+     | ✅ Full |
| Safari  | 9+      | ✅ Full (with `-webkit-`) |
| Firefox | 103+    | ✅ Full |
| Edge    | 79+     | ✅ Full |
| Opera   | 63+     | ✅ Full |
| IE 11   | N/A     | ❌ Fallback to solid |

Always test in Safari with `-webkit-backdrop-filter`.

## Resources

- **Reference Implementation:** https://github.com/rdev/liquid-glass-react
- **Design Spec:** `tech/09-secondary-sidebar.md`
- **Apple HIG:** https://developer.apple.com/design/human-interface-guidelines/materials
- **Glassmorphism Guide:** https://hype4.academy/tools/glassmorphism-generator
- **Can I Use:** https://caniuse.com/css-backdrop-filter

## Questions?

Check existing components first (`src/components/map-shell.tsx` for sidebar), then refer to the reference implementation or design specs.
