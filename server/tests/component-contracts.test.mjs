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
  // 交互 2：卡片自身点击 stopPropagation，避免冒泡到 cardSlot/list 触发 onDeselect
  assert.match(card, /stopPropagation\(\)/);
  assert.match(card, /onClick=\{\s*\(e\) => \{[\s\S]*onClick\?\.\(poi\)/);
});

test('POIList exposes a labelled list, skeleton, and empty widen action', () => {
  const list = src('components/poi-list.tsx');
  const css = src('components/poi-list.module.css');
  assert.match(list, /role="list"/);
  assert.match(list, /id="explore-results"/);
  assert.match(list, /aria-busy=\{loading\}/);
  assert.match(list, /SKELETON_COUNT = 3/);
  assert.match(list, /onWidenSearch/);
  assert.match(css, /\.cardSlot/);
  assert.match(css, /card-enter/);
  // 交互 2：onDeselect prop 接线到 cardSlot 与 list 容器（仅移动端传入）
  assert.match(list, /onDeselect\?: \(\) => void/);
  assert.match(list, /onClick=\{\s*onDeselect\s*\?[\s\S]*onDeselect\(\)[\s\S]*: undefined\s*\}/);
});

test('map shell saves and restores the mobile drawer scroll across detail', () => {
  const shell = src('components/map-shell.tsx');
  // 交互 1：.drawerContent 挂 ref，进详情前保存 scrollTop，返回后 layout effect 恢复
  assert.match(shell, /drawerContentRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(shell, /drawerScrollRef = useRef\(0\)/);
  assert.match(shell, /ref=\{drawerContentRef\} className=\{styles\.drawerContent\}/);
  assert.match(shell, /drawerScrollRef\.current = drawerContentRef\.current\?\.scrollTop \?\? 0/);
  assert.match(shell, /useLayoutEffect\([\s\S]*detailPoi === null[\s\S]*scrollTop = drawerScrollRef\.current/);
  // 交互 2：移动端 POIList 传 onDeselect 清空选中/高亮（桌面 secondary-sidebar 不传）
  assert.match(shell, /onDeselect=\{\(\) => \{[\s\S]*setSelectedId\(null\)[\s\S]*setHighlightedId\(null\)/);
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
  assert.match(shell, /mobileBackBtn/);
  assert.match(shell, /mobileSheet === "account"/);
  assert.match(css, /\.mobileFilterBtn/);
  assert.doesNotMatch(css, /\.mobileChips/); // chips 行已整体移除
  assert.match(css, /\.mobileSearchRow/);
  assert.match(css, /\.mobileBackBtn/);
  assert.match(css, /@media \(max-width: 767px\)/);
});

test('embedded Profile keeps a close control and fluid card width', () => {
  const panel = src('components/account-panel.tsx');
  const css = src('components/account-panel.module.css');
  assert.match(panel, /embedded \? t\("backToExplore", lang\) : t\("closePanel", lang\)/);
  assert.doesNotMatch(panel, /\{!embedded && \([\s\S]*styles\.close/);
  assert.match(css, /\.sidebar[\s\S]*width:\s*380px[\s\S]*max-width:\s*100%/);
  assert.match(css, /\.sheet[\s\S]*width:\s*100%[\s\S]*max-width:\s*100%/);
  const sheetAt = css.indexOf('\n.sheet {');
  const sidebarAt = css.indexOf('\n.sidebar {');
  assert.ok(sheetAt > sidebarAt, 'sheet must follow sidebar so width:100% wins');
});

test('work autocomplete prefers GET /api/suggest and falls back locally', () => {
  const shell = src('components/map-shell.tsx');
  assert.match(shell, /fetchSearchSuggest/);
  assert.match(shell, /suggestRecruitment/);
  assert.match(shell, /tip\.poiId/);
  assert.match(shell, /tip\.type === "position" \? "job"/);
  assert.match(shell, /isRecruitmentMode\(mode\) \? "company" : "place"/);
  assert.match(shell, /mapApiSuggestion/);
  const api = src('lib/api.ts');
  assert.match(api, /\/api\/suggest/);
  assert.match(api, /poiId\?: string/);
});

test('domain autocomplete is local-first via /api/suggest and falls back to AMap once', () => {
  const shell = src('components/map-shell.tsx');
  // 依赖只留 [query, mode]——zoom/catalog 高频变化不再重置防抖定时器
  assert.match(shell, /\}, \[query, mode\]\);/);
  assert.doesNotMatch(shell, /\}, \[query, mode, zoom, catalog\]\);/);
  // domain 本地 0 命中/报错 → 高德 AutoComplete 一次
  assert.match(shell, /fetchSuggestions\(query\.trim\(\), zoomRef\.current <= 8/);
  assert.match(shell, /kind: "place"/);
  assert.match(shell, /icon: "📍"/);
  // 点击未加载公司 → 拉详情再打开(服务端目录命中但客户端分页未加载)
  assert.match(shell, /fetchPOIDetail\(s\.poiId, mode\)/);
});

test('empty search does not feed trending chips into suggestions', () => {
  const shell = src('components/map-shell.tsx');
  assert.match(shell, /if \(!query\.trim\(\)\) \{\s*setSuggestions\(\[\]\);/);
  assert.doesNotMatch(shell, /trendingForMode\(mode\)\.map/);
});

test('auth Other is icon rows without X', () => {
  const modal = src('components/auth-modal.tsx');
  const css = src('components/auth-modal.module.css');
  assert.match(modal, /id: "github"/);
  assert.match(modal, /id: "wechat"/);
  assert.doesNotMatch(modal, /id: "x"/);
  assert.doesNotMatch(modal, /authX/);
  assert.match(modal, /function SocialIcon/);
  assert.match(css, /grid-template-columns:\s*1fr;/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.promo \{\s*display:\s*none/);
});

test('persistable guest history and catalog-only save are wired', () => {
  const persist = src('lib/persistable.ts');
  const guest = src('lib/guest-search-history.ts');
  const shell = src('components/map-shell.tsx');
  const recent = src('components/recent-panel.tsx');
  const saved = src('app/api/me/saved/route.ts');
  const history = src('app/api/me/search-history/route.ts');
  assert.match(persist, /PERSISTABLE_MODES/);
  assert.match(persist, /isPersistablePoi/);
  assert.match(guest, /dm\.guest-search-history\.v1/);
  assert.match(shell, /addGuestHistory/);
  assert.match(shell, /suggestionToDomainPoi/);
  assert.match(recent, /recentEmptyGuest/);
  assert.doesNotMatch(recent, /recentNeedSignIn/);
  assert.match(saved, /NOT_PERSISTABLE/);
  assert.match(history, /isPersistableMode/);
  assert.match(history, /NOT_PERSISTABLE/);
});

test('map shell has skip links, a live result count, brand row and navItem search', () => {
  const shell = src('components/map-shell.tsx');
  const css = src('components/map-shell.module.css');
  assert.match(shell, /skipToResults/);
  assert.match(shell, /skipToMap/);
  assert.match(shell, /aria-live="polite"/);
  assert.match(shell, /applyTagSuggestion/);
  assert.match(shell, /openExploreSearch/);
  assert.match(shell, /document\.documentElement\.lang/);
  assert.match(css, /\.skipLink/);
  assert.match(shell, /brandLogo/); // 品牌行 Logo
  assert.match(shell, /searchLabel/); // 搜索行 navItem 化标签
  const layout = src('app/layout.tsx');
  assert.match(layout, /lang="zh-CN"/);
  const sidebar = src('components/secondary-sidebar.tsx');
  assert.match(sidebar, /scrollRegion/); // 筛选+结果+列表共享滚动容器
  assert.doesNotMatch(sidebar, /activeFilterChips/); // chips 已移除
  assert.doesNotMatch(sidebar, /filterChip/);
  assert.doesNotMatch(shell, /activeFilterChips/); // 移动端 chips 已移除
});

test('map shell scale control: cleanup 接线 + 销毁保护 + 无双 addControl(poi-loading scale)', () => {
  const shell = src('components/map-shell.tsx');
  assert.match(shell, /mapCleanup = createMap\(/); // initMap 持有 createMap 返回的 cleanup
  assert.match(shell, /mapCleanup\?\.\(\)/); // effect cleanup 执行 cleanup(移除 resize 监听)
  assert.match(shell, /isDestroyed\?\.\(\)/); // handleResize 对已销毁实例直接 return
  assert.match(shell, /scaleControlRef\.current\) return/); // 插件回调已存在则不再 add
  assert.match(shell, /addScaleControl/); // 统一创建函数
});

test('SecondarySidebar resultHeader: 加载更多按钮 + 错误重试接线(poi-loading)', () => {
  const sidebar = src('components/secondary-sidebar.tsx');
  assert.match(sidebar, /onLoadMore\?: \(\) => void/);
  assert.match(sidebar, /loadError\?: string \| null/);
  assert.match(sidebar, /onRetry\?: \(\) => void/);
  assert.match(sidebar, /styles\.loadMore/);
  assert.match(sidebar, /t\("loadMore", lang\)/);
  assert.match(sidebar, /t\("retry", lang\)/);
  assert.match(sidebar, /t\("loadingMore", lang\)/);
  const shell = src('components/map-shell.tsx');
  assert.match(shell, /onLoadMore=\{handleNeedMore\}/); // 与滚动哨兵同一路径
  assert.match(shell, /loadError=\{error\}/);
  assert.match(shell, /handleRetry/); // 重试同一 offset,不跳过失败批次
  const list = src('components/poi-list.tsx');
  assert.match(list, /loadFailedRetry/); // footer 错误重试按钮
  assert.match(list, /errorRef\.current\) return/); // 错误态哨兵不自动重发
  const i18n = src('lib/i18n.ts');
  assert.match(i18n, /loadMore: \{/);
  assert.match(i18n, /loadingMore: \{/);
  assert.match(i18n, /retry: \{/);
  assert.match(i18n, /loadFailedRetry: \{/);
});
