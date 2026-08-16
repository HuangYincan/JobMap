import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

test('POICard is a keyboard button with selected/highlight states', () => {
  const card = src('components/poi-card.tsx');
  assert.match(card, /role="button"/);
  assert.match(card, /tabIndex=\{0\}/);
  assert.match(card, /aria-selected=\{selected\}/);
  assert.match(card, /Enter/);
  assert.match(card, /aria-label=\{buildAriaLabel/);
  assert.match(card, /loading="lazy"/);
  assert.match(card, /DEFAULT_ACCENT = "#007AFF"/);
});

test('POIList exposes a labelled list, skeleton, and empty widen action', () => {
  const list = src('components/poi-list.tsx');
  const css = src('components/poi-list.module.css');
  assert.match(list, /role="list"/);
  assert.match(list, /id="explore-results"/);
  assert.match(list, /aria-busy=\{loading\}/);
  assert.match(list, /SKELETON_COUNT = 3/);
  assert.match(list, /onWidenSearch/);
  assert.match(css, /content-visibility:\s*auto/);
  assert.match(css, /contain-intrinsic-size:\s*auto 148px/);
});

test('FilterPanel select is a labelled listbox', () => {
  const panel = src('components/filter-panel.tsx');
  assert.match(panel, /aria-haspopup="listbox"/);
  assert.match(panel, /aria-expanded=\{open\}/);
  assert.match(panel, /role="option"/);
  assert.match(panel, /onReset/);
  assert.match(panel, /resultCount/);
});

test('map shell lazy-loads rail panels and detail chrome', () => {
  const shell = src('components/map-shell.tsx');
  assert.match(shell, /next\/dynamic/);
  assert.match(shell, /import\("\.\/poi-detail"\)/);
  assert.match(shell, /import\("\.\/jd-panel"\)/);
  assert.match(shell, /import\("\.\/auth-modal"\)/);
  assert.match(shell, /import\("\.\/account-panel"\)/);
  assert.match(shell, /import\("\.\/recent-panel"\)/);
  assert.match(shell, /import\("\.\/saved-panel"\)/);
  assert.match(shell, /import\("\.\/layers-panel"\)/);
  assert.match(shell, /function prefetchRail/);
  assert.match(shell, /onMouseEnter=\{\(\) => prefetchRail\("layers"\)\}/);
  assert.doesNotMatch(shell, /import \{ AuthModal \} from "\.\/auth-modal"/);
});

test('home page lazy-loads MapShell on the client', () => {
  const page = src('app/page.tsx');
  const loader = src('components/home-map.tsx');
  assert.match(page, /HomeMap/);
  assert.doesNotMatch(page, /ssr:\s*false/);
  assert.match(loader, /"use client"/);
  assert.match(loader, /next\/dynamic/);
  assert.match(loader, /ssr:\s*false/);
  assert.match(loader, /MapShell/);
});

test('avatar cropper portals above pointer-events-none clusters', () => {
  const cropper = src('components/avatar-cropper.tsx');
  assert.match(cropper, /createPortal/);
  assert.match(cropper, /document\.body/);
});

test('mobile JD panel stays visible inside the drawer', () => {
  const css = src('components/jd-panel.module.css');
  assert.doesNotMatch(css, /@media \(max-width: 767px\)[\s\S]*display:\s*none/);
});

test('mobile drawer owns Explore and hides desktop L2 at 767px', () => {
  const shell = src('components/map-shell.tsx');
  const css = src('components/map-shell.module.css');
  assert.match(shell, /type DrawerState = "mini" \| "half" \| "full"/);
  assert.match(shell, /mobileSheet === "saved"/);
  assert.match(shell, /mobileSheet === "layers"/);
  assert.match(shell, /mobileSheet === "account"/);
  assert.match(shell, /openMobileAccount/);
  assert.match(shell, /mobileSearchRow/);
  assert.match(shell, /mobileSearchStack/);
  assert.match(shell, /drawer !== "mini" && suggestions\.length > 0/);
  assert.match(shell, /mobileJd && isRecruitmentPOI/);
  assert.match(css, /\.mobileChips/);
  assert.match(css, /\.mobileSearchRow/);
  assert.match(css, /@media \(max-width: 767px\)/);
});

test('work autocomplete prefers GET /api/suggest and falls back locally', () => {
  const shell = src('components/map-shell.tsx');
  assert.match(shell, /fetchSearchSuggest/);
  assert.match(shell, /suggestRecruitment/);
  assert.match(shell, /tip\.poiId/);
  assert.match(shell, /kind: tip\.type === "position" \? "job"/);
  const api = src('lib/api.ts');
  assert.match(api, /\/api\/suggest/);
  assert.match(api, /poiId\?: string/);
});

test('map shell has skip links and a live result count', () => {
  const shell = src('components/map-shell.tsx');
  const css = src('components/map-shell.module.css');
  assert.match(shell, /skipToResults/);
  assert.match(shell, /skipToMap/);
  assert.match(shell, /aria-live="polite"/);
  assert.match(shell, /applyTagSuggestion/);
  assert.match(shell, /openExploreSearch/);
  assert.match(shell, /activeFilterChips/);
  assert.match(shell, /document\.documentElement\.lang/);
  assert.match(css, /\.skipLink/);
  const layout = src('app/layout.tsx');
  assert.match(layout, /lang="zh-CN"/);
  const sidebar = src('components/secondary-sidebar.tsx');
  assert.match(sidebar, /activeFilterChips/);
  assert.match(sidebar, /filterChip/);
});
