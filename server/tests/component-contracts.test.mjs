import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

test('POICard positionsPreview dedups by pos.id before render (duplicate-key defense)', () => {
  const card = src('components/poi-card.tsx');
  // 2026-08-20: 同 external_id 双行 (旧 seed source + 新真实 source) 曾同时进入
  // positionsPreview → <span key={pos.id}> 重复 key 警告上百条。渲染前按 pos.id
  // 去重 (保序保首个): import 自愈落库前的过渡期也不报警。
  assert.match(card, /const seenPositionIds = new Set<string>\(\)/);
  assert.match(card, /seenPositionIds\.has\(pos\.id\)/);
  assert.match(card, /seenPositionIds\.add\(pos\.id\)/);
  const previewAt = card.indexOf('const positionsPreview = openPositions');
  assert.ok(previewAt !== -1, 'positionsPreview anchor exists');
  const previewBlock = card.slice(previewAt, card.indexOf('const benefits ='));
  const filterAt = previewBlock.indexOf('.filter');
  const sliceAt = previewBlock.indexOf('.slice(0, 3)');
  assert.ok(filterAt !== -1 && sliceAt !== -1 && filterAt < sliceAt, 'dedup filter must run before the 3-item slice');
  // 回归守卫: 不再直接对 openPositions 裸 slice (去重必须插在切片之前)。
  assert.doesNotMatch(card, /positionsPreview = openPositions\.slice\(0, 3\)/);
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

test('mobile account open resets drawer scroll; expanded search keeps query text visible', () => {
  const shell = src('components/map-shell.tsx');
  const css = src('components/map-shell.module.css');
  // 打开 account 面板前重置常驻滚动容器,避免继承列表滚动位置
  assert.match(shell, /setMobileSheet\("account"\);[\s\S]{0,200}drawerContentRef\.current\.scrollTop = 0/);
  // 展开态已有查询文本时,输入框不依赖 focus-within 也常显(失焦不丢可见文本)
  assert.match(css, /\.sidebarOpen \.searchBox input:not\(:placeholder-shown\)\s*\{\s*opacity: 1;\s*\}/);
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

test('profile applied/notification rows are clickable buttons wired to the job jump', () => {
  const panel = src('components/account-panel.tsx');
  // 行 button 化:已投递 + 收件箱两处整行 button(键盘可达)
  const rowButtons = panel.match(/className=\{styles\.appRow\}/g) ?? [];
  assert.ok(rowButtons.length >= 2, 'applied + notification rows are buttons');
  // 回调 prop + 已投递行触发回调(携 positionId/companyPoiId 载荷)
  assert.match(panel, /onOpenApplication\?: \(record: \{ positionId: string; companyPoiId: string \}\) => void/);
  assert.match(panel, /onClick=\{\(\) => onOpenApplication\?\.\(\{ positionId: item\.positionId, companyPoiId: item\.companyPoiId \}\)/);
  // 通知行:缺 positionId/companyPoiId 禁用 + 回调内守卫
  assert.match(panel, /disabled=\{!item\.positionId \|\| !item\.companyPoiId\}/);
  assert.match(panel, /if \(item\.positionId && item\.companyPoiId\)/);
  // 按钮态样式:pointer + hover 高亮(与 .rowBtn 同语义)
  const css = src('components/account-panel.module.css');
  assert.match(css, /\.appRow \{\s*display: flex;[\s\S]*cursor: pointer/);
  assert.match(css, /\.appRow:hover:not\(:disabled\)/);
  assert.match(css, /\.appRow:disabled \{\s*cursor: default/);
  // map-shell 接线:拉 work 详情 → 匹配岗位 → 桌面详情 + 移动 JD + 失败兜底
  const shell = src('components/map-shell.tsx');
  assert.match(shell, /const handleOpenApplication = useCallback\(\(ref: \{ positionId: string; companyPoiId: string \}\)/);
  assert.match(shell, /fetchPOIDetail\(ref\.companyPoiId, "work"\)/);
  assert.match(shell, /setOpenPositionId\(ref\.positionId\)/);
  assert.match(shell, /setMobileJd\(pos \?\? null\)/);
  assert.match(shell, /console\.warn\("\[profile\] failed to open application"/);
  const wired = shell.match(/onOpenApplication=\{handleOpenApplication\}/g) ?? [];
  assert.ok(wired.length >= 2, 'desktop + mobile embedded ProfilePanel both wired');
});

test('work autocomplete prefers GET /api/suggest and falls back locally', () => {
  // 建议获取逻辑随 useSearchState 抽到 hook(位置移动,断言不变)
  const hook = src('hooks/use-search-state.ts');
  assert.match(hook, /fetchSearchSuggest/);
  assert.match(hook, /suggestRecruitment/);
  assert.match(hook, /tip\.poiId/);
  assert.match(hook, /tip\.type === "position" \? "job"/);
  assert.match(hook, /isRecruitmentMode\(mode\) \? "company" : "place"/);
  assert.match(hook, /mapApiSuggestion/);
  const api = src('lib/api.ts');
  assert.match(api, /\/api\/suggest/);
  assert.match(api, /poiId\?: string/);
});

test('domain autocomplete is local-first via /api/suggest and falls back to AMap once', () => {
  const shell = src('components/map-shell.tsx');
  const hook = src('hooks/use-search-state.ts');
  // 依赖只留 [query, mode]——zoom/catalog 高频变化不再重置防抖定时器(位置随 hook 移动)
  assert.match(hook, /\}, \[query, mode\]\);/);
  assert.doesNotMatch(hook, /\}, \[query, mode, zoom, catalog\]\);/);
  // domain 本地 0 命中/报错 → 高德 AutoComplete 一次(位置随 hook 移动)
  assert.match(hook, /fetchSuggestions\(query\.trim\(\), zoomRef\.current <= 8/);
  assert.match(hook, /kind: "place"/);
  assert.match(hook, /icon: "📍"/);
  // 点击未加载公司 → 拉详情再打开(服务端目录命中但客户端分页未加载,留在 map-shell)
  assert.match(shell, /fetchPOIDetail\(s\.poiId, mode\)/);
});

test('empty search does not feed trending chips into suggestions', () => {
  // 空查询清空建议:逻辑随 useSearchState 抽到 hook(位置移动,断言不变)
  const hook = src('hooks/use-search-state.ts');
  assert.match(hook, /if \(!query\.trim\(\)\) \{\s*setSuggestions\(\[\]\);/);
  assert.doesNotMatch(hook, /trendingForMode\(mode\)\.map/);
});

test('phone/email login shows auto-register hint under the button', () => {
  const modal = src('components/auth-modal.tsx');
  const i18n = src('lib/i18n.ts');
  // 提示行只渲染在手机/邮箱 OTP 分支(登录按钮之后)
  assert.match(modal, /onClick=\{signIn\}[^]*autoRegisterHint/);
  assert.match(modal, /t\("autoRegisterHint", lang\)/);
  assert.match(modal, /styles\.autoRegisterHint/);
  // 密码 tab 分支不含该提示
  assert.doesNotMatch(modal, /tab === "password"[\s\S]{0,800}autoRegisterHint/);
  // i18n 双语文案存在
  assert.match(i18n, /autoRegisterHint: \{\s*zh: '新用户将自动注册',\s*en: 'New users are registered automatically',\s*\},/);
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

test('domain category gating (poi-category-loading): 门控/驱动加载/空态提示/空批次保护', () => {
  const shell = src('components/map-shell.tsx');
  const hook = src('hooks/use-work-viewport.ts');
  const list = src('components/poi-list.tsx');
  const sidebar = src('components/secondary-sidebar.tsx');
  const i18n = src('lib/i18n.ts');
  // 主加载门控:domain 无分类选择 → 默认不加载(搜索豁免)
  assert.match(shell, /if \(!query && !filters\.category\)/);
  // 视口 loader 门控:无分类 → 移动/缩放不拉取(随 useWorkViewport 抽取,断言同步移动)
  assert.match(hook, /if \(!v\.query && !v\.filters\?\.category\)/);
  // load effect 依赖分类(选类/换类触发重拉;minRating/price 仍纯客户端)
  assert.match(shell, /filters\.category\]\);/);
  // filters 下行到数据源(分类驱动加载:主加载在 shell + 视口加载在 hook 各一处)
  assert.match(shell, /filters, \/\/ 分类驱动加载/);
  assert.match(hook, /filters: v\.filters, \/\/ 分类驱动加载/);
  // 空批次保护(2026-08-20 修订:work 分支已删——全量加载后无增量视口请求,
  // 空批次保护只属 domain 替换式路径):已有非空目录时空批次保留旧目录(ws1 Bug1)
  assert.doesNotMatch(hook, /if \(batch\.length === 0\) return;/);
  const guards = hook.match(/batch\.length === 0 && catalogRef\.current\.length > 0/g);
  assert.ok(guards && guards.length >= 1, 'domain 空批次保护');
  // 空态提示:新 i18n 键 + POIList emptyTitle 接线
  assert.match(i18n, /pickCategory: \{[\s\S]*选择类别开始浏览[\s\S]*Pick a category to explore/);
  assert.match(list, /emptyTitle\?: string/);
  assert.match(list, /emptyTitle \?\? t\("noResults", lang\)/);
  assert.match(
    sidebar,
    /emptyTitle=\{\s*domainNoCategory \|\| candidateChips\.length > 0 \? t\("pickCategory", lang\) : undefined\s*\}/,
  );
  assert.match(sidebar, /config\.kind === "domain" && !filters\.category && !query\.trim\(\)/);
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

test('saved overlay toggle: programmatic camera move suppresses viewport refresh (saved-overlay-wipe)', () => {
  const shell = src('components/map-shell.tsx');
  const hook = src('hooks/use-work-viewport.ts');
  const savedLayer = src('hooks/use-saved-layer.ts');
  // 方案 A:保留 fit-to-pins 相机移动,但在移动前打开抑制窗口,吞掉 setBounds 触发的
  // moveend/zoomend 视口刷新(空批次会整体替换清空目录 → 所有 poi 消失)。
  // 抑制窗口常量在 useWorkViewport,toggle 随 useSavedLayer 抽取,ref 仍在 map-shell 创建并传入 hook
  assert.match(hook, /export const VIEWPORT_SUPPRESS_MS = 500/);
  assert.match(shell, /suppressViewportRefreshUntilRef = useRef\(0\)/);
  // onViewChange 随 hook 移动:抑制窗口内直接 return,不 schedule
  assert.match(hook, /const onViewChange = \(\) => \{[\s\S]{0,200}suppressViewportRefreshUntilRef\.current > Date\.now\(\)[\s\S]{0,80}return;[\s\S]{0,80}loader\.schedule\(\);/);
  // 抑制标记必须在相机移动(setBounds)之前置位——限定在 toggle 函数体内比较
  const toggleAt = savedLayer.indexOf('const toggle = useCallback');
  const hideAt = savedLayer.indexOf('const hide = useCallback');
  assert.ok(toggleAt !== -1 && hideAt > toggleAt, 'toggle/hide anchors must exist in order');
  const toggleBody = savedLayer.slice(toggleAt, hideAt);
  const setAt = toggleBody.indexOf('suppressViewportRefreshUntilRef.current = Date.now() + VIEWPORT_SUPPRESS_MS');
  // ws-c:视图归一化 setBounds(引擎内部构造厂商 Bounds),不再直引 new AMap.Bounds
  const boundsAt = toggleBody.indexOf('map.setBounds({');
  assert.ok(setAt !== -1 && boundsAt !== -1, 'suppress marker + view.setBounds must both exist in toggle');
  assert.ok(setAt < boundsAt, 'suppress marker must be set before map.setBounds');
  // map-shell 接线:同名变量解构 + 共享 ref 传入 + LayersPanel onToggleOverlay 挂 toggle
  assert.match(
    shell,
    /const \{\s*savedOverlay,\s*overlayPois,\s*toggle: handleToggleSavedOverlay,\s*hide: hideSavedOverlay,\s*\} = useSavedLayer\(\{/,
  );
  assert.match(shell, /suppressViewportRefreshUntilRef,\s*onRequireAuth: \(\) => setAuthOpen\(true\),\s*\}/);
  assert.match(shell, /onToggleOverlay=\{handleToggleSavedOverlay\}/);
});

test('geocode apply: manual overrides are city-gated (override poisons multi-city sites)', () => {
  // 2026-08-19 事故:8/17 的杭州 override 被原样套到 -shanghai 站点(禾赛 →
  // 萧山赫兹智造中心)。override 必须按站点城市过滤;legacy 无 city 字段默认杭州市。
  const script = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'geocode-sites-apply.mjs'),
    'utf8',
  );
  assert.match(script, /overrideCity = override\?\.city \?\? '杭州市'/);
  assert.match(script, /overrideCity !== target\.city/);
  assert.match(script, /override-city-mismatch/);
  // 站点级跳过替代公司级 already-pinned(多城市时代:杭州 pin 不挡上海解析)
  assert.doesNotMatch(script, /pinned\.has\(slug\)/);
});

test('work viewport empty batch three-state (ws1 Bug1): 真空清空 / 保留 / 失败保留', () => {
  const shell = src('components/map-shell.tsx');
  const hook = src('hooks/use-work-viewport.ts');
  const savedLayer = src('hooks/use-saved-layer.ts');
  const vp = src('lib/viewport-search.ts');
  // 纯函数:旧目录是否仍有 POI 落在当前视野 bounds 内(三态判定核心)
  assert.match(vp, /export function catalogCoversView\(/);
  // 视口替换路径随 useWorkViewport 抽取到 hook(视口加载,existing=[]):
  // 空批次 + 旧目录无 POI 在视野内 → 真空清空走空态(整城空白不再被旧城市 pin 占住)
  assert.match(hook, /空批次三态\(ws1 Bug1\)/);
  assert.match(hook, /catalogCoversView\(catalogRef\.current, bounds\)/);
  assert.match(hook, /catalogRef\.current = \[\];[\s\S]*?setCatalog\(\[\]\);/);
  // 主加载路径(existing=旧目录)留在 map-shell:保留时跳过缓存写入(旧目录顶着
  // 「当前视野」快照会污染挂载对齐判定,下次刷新不再触发对齐加载)
  assert.match(shell, /空批次三态\(ws1 Bug1 视口\)/);
  assert.match(shell, /catalogCoversView\(catalogRef\.current, view\.bounds\)/);
  // 请求失败(网络/非 2xx):保留旧目录 + console.warn(2026-08-20 修订:
  // work 视口请求已删,只余 domain 分支保留该行为)
  assert.doesNotMatch(hook, /console\.warn\("\[map-shell\] work viewport load failed:/);
  assert.match(hook, /console\.warn\("\[map-shell\] domain viewport load failed:/);
  // VIEWPORT_SUPPRESS_MS 抑制机制保留(tech/16 方案 A,收藏 fitToPins 兜底):
  // 事件侧窗口检查随 useWorkViewport 移动,toggle 侧写入抑制标记随 useSavedLayer 移动
  assert.match(hook, /suppressViewportRefreshUntilRef\.current > Date\.now\(\)/);
  assert.match(savedLayer, /suppressViewportRefreshUntilRef\.current = Date\.now\(\) \+ VIEWPORT_SUPPRESS_MS/);
});

test('map shell mount-align load (ws1 Bug1): 缓存快照不符 → 主动调度一次视口加载', () => {
  const shell = src('components/map-shell.tsx');
  const hook = src('hooks/use-work-viewport.ts');
  // 挂载对齐 effect 随 useWorkViewport 抽取到 hook:mapReady + geoSettled 后读
  // 缓存视野快照,与当前视野显著不符(或无快照字段)→ schedule() 主动调度当前
  // 视野的视口加载,不再等用户 moveend(geolocation 被拒时不产生 moveend)
  assert.match(hook, /挂载对齐加载\(ws1 Bug1 视口\)/);
  assert.match(hook, /readModeCache\(mode\)/);
  assert.match(hook, /needsViewportAlign\(cached\.viewport, snap\.center, snap\.zoom\)/);
  assert.match(hook, /viewportLoaderRef\.current\.schedule\(\)/);
  assert.match(hook, /readMapViewSnapshot\(/);
  // 缓存快照写入:视口加载批次与主加载都带 viewport(center+zoom+bounds)
  assert.match(hook, /viewport: snapshot \?\? undefined/);
  // map-shell 接线:loader 实例经返回的 ref 暴露,主加载 finally 用它补跑
  assert.match(shell, /const \{ viewportLoaderRef \} = useWorkViewport\(\{/);
  assert.match(shell, /readMapViewSnapshot\(/);
});

test('map shell Bug3 locate: 挂载定位不抢占已移图相机(首点 pin 不再被拽回)', () => {
  const shell = src('components/map-shell.tsx');
  // 相机接管标记 ref 已声明(ws-poi-vanish:hasInteractedRef 改名 userMovedMapRef,
  // 仅相机手势/相机操作置位)
  assert.match(shell, /userMovedMapRef = useRef\(false\)/);
  // 挂载 geolocation 回调:定位数据照常(userLocation/searchOrigin),相机移动被
  // userMovedMapRef + 用户已交互 + 默认中心距离 三门控——未移图/未交互且相机仍处
  // 默认才 setCenter+setZoom+setMapCenter(已交互不抢镜头:geolocation resolve 可能
  // 晚于首交互,此时跳变 = 「整页刷新」观感)。ws-c:视图方法经 view 契约。
  // 2026-08-21 追加第四门控:视图已销毁(StrictMode 双调用弹卡窗口)不读相机。
  // 挂载定位按引擎分派(fix-runtime):AMap 走 amap-api(蓝点+精度圈),非 AMap 走
  // 引擎 search 纯定位(无蓝点渲染)。getCurrentPosition(view.raw) 只允许出现在
  // locateForMap 分派内部——调用点一律 locateForMap(view),杜绝 amap 控件塞给
  // 非 amap raw map(腾讯 addControl 类型错误崩溃根因)。
  assert.match(shell, /function locateForMap\(view: MapView\)/);
  assert.match(shell, /view\.engine\.id === "amap"/);
  assert.match(shell, /view\.engine\.search\.getCurrentPosition\(\)/);
  assert.equal(
    (shell.match(/getCurrentPosition\(view\.raw\)/g) ?? []).length,
    1,
    'AMap 专属 getCurrentPosition(view.raw) 只允许在 locateForMap 内出现一次',
  );
  assert.match(shell, /locateForMap\(view\)/);
  assert.match(shell, /locateForMap\(mapInstance\.current\)/);
  assert.doesNotMatch(shell, /getCurrentPosition\(mapInstance\.current\.raw\)/);
  assert.match(shell, /setUserLocation\(\{ lng, lat \}\)/);
  assert.match(shell, /setSearchOrigin\(\(prev\) => prev \?\? \{ lng, lat \}\)/);
  assert.match(
    shell,
    /isNearDefaultCenter\(view\.getState\(\)\.center\)\s*\)\s*\{[\s\S]{0,160}view\.setCenter\(\{ lng, lat \}\)[\s\S]{0,120}view\.setZoom\(15\)[\s\S]{0,120}setMapCenter\(\{ lng, lat \}\)/
  );
  // 已移图/已交互/已恢复视野 → 锁定 mapCenter 不更新(距离圆心/相机都不甩去用户位置)
  assert.match(shell, /isNearDefaultCenter\(view\.getState\(\)\.center\)\s*\)\s*\{[\s\S]{0,160}setMapCenter\(\{ lng, lat \}\)/);
  // 只有相机手势(drag/zoom)置位;空白点击与 marker 点击不置位
  // (选择/取消选择公司 ≠ 放弃定位,settle 仍会飞用户位置——ws-poi-vanish)
  assert.match(shell, /onViewEvent\(view, "dragstart", \(\) => \{\s*userMovedMapRef\.current = true/);
  assert.match(shell, /onViewEvent\(view, "zoomstart", \(\) => \{\s*userMovedMapRef\.current = true/);
  assert.doesNotMatch(shell, /map\.on\("click", \(\) => \{\s*userMovedMapRef\.current = true/);
  assert.doesNotMatch(shell, /onMarkerClick: \(id\) => \{[\s\S]{0,120}userMovedMapRef\.current = true/);
  // 定位按钮 handleLocate 原义保留:成功仍无条件 setCenter+setZoom(不受门控);
  // 失败分支保持当前视野,不再 setCenter([120.15,30.27])/setZoom(13) 回杭州
  const locateBlock = shell.slice(shell.indexOf("const handleLocate"), shell.indexOf("const handleMapStyleChange"));
  assert.match(locateBlock, /mapInstance\.current\?\.setCenter\(\{ lng, lat \}\)/);
  assert.match(locateBlock, /mapInstance\.current\?\.setZoom\(15\)/);
  assert.doesNotMatch(locateBlock, /userMovedMapRef/);
  assert.doesNotMatch(locateBlock, /120\.15/);
  assert.doesNotMatch(locateBlock, /setZoom\(13\)/);
});

test('map shell ws-poi-vanish2: 初始视野用 state 快照(remount 恢复视野不回默认)', () => {
  const shell = src('components/map-shell.tsx');
  // useMapEngine 只吃初始值:首渲染捕获 mapCenter/zoom/style 快照——首载 state=默认
  // (行为不变),fast refresh remount 保留 state → 新地图以用户上次视野初始化
  assert.match(shell, /initialMapViewRef\.current = \{ center: \{ \.\.\.mapCenter \}, zoom, style: readInitialMapStyle\(\) \};/);
  assert.match(shell, /useMapEngine\(\{/);
  assert.match(shell, /containerRef: mapContainer,/);
  assert.doesNotMatch(shell, /createMap\(\[120\.15, 30\.27\], 13\)/);
  // state 默认值引用同一常量(与 settle 门控单源,lib/camera-center)
  assert.match(shell, /const \[zoom, setZoom\] = useState\(DEFAULT_MAP_ZOOM\);/);
  assert.match(shell, /useState<\{ lng: number; lat: number \}\>\(\{ \.\.\.DEFAULT_MAP_CENTER \}\)/);
  // createMap 持有视图接线(构造已由引擎 createView 承载),返回 cleanup 由 initMap 持有
  assert.match(shell, /mapCleanup = createMap\(engineView\);/);
  assert.match(shell, /function createMap\(view: MapView\)/);
});

test('map shell ws-poi-vanish2: settle 仅默认位置时飞用户位置,不抢 remount 恢复镜头', () => {
  const shell = src('components/map-shell.tsx');
  const lib = src('lib/camera-center.ts');
  // settle 门控新增「用户已交互」+「相机距默认中心 < 阈值」条件:未移图/未交互且
  // 相机仍处默认才飞(已交互不抢镜头:geolocation resolve 可能晚于首交互)。
  // 2026-08-21 追加「视图已销毁不读相机」门控(StrictMode 双调用弹卡窗口)。
  assert.match(shell, /!view\.isDestroyed\?\.\(\)[\s\S]{0,130}isNearDefaultCenter\(view\.getState\(\)\.center\)\s*\)\s*\{/);
  // 纯函数 + 常量在 lib/camera-center(可单测):默认中心/zoom/阈值/判定
  assert.match(lib, /export const DEFAULT_MAP_CENTER = \{ lng: 120\.15, lat: 30\.27 \} as const;/);
  assert.match(lib, /export const DEFAULT_MAP_ZOOM = 13;/);
  assert.match(lib, /export const DEFAULT_CENTER_NEAR_DEG = 0\.1;/);
  assert.match(lib, /export function isNearDefaultCenter\(/);
  assert.match(lib, /Math\.abs\(center\.lng - DEFAULT_MAP_CENTER\.lng\) < DEFAULT_CENTER_NEAR_DEG/);
});

test('map shell 弹卡路径不置位 userMovedMapRef(2026-08-21:弹卡不动相机)', () => {
  const shell = src('components/map-shell.tsx');
  // 2026-08-21 热修全景:所有「打开二级卡片」的路径(列表卡 / 建议 / 收藏 /
  // 岗位 / 最近回放 / marker 点击)都是侧控栏纯视图——不 flyTo、不置位
  // userMovedMapRef(选择 ≠ 放弃定位,geolocation 晚 settle 仍会飞用户位置;
  // 实测 flyTo 叠加渲染尖峰杀渲染进程)。置位只属于地图手势(dragstart/zoomstart)。
  const popupAnchors = [
    /const handleSelect = useCallback\(\(poi: POI\) => \{[\s\S]{0,200}userMovedMapRef\.current = true/,
    /const handleSelectSuggestion = useCallback\(\(s: SearchSuggestion\) => \{[\s\S]{0,200}userMovedMapRef\.current = true/,
    /const handlePickSaved = useCallback\(\(place: SavedPlace\) => \{[\s\S]{0,160}userMovedMapRef\.current = true/,
    /const handleOpenApplication = useCallback\(\(ref: \{ positionId: string; companyPoiId: string \}\) => \{[\s\S]{0,200}const openCompany = \(company: POI\) => \{[\s\S]{0,120}userMovedMapRef\.current = true/,
    /const openDetail = \(poi: POI\) => \{[\s\S]{0,120}userMovedMapRef\.current = true/,
    /onOpenDetail=\{\(poi\) => \{[\s\S]{0,120}userMovedMapRef\.current = true/,
    /onMarkerClick: \(id\) => \{[\s\S]{0,120}userMovedMapRef\.current = true/,
  ];
  for (const re of popupAnchors) {
    assert.doesNotMatch(shell, re, '弹卡路径不得置位接管相机标记');
  }
  // 置位只保留在地图手势(dragstart/zoomstart)
  assert.match(shell, /onViewEvent\(view, "dragstart", \(\) => \{\s*userMovedMapRef\.current = true/);
  assert.match(shell, /onViewEvent\(view, "zoomstart", \(\) => \{\s*userMovedMapRef\.current = true/);
  // 全库不再有 flyToLocation 调用(弹卡飞行入口整体移除)
  assert.doesNotMatch(shell, /flyToLocation/);
});

test('map shell ws-poi-vanish handleLocate 失败保持视野:不回杭州默认中心', () => {
  const shell = src('components/map-shell.tsx');
  const locateBlock = shell.slice(shell.indexOf("const handleLocate"), shell.indexOf("const handleMapStyleChange"));
  // 成功分支仍飞用户位置(setCenter+setZoom 15,经视图契约)
  assert.match(locateBlock, /mapInstance\.current\?\.setCenter\(\{ lng, lat \}\)/);
  assert.match(locateBlock, /mapInstance\.current\?\.setZoom\(15\)/);
  // !loc 与 catch 失败分支:保持当前视野,不再 setCenter([120.15,30.27])/setZoom(13)
  assert.doesNotMatch(locateBlock, /setCenter\(\[120\.15, 30\.27\]\)/);
  assert.doesNotMatch(locateBlock, /setZoom\(13\)/);
});

test('map shell ws-poi-vanish distance 圆心:定位落地前 distance 筛选不生效', () => {
  const shell = src('components/map-shell.tsx');
  // 半径 gating:定位成功(userLocation)前视同无 distance——mapCenter 还是杭州
  // 默认值,带 distance 的缓存恢复若以杭州为圆心过滤会把用户区域 POI 整池裁掉
  assert.match(shell, /const distanceRadius = userLocation \? distanceFilterMeters\(filters\) : 0;/);
  // pipeline 入参:定位前剥离 distance 键(圆心未落地 → 不裁池)
  assert.match(
    shell,
    /const effectiveFilters: FilterState \| undefined =[\s\S]{0,240}Object\.fromEntries\(Object\.entries\(filters\)\.filter\(\(\[key\]\) => key !== "distance"\)\);/
  );
  // 列表(pois)与 marker 池(workMarkerPois)两个 pipeline 调用点都吃 effectiveFilters
  const matches = shell.match(/filters: effectiveFilters && Object\.keys\(effectiveFilters\)\.length \? effectiveFilters : undefined/g);
  assert.ok(matches && matches.length >= 2, 'both pipeline call sites use effectiveFilters');
});

test('logout resets saved overlay state and pref alongside saved places', () => {
  const shell = src('components/map-shell.tsx');
  const savedLayer = src('hooks/use-saved-layer.ts');
  const logoutBlock = shell.slice(shell.indexOf("const handleAuthAction"), shell.indexOf("const handleSaveProfile"));
  // 登出分支清空 savedPlaces 的同时隐藏收藏图层(hide 重置状态 + 持久化 pref,避免收藏图层静默消失)
  assert.match(logoutBlock, /setUser\(null\)/);
  assert.match(logoutBlock, /setSavedPlaces\(\[\]\)/);
  assert.match(logoutBlock, /hideSavedOverlay\(\);/);
  // hide 随 useSavedLayer 抽取:重置 savedOverlay 状态 + 持久化 pref
  assert.match(savedLayer, /const hide = useCallback\(\(\) => \{\s*setSavedOverlay\(false\);\s*writeSavedOverlayPref\(false\);\s*\}, \[\]\);/);
});

test('useSavedLayer owns saved overlay state, derivation and guest gate (QA scan #6)', () => {
  const shell = src('components/map-shell.tsx');
  const hook = src('hooks/use-saved-layer.ts');
  // 派生:overlay POI 由 savedPlaces + 目录 + 模式算出(与 marker 池合并共用同一 memo 依赖)
  assert.match(hook, /savedPlacesToOverlay\(savedPlaces, compareCatalog, mode\)/);
  // 挂载初始化:读回持久化偏好(原 map-shell 挂载 effect 的对应行)
  assert.match(hook, /setSavedOverlay\(readSavedOverlayPref\(true\)\)/);
  // toggle:未登录 → onRequireAuth(打开登录弹窗),不回写 pref;登录 → 写 pref + 翻转状态
  assert.match(hook, /if \(!user\) \{\s*onRequireAuthRef\.current\(\);\s*return;\s*\}/);
  assert.match(hook, /const next = !savedOverlay;\s*writeSavedOverlayPref\(next\);\s*setSavedOverlay\(next\);/);
  assert.match(hook, /if \(!next\) return;/);
  // map-shell 接线:overlayPois/savedOverlay 仍供 marker 池合并与 LOD 恒显示(行为不变)
  assert.match(shell, /mergeMapPois\(pois, overlayPois, savedOverlay && Boolean\(user\)\)/);
  assert.match(shell, /if \(overlayIds\.has\(p\.id\)\) return true; \/\/ 收藏 overlay 恒显示/);
});

test('work no-category empty state renders candidate category rows wired to filters', () => {
  const list = src('components/poi-list.tsx');
  const sidebar = src('components/secondary-sidebar.tsx');
  const css = src('components/poi-list.module.css');
  // POIList 空态槽位接受候选类别列表行 + 点击回调
  assert.match(list, /candidateCategories\?: \{ key: string; value: string; label: string \}\[\]/);
  assert.match(list, /onPickCategory\?: \(key: string, value: string\) => void/);
  assert.match(list, /candidateCategories && candidateCategories\.length > 0/);
  assert.match(list, /onClick=\{\(\) => onPickCategory\?\.\(chip\.key, chip\.value\)\}/);
  // Apple 列表行(一行一类):行按钮 + label + 行末 chevron;不再复用 filter-panel chips
  assert.doesNotMatch(list, /filterStyles/);
  assert.match(list, /className=\{styles\.candidateRow\}/);
  assert.match(list, /<span className=\{styles\.candidateLabel\}>\{chip\.label\}<\/span>/);
  assert.match(list, /className=\{styles\.candidateChevron\}/);
  assert.match(list, /viewBox="0 0 12 20"/);
  assert.match(list, /d="m4 2 8 8-8 8"/);
  assert.match(list, /strokeWidth="2\.2"/);
  // 玻璃容器(候选类别卡片)
  assert.match(css, /\.candidateCard \{[\s\S]*border-radius: 14px/);
  assert.match(css, /\.candidateCard \{[\s\S]*backdrop-filter: blur\(20px\) saturate\(165%\)/);
  // 列表布局:行满宽 + 细分隔线(末行无)+ 灰调 chevron
  assert.match(css, /\.candidateRow \{[\s\S]*border-bottom: 1px solid var\(--line\)/);
  assert.match(css, /\.candidateRow:last-child \{[\s\S]*border-bottom: 0/);
  assert.match(css, /\.candidateChevron \{[\s\S]*width: 9px/);
  // 数据源 getMode(mode).filters:未选类别(无 query/jobTaxonomy/roleFamily)→ 出候选行
  assert.match(sidebar, /export function workCandidateCategories/);
  assert.match(sidebar, /getMode\(mode\)\.filters/);
  assert.match(sidebar, /config\.key !== "jobTaxonomy" && config\.key !== "roleFamily"/);
  assert.match(sidebar, /selectedTaxonomyPaths\(filters\)\.length > 0/);
  assert.match(sidebar, /selectedRoleFamilies\(filters\)\.length > 0/);
  // 桌面 sidebar 接线:未选 → 空态标题 + 候选列表;点击写 filters[key](pickCategoryFilter 按类型选值)
  assert.match(sidebar, /candidateChips = candidateCategoriesFor\(mode, query, filters\)/);
  assert.match(sidebar, /candidateCategories=\{candidateChips\.length > 0 \? candidateChips : undefined\}/);
  assert.match(sidebar, /onPickCategory=\{\(key, value\) => onFiltersChange\(pickCategoryFilter\(filters, mode, key, value\)\)\}/);
  // 移动抽屉 POIList(map-shell)同链路
  const shell = src('components/map-shell.tsx');
  assert.match(shell, /mobileCandidateChips = candidateCategoriesFor\(mode, query, filters\)/);
  assert.match(shell, /candidateCategories=\{mobileCandidateChips\.length > 0 \? mobileCandidateChips : undefined\}/);
  assert.match(shell, /onPickCategory=\{\(key, value\) => setFilters\(pickCategoryFilter\(filters, mode, key, value\)\)\}/);
});

test('domain no-category empty state renders candidate category rows (single-select write)', () => {
  const sidebar = src('components/secondary-sidebar.tsx');
  const shell = src('components/map-shell.tsx');
  // domain 分支:数据源 = getMode(mode).filters 的 category(select 单选);未选类(无 query/filters.category)→ 出 9 类候选行
  assert.match(sidebar, /export function domainCandidateCategories/);
  assert.match(sidebar, /if \(canonicalMode\(mode\) !== "domain"\) return \[\]/);
  assert.match(sidebar, /if \(query\.trim\(\)\) return \[\]/);
  assert.match(sidebar, /if \(filters\.category\) return \[\]/);
  assert.match(sidebar, /config\.key !== "category" \|\| config\.type !== "select"/);
  // 合并助手:work + domain 各取各的(模式互斥),桌面/移动共用
  assert.match(sidebar, /export function candidateCategoriesFor/);
  assert.match(sidebar, /\.\.\.workCandidateCategories\(mode, query, filters\),/);
  assert.match(sidebar, /\.\.\.domainCandidateCategories\(mode, query, filters\),/);
  // 行点击:单选(select)写字符串(domain category),多选写数组(work)——与 FilterPanel 语义一致
  assert.match(sidebar, /export function pickCategoryFilter/);
  assert.match(sidebar, /isSingle \? value : \[value\]/);
  // domain 空态标题由 domainNoCategory 驱动(poi-category-loading 契约),候选行非空时同槽位渲染
  assert.match(sidebar, /config\.kind === "domain" && !filters\.category && !query\.trim\(\)/);
  assert.match(sidebar, /emptyTitle=\{\s*domainNoCategory \|\| candidateChips\.length > 0 \? t\("pickCategory", lang\) : undefined\s*\}/);
  // 移动抽屉同链路走同一合并助手(domain 未选类也出候选行)
  assert.match(shell, /mobileCandidateChips = candidateCategoriesFor\(mode, query, filters\)/);
  assert.match(shell, /emptyTitle=\{mobileCandidateChips\.length > 0 \? t\("pickCategory", lang\) : undefined\}/);
});

test('profile language/defaultMode prefs are PrefField dropdowns sharing the job-seeking chain', () => {
  const panel = src('components/account-panel.tsx');
  // PrefField 类型扩两个单选字段
  assert.match(
    panel,
    /type PrefField = "status" \| "families" \| "industries" \| "strengths" \| "language" \| "defaultMode"/,
  );
  // 偏好两行走 renderPrefTrigger(与求职偏好同一套触发钮/浮层)
  assert.match(panel, /renderPrefTrigger\("language", t\("prefLanguage", lang\), languageText\)/);
  assert.match(panel, /renderPrefTrigger\("defaultMode", t\("prefDefaultMode", lang\), defaultModeText\)/);
  assert.match(panel, /const languageText = prefs\.language === "zh" \? "中文" : "English"/);
  assert.match(panel, /const defaultModeText = getMode\(prefs\.defaultMode\)\.name/);
  // 浮层选项:language=[中文, English];defaultMode=ACTIVE_MODES 显示名
  assert.match(panel, /\{ id: "zh", label: "中文" \}/);
  assert.match(panel, /\{ id: "en", label: "English" \}/);
  assert.match(panel, /options = ACTIVE_MODES\.map\(\(m\) => \(\{ id: m, label: getMode\(m\)\.name \}\)/);
  // 单选 onSelect 即存即关,持久化链路与求职偏好一致(persistPrefs→onSave→PATCH)
  assert.match(panel, /persistPrefs\(mergePreferences\(prefs, \{ language: id as Language \}\)/);
  assert.match(panel, /persistPrefs\(mergePreferences\(prefs, \{ defaultMode: id as MapMode \}\)/);
  assert.match(panel, /closeMenu\(\);/);
  // pill 切换已移除
  assert.doesNotMatch(panel, /pillRow/);
  assert.doesNotMatch(panel, /styles\.choice/);
});

test('map-engine core contract: env keyVars + priority order + coordinate norm (ws-b)', () => {
  const registry = src('lib/map-engine/engine-registry.ts');
  const types = src('lib/map-engine/types.ts');
  const preference = src('lib/map-engine/engine-preference.ts');
  // 注册表引用的 env 名恰为三个 keyVar(契约:运行时读 process.env,Next 构建期内联)
  assert.match(registry, /NEXT_PUBLIC_AMAP_KEY/);
  assert.match(registry, /NEXT_PUBLIC_TENCENT_JSAPI_KEY/);
  assert.match(registry, /NEXT_PUBLIC_BAIDU_AK/);
  // 注册表不 import amap-api(AMap 完整实现由 ws-c 独立完成,内核不反向依赖厂商适配)
  assert.doesNotMatch(registry, /from\s+['"].*amap-api['"]/);
  // 优先级顺序断言
  assert.match(registry, /ENGINE_PRIORITY: MapEngineId\[\] = \['amap', 'tencent', 'baidu'\]/);
  // types.ts keyVar 闭合联合(与注册表三引擎一一对应)
  assert.match(
    types,
    /'NEXT_PUBLIC_AMAP_KEY'\s*\|\s*'NEXT_PUBLIC_TENCENT_JSAPI_KEY'\s*\|\s*'NEXT_PUBLIC_BAIDU_AK'/,
  );
  // 坐标规范:规范坐标 = gcj02(注释契约)
  assert.match(types, /规范坐标 = gcj02/);
  // 偏好 key 契约
  assert.match(preference, /domain-map:engine/);
  // 偏好会话级契约:sessionStorage(新会话/标签页默认回落优先级第一=高德),
  // 不再使用 localStorage 跨会话持久化(用户要求默认高德)
  assert.match(preference, /sessionStorage/);
  assert.doesNotMatch(preference, /localStorage/);
});

test('map-engine core: registry skeleton never touches vendor SDK globals directly (ws-b)', () => {
  const registry = src('lib/map-engine/engine-registry.ts');
  // 骨架阶段:注册表只读环境变量与命名空间名,不得直接调用厂商对象
  // (厂商调用点统一收口到 ws-c/d/e 的引擎实现,内核保持厂商无关)
  assert.doesNotMatch(registry, /window\.AMap/);
  assert.doesNotMatch(registry, /window\.TMap/);
  assert.doesNotMatch(registry, /window\.BMapGL/);
});

test('map-shell 迁移完成:不再出现 new window.AMap 直构造(ws-c 轮 2)', () => {
  const shell = src('components/map-shell.tsx');
  // 轮 2 收口断言:8 处 window.AMap 直引用全部迁移到 MapView 契约后,
  // 组件内不得再出现直构造
  assert.doesNotMatch(shell, /new\s+window\.AMap/);
  assert.doesNotMatch(shell, /new\s+AMap\.Map/);
});

test('地图源 section + 引擎切换接线契约(ws-f)', () => {
  const panel = src('components/layers-panel.tsx');
  const hook = src('hooks/use-map-engine.ts');
  const switcher = src('lib/map-engine/switch.ts');
  const registry = src('lib/map-engine/engine-registry.ts');
  const i18n = src('lib/i18n.ts');

  // 图层面板「地图源」section:引擎列表/configured 来自注册表,点击调 switchEngine
  assert.match(panel, /mapSource/);
  assert.match(panel, /ENGINE_PRIORITY/);
  assert.match(panel, /getEngine\(id\)/);
  assert.match(panel, /\.isConfigured\(\)/);
  assert.match(panel, /switchEngine\(id\)/);
  assert.match(panel, /engineChip/);
  assert.match(panel, /data-tooltip/); // 未配置 tooltip(现有 tooltip 模式)
  assert.match(panel, /engineNotConfigured/);
  assert.match(panel, /readEnginePreference/); // 自动/手动判定
  assert.match(panel, /engineManual/);
  // 移动端复用:section 作为独立组件导出
  assert.match(panel, /export function MapSourceSection/);

  // hook:切换编排 + 偏好写入 + isSwitching + 面板总线
  assert.match(hook, /switchMapEngine/);
  assert.match(hook, /writeEnginePreference/);
  assert.match(hook, /isSwitching/);
  assert.match(hook, /useMapEnginePanel/);

  // switch.ts:纯编排 + 引擎注入(DI)——不 import 注册表/厂商实现
  assert.doesNotMatch(switcher, /engine-registry/);
  assert.doesNotMatch(switcher, /amap-engine|tencent-engine|baidu-engine/);

  // 注册表:统一接线入口(ws-f 三引擎装配)
  assert.match(registry, /registerEngine/);

  // i18n 新 key:地图源/三家引擎名/自动·手动/未配置 tooltip
  for (const key of [
    'mapSource',
    'engineAmap',
    'engineTencent',
    'engineBaidu',
    'engineAuto',
    'engineManual',
    'engineClickToSwitch',
    'engineNotConfigured',
  ]) {
    assert.match(i18n, new RegExp(`${key}:`));
  }
});

test('agent ball has a labelled glass button and toggles the panel (ws-c)', () => {
  const ball = src('components/agent-ball.tsx');
  const css = src('components/agent-ball.module.css');
  // 悬浮球:44px 圆形玻璃按钮,aria-label 走 i18n agentBall 键
  assert.match(ball, /aria-label=\{t\("agentBall", lang\)\}/);
  assert.match(ball, /"use client"/);
  assert.match(ball, /dm\.agent-ball-pos/); // 位置持久化 key
  assert.match(ball, /DRAG_THRESHOLD_PX = 3/); // 3px 阈值区分点击/拖动
  assert.match(ball, /AgentPanel/); // 点击展开面板
  assert.match(css, /height:\s*44px;[\s\S]*width:\s*44px/);
  assert.match(css, /backdrop-filter: blur\(24px\) saturate\(165%\)/); // 玻璃拟态
  assert.match(css, /z-index: 11/); // 高于地图控件
  assert.match(css, /cubic-bezier\(0\.32, 0\.72, 0, 1\)/); // 吸附动画曲线
});

test('agent panel has input, send/stop/undo buttons and tool status bar (ws-c)', () => {
  const panel = src('components/agent-panel.tsx');
  const css = src('components/agent-panel.module.css');
  assert.match(panel, /"use client"/);
  // 输入框 + 发送/停止/撤销按钮
  assert.match(panel, /t\("agentInput", lang\)/);
  assert.match(panel, /t\("agentSend", lang\)/);
  assert.match(panel, /t\("agentStop", lang\)/);
  assert.match(panel, /t\("agentUndo", lang\)/);
  // tool 状态条 + 未配置提示 + 建议卡片(点击 = 重放该 action)
  assert.match(panel, /agentToolRunning/);
  assert.match(panel, /LLM_UNCONFIGURED/);
  assert.match(panel, /replayAction/);
  // 历史:sessionStorage cap 30
  assert.match(panel, /dm\.agent-history\.v1/);
  assert.match(panel, /HISTORY_CAP = 30/);
  // 新会话首条自动带视口快照
  assert.match(panel, /viewport: \{ center: snapshot\.center, zoom: snapshot\.zoom \}/);
  // 360px × 70vh liquid glass 卡片
  assert.match(css, /width: 360px/);
  assert.match(css, /height: 70vh/);
  assert.match(css, /backdrop-filter: blur\(24px\) saturate\(165%\)/);
  assert.match(css, /@media \(max-width: 767px\)/); // 移动端全宽 sheet
});

test('map shell has the AgentBall seam (ws-c, 红线豁免只追加)', () => {
  const shell = src('components/map-shell.tsx');
  const bridge = src('lib/agent-map-bridge.ts');
  // seam 三处:import + ref(惰性初始化)+ JSX
  assert.match(shell, /import AgentBall from "\.\/agent-ball";/);
  assert.match(shell, /agentBridgeRef = useRef<MapBridge \| null>\(null\)/);
  assert.match(shell, /createAgentBridge\(engineView/);
  assert.match(shell, /<AgentBall bridge=\{agentBridgeRef\.current\} lang=\{lang\} \/>/);
  // bridge 实现只认 MapView 门面,不直连厂商全局
  assert.match(bridge, /import type \{ MapView \} from "\.\/map-engine\/types\.ts"/);
  assert.doesNotMatch(bridge, /window\.AMap/);
  assert.match(bridge, /view\.createMarker/);
  assert.match(bridge, /view\.createCircle/);
});

test('map-engine 契约:env 读取必须裸字面量,禁止 process.env[ 动态访问(ws-b 轮 3)', () => {
  // 2026-08-21 bugfix:图层面板三 chip 全部「未配置 key」,根因是 isConfigured / key 读取
  // 用了 process.env[常量] 括号动态访问——Node 下正常、浏览器端(Next 构建期只做静态
  // 字面量替换)恒 undefined,测试全绿抓不到。契约:引擎目录内所有代码只允许
  // process.env.NEXT_PUBLIC_XXX 裸字面量形式。
  const engineDir = join(root, 'lib', 'map-engine');
  const files = readdirSync(engineDir, { recursive: true }).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length >= 3, 'map-engine 目录应至少含 registry/tencent/baidu 三引擎文件');
  for (const rel of files) {
    const code = readFileSync(join(engineDir, rel), 'utf8');
    assert.doesNotMatch(
      code,
      /process\.env\[/,
      `${rel} 不得含 process.env[ 动态访问(浏览器端恒 undefined,须改裸字面量)`,
    );
  }
  // 三引擎 isConfigured / key 读取必须能定位到具体字面量 key(静态分派已生效)
  const registry = src('lib/map-engine/engine-registry.ts');
  for (const key of ['NEXT_PUBLIC_AMAP_KEY', 'NEXT_PUBLIC_TENCENT_JSAPI_KEY', 'NEXT_PUBLIC_BAIDU_AK']) {
    assert.match(registry, new RegExp(`process\\.env\\.${key}`), `registry 应含裸字面量 ${key}`);
  }
});

test('map-adapter.ts 空壳已删除(ws-g 收尾):文件不存在且 src 零引用', () => {
  // 轮 2 map-shell 迁移完成后,lib/map-adapter.ts(6 行空壳)的 seam 已被
  // map-engine(types/registry/switch)取代;ws-g 删除该文件。
  assert.equal(
    existsSync(join(root, 'lib/map-adapter.ts')),
    false,
    'lib/map-adapter.ts 必须已删除',
  );
  // 零引用契约:src 下不得再有 map-adapter / getMapAdapter 导入或调用
  const srcFiles = [
    'app/page.tsx',
    'components/map-shell.tsx',
    'components/layers-panel.tsx',
    'hooks/use-map-engine.ts',
    'lib/map-engine/engine-registry.ts',
    'lib/map-engine/switch.ts',
    'lib/map-engine/types.ts',
    'lib/poi-service.ts',
    'lib/map-markers.ts',
  ];
  for (const rel of srcFiles) {
    assert.doesNotMatch(src(rel), /map-adapter|getMapAdapter/, `${rel} 不得引用 map-adapter`);
  }
});

test('map-shell onViewEvent 保留 this 绑定(2026-08-21 热修:解构裸调 TypeError)', () => {
  // 回归守卫:view.on 是引擎方法(实现依赖 this.map),取出后必须 call(view, ...) 调用。
  // 裸调 on(event, cb) 在 ESM 严格模式下 this 为 undefined → 页面每次加载抛
  // "Cannot read properties of undefined (reading 'map')"(amap-engine.ts:184);
  // 其终端代码帧还触发上游 next-code-frame 对 CJK 长行截断 panic
  // (vercel/next.js#92641)abort dev server——双层事故,同根同修。
  const shell = src('components/map-shell.tsx');
  const fnAt = shell.indexOf('function onViewEvent(');
  assert.ok(fnAt !== -1, 'onViewEvent 锚点存在');
  const fnBlock = shell.slice(fnAt, fnAt + 500);
  assert.match(fnBlock, /const on = view\.on/, '先取出方法引用(契约扩展收口)');
  assert.match(fnBlock, /\.call\(view, event, cb\)/, '必须以 call(view, ...) 调用保留 this');
  assert.doesNotMatch(fnBlock, /return on\(event, cb\)\s*;/, '不得裸调(丢 this 即丢 map)');
});

test('markdown-text: 组件引用 marked 与 dompurify,且消毒先于注入(ws-c-enhance)', () => {
  // 管线 = components/markdown-text.tsx(组件侧)+ lib/markdown-pipeline.ts(纯逻辑);
  // 组件必须引用两者(组件直接引用 dompurify,经 pipeline 引用 marked)
  const text = src('components/markdown-text.tsx');
  const pipeline = src('lib/markdown-pipeline.ts');
  assert.match(text, /"use client"/);
  assert.match(text, /import DOMPurify from "dompurify"/);
  assert.match(pipeline, /import \{ Marked[^\n]*\} from "marked"/);
  // 安全红线:renderMarkdown 调用(sanitize 在管线内)→ 先于 dangerouslySetInnerHTML
  const sanitizeAt = text.indexOf('DOMPurify.sanitize');
  const injectAt = text.indexOf('dangerouslySetInnerHTML');
  assert.ok(sanitizeAt !== -1 && injectAt !== -1 && sanitizeAt < injectAt, 'sanitize 必须先于 dangerouslySetInnerHTML');
  // DOMPurify 配置:USE_PROFILES html 收窄 + ADD_ATTR target(默认白名单无 target)
  assert.match(text, /USE_PROFILES: \{ html: true \}/);
  assert.match(text, /ADD_ATTR: \["target"\]/);
  // 链接统一 target=_blank + rel=noopener(renderer 钩子)
  assert.match(pipeline, /LINK_TARGET = "_blank"/);
  assert.match(pipeline, /LINK_REL = "noopener noreferrer"/);
  assert.match(pipeline, /target="\$\{LINK_TARGET\}"/);
  assert.match(pipeline, /rel="\$\{LINK_REL\}"/);
  // 消毒器注入参数化(管线可单测;生产注入 DOMPurify)
  assert.match(pipeline, /sanitize: \(html: string\) => string/);
});

test('agent panel follows the ball via transform anchor (ws-c-enhance)', () => {
  const panel = src('components/agent-panel.tsx');
  const css = src('components/agent-panel.module.css');
  // 纯函数定位:computePanelPlacement 输入 ballRect + 面板实测尺寸 + 视口 + 吸附 edge
  // (edge 缺省/拖拽中传 undefined → 按球心半区分侧;吸附后传 edge → 垂直锚定,2026-08-21 ws-nfix)
  assert.match(panel, /import \{ computePanelPlacement[^\n]*\} from "@\/lib\/agent-panel-placement"/);
  assert.match(panel, /computePanelPlacement\(ballRect, panelSize, viewport, snapEdge \?\? undefined\)/);
  // transform 锚定:--px/--py 注入 + translate3d(拖动实时跟随,松手平滑归位)
  assert.match(panel, /"--px": `\$\{placement\.left\}px`/);
  assert.match(panel, /"--py": `\$\{placement\.top\}px`/);
  assert.match(css, /transform: translate3d\(var\(--px, 0px\), var\(--py, 12px\), 0\)/);
  assert.match(css, /transition: transform 0\.35s cubic-bezier\(0\.32, 0\.72, 0, 1\)/);
  assert.match(css, /\.panelDragging \{\s*animation: none;\s*transition: none;/);
  // z-index:球 11、面板 12
  assert.match(css, /z-index: 12/);
  const ballCss = src('components/agent-ball.module.css');
  assert.match(ballCss, /z-index: 11/);
  // 极窄视口 sheet 复用移动端底部抽屉模式
  assert.match(css, /\.panelSheet \{/);
  assert.match(css, /border-radius: 20px 20px 0 0/);
  assert.match(css, /height: min\(72svh, 560px\)/);
  // 移动端(≤767px)恒 sheet,不受球位置影响(transform 覆盖为 none)
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*transform: none/);
  // 球把 ballRect + dragging 传给面板
  const ball = src('components/agent-ball.tsx');
  assert.match(ball, /ballRect=\{ballRect\}/);
  assert.match(ball, /dragging=\{dragging\}/);
});

test('agent panel renders thinking + tool activity for assistant messages (ws-c-enhance)', () => {
  const panel = src('components/agent-panel.tsx');
  const css = src('components/agent-panel.module.css');
  const i18n = src('lib/i18n.ts');
  // 思考过程:可折叠按钮 + muted 小字 + 滚动上限
  assert.match(panel, /agentThinkingSection/);
  assert.match(panel, /thinkingToggle/);
  assert.match(panel, /aria-expanded=\{!isCollapsed\}/);
  assert.match(panel, /thinkingBody/);
  assert.match(css, /\.thinkingBody \{[\s\S]*max-height: 140px[\s\S]*overflow-y: auto/);
  // 工具活动列表:⟳ 开始 / ✓ 完成 / ✗ 失败 + 友好工具名 + summary
  assert.match(panel, /toolActivity/);
  assert.match(panel, /friendlyToolName\(toolItem\.name, lang\)/);
  assert.match(panel, /toolItem\.status === "start" \? "⟳" : toolItem\.status === "done" \? "✓" : "✗"/);
  assert.match(panel, /toolRowError/);
  assert.match(css, /\.toolActivity \{/);
  // 助手消息体走 MarkdownText(用户消息保持纯文本)
  assert.match(panel, /import \{ MarkdownText \} from "\.\/markdown-text"/);
  assert.match(panel, /m\.role === "assistant" \? <MarkdownText text=\{m\.content\} \/> : m\.content/);
  // i18n 新键
  assert.match(i18n, /agentThinkingSection: \{[\s\S]*思考过程[\s\S]*Thinking/);
  assert.match(i18n, /agentToolsSection: \{[\s\S]*工具调用[\s\S]*Tool calls/);
  // 既有能力保留
  assert.match(panel, /replayAction/);
  assert.match(panel, /LLM_UNCONFIGURED/);
  assert.match(panel, /dm\.agent-history\.v1/);
});

test('map-shell 弹卡不动相机(2026-08-21 热修:二级卡片 = 侧控栏纯视图)', () => {
  // 回归守卫:所有弹卡路径(桌面 onOpenDetail / 移动抽屉 POIList onSelect /
  // 建议 / 收藏 / 岗位 / 最近回放)都只做侧栏动作,不得 flyTo —— 弹卡动地图
  // 会触发地图动画 + work 列表按视野重过滤重排(体感 = 刷新页面),且实测
  // flyTo 叠加渲染尖峰杀渲染进程(建议/收藏全崩,唯独已移除 flyTo 的探索弹卡
  // 不崩)。flyToLocation 辅助函数已整体删除。
  const shell = src('components/map-shell.tsx');

  // 桌面侧栏 onOpenDetail
  const desktopAt = shell.indexOf('onOpenDetail={(poi) => {');
  assert.ok(desktopAt !== -1, 'onOpenDetail 锚点存在');
  const desktopBlock = shell.slice(desktopAt, desktopAt + 700);
  assert.match(desktopBlock, /setDetailPoi\(poi\)/, '弹卡打开详情');
  assert.doesNotMatch(desktopBlock, /flyToLocation/, '弹卡不得 flyTo(不接管相机)');
  assert.doesNotMatch(desktopBlock, /userMovedMapRef\.current = true/, '弹卡不置位接管相机标记');

  // 移动抽屉 POIList onSelect
  const scrollAnchor = 'drawerScrollRef.current = drawerContentRef.current?.scrollTop ?? 0;';
  const mobileAt = shell.indexOf(scrollAnchor);
  assert.ok(mobileAt !== -1, '移动抽屉滚动锚点存在');
  const mobileBlock = shell.slice(mobileAt, mobileAt + 260);
  assert.match(mobileBlock, /setDetailPoi\(poi\)/, '移动弹卡打开详情');
  assert.doesNotMatch(mobileBlock, /flyToLocation/, '移动弹卡也不得 flyTo');

  // 建议选择也不得 flyTo(2026-08-21 二轮热修:实测建议选择崩溃,与探索弹卡
  // 唯一区别就是 flyTo)
  const suggestionAt = shell.indexOf('const handleSelectSuggestion = useCallback');
  assert.ok(suggestionAt !== -1, 'handleSelectSuggestion 锚点存在');
  const suggestionBlock = shell.slice(suggestionAt, suggestionAt + 400);
  assert.doesNotMatch(suggestionBlock, /flyToLocation|userMovedMapRef\.current = true/, '建议选择不得 flyTo/置位');

  // 全文件零 flyToLocation 调用(辅助函数整体移除)
  assert.doesNotMatch(shell, /flyToLocation/);
});

test('StrictMode 双调用不再杀活图(2026-08-21 热修:dynamic 面板挂载 → double-invoke 崩溃链路)', () => {
  // 实测链路:挂载 Next dynamic 面板(最近/收藏/图层等)使 MapShell fiber 在 dev
  // StrictMode 下被 double-invoke(disconnect→reconnect 同一 commit 内同步)。
  // disconnect 跑 useMapEngine cleanup —— 若立即销毁活图,reconnect 里「接线 effect」
  // 拿着已销毁的旧 view 重跑 createMap → 首帧 syncView → AMap getCenter 抛
  // `getOptions` undefined → Fast Refresh 整页重载(用户看到的「点面板后页面挂了」)。
  // 断言:cleanup 交棒 keepalive 不销毁;重连同容器接管;真卸载延迟销毁兜底;
  // 接线 effect 对已销毁视图直接跳过;geolocation settle 对已销毁视图不读相机。
  const hook = src('hooks/use-map-engine.ts');
  const shell = src('components/map-shell.tsx');

  // use-map-engine:cleanup 不再无条件销毁活图(交棒 keepalive + 延迟销毁兜底)
  const cleanupAt = hook.indexOf('keepaliveRef.current = { view: doomed, container }');
  assert.ok(cleanupAt !== -1, 'keepalive 交棒锚点存在');
  const cleanupBlock = hook.slice(cleanupAt, cleanupAt + 420);
  assert.match(cleanupBlock, /setTimeout/, '延迟销毁(真卸载兜底)');
  assert.match(cleanupBlock, /if \(viewRef\.current !== doomed\)/, '已被接管则跳过销毁');
  assert.doesNotMatch(hook, /viewRef\.current\?\.destroy\(\)/, 'cleanup 不得直接销毁活图');

  // use-map-engine:重连接管(同容器、同引擎、未销毁、容器挂载)
  const reuseAt = hook.indexOf('const keep = keepaliveRef.current;');
  assert.ok(reuseAt !== -1, '重连接管锚点存在');
  const reuseBlock = hook.slice(reuseAt, reuseAt + 760);
  assert.match(reuseBlock, /keep\.container === container/, '仅同容器接管');
  assert.match(reuseBlock, /keep\.view\.engine\.id/, '同引擎才接管');
  assert.match(reuseBlock, /container\.isConnected/, '容器仍挂载才接管');
  assert.match(reuseBlock, /setView\(keep\.view\)/, '接管后状态恢复');
  // 接管后必须再次交棒(disconnect/reconnect 共用 relinquishView,链条不断)
  assert.match(reuseBlock, /return relinquishView;/, '接管后 cleanup 仍交棒');

  // map-shell 接线 effect:已销毁视图跳过 createMap(防 reconnect 崩溃)
  const wiringAt = shell.indexOf('mapInstance.current = engineView;');
  assert.ok(wiringAt !== -1, '接线 effect 锚点存在');
  const wiringBlock = shell.slice(wiringAt, wiringAt + 300);
  assert.match(wiringBlock, /engineView\.isDestroyed\?\.\(\)/, '已销毁视图门控');
  assert.match(wiringBlock, /if \(!engineView \|\| engineView\.isDestroyed\?\.\(\)\) return;/, '已销毁视图直接跳过接线');

  // geolocation settle:已销毁视图不读相机(异步竞态门控)
  const settleAt = shell.indexOf('isNearDefaultCenter(view.getState().center)');
  assert.ok(settleAt !== -1, 'settle 相机门控锚点存在');
  const settleBlock = shell.slice(Math.max(0, settleAt - 120), settleAt + 40);
  assert.match(settleBlock, /!view\.isDestroyed\?\.\(\)/, 'settle 对已销毁视图不读相机');
});
