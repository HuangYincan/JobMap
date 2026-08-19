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
  // 空批次保护(work + domain 视口替换各一处,随 useWorkViewport 抽取到 hook;
  // 已有非空目录时空批次保留旧目录)
  const guards = hook.match(/batch\.length === 0 && catalogRef\.current\.length > 0/g);
  assert.ok(guards && guards.length >= 2, 'work + domain 两处空批次保护');
  // 空态提示:新 i18n 键 + POIList emptyTitle 接线
  assert.match(i18n, /pickCategory: \{[\s\S]*选择类别开始浏览[\s\S]*Pick a category to explore/);
  assert.match(list, /emptyTitle\?: string/);
  assert.match(list, /emptyTitle \?\? t\("noResults", lang\)/);
  assert.match(sidebar, /emptyTitle=\{domainNoCategory \? t\("pickCategory", lang\) : undefined\}/);
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
  // 方案 A:保留 fit-to-pins 相机移动,但在移动前打开抑制窗口,吞掉 setBounds 触发的
  // moveend/zoomend 视口刷新(空批次会整体替换清空目录 → 所有 poi 消失)。
  // 抑制窗口常量随 useWorkViewport 抽取,ref 仍在 map-shell 创建并传入 hook
  assert.match(hook, /export const VIEWPORT_SUPPRESS_MS = 500/);
  assert.match(shell, /suppressViewportRefreshUntilRef = useRef\(0\)/);
  // onViewChange 随 hook 移动:抑制窗口内直接 return,不 schedule
  assert.match(hook, /const onViewChange = \(\) => \{[\s\S]{0,200}suppressViewportRefreshUntilRef\.current > Date\.now\(\)[\s\S]{0,80}return;[\s\S]{0,80}loader\.schedule\(\);/);
  // 抑制标记必须在相机移动(setBounds / setCenter fallback)之前置位——限定在 toggle 函数体内比较
  const toggleAt = shell.indexOf('const handleToggleSavedOverlay = useCallback');
  const modeSwitchAt = shell.indexOf('const handleModeChange = useCallback');
  assert.ok(toggleAt !== -1 && modeSwitchAt > toggleAt, 'toggle/mode-switch anchors must exist in order');
  const toggleBody = shell.slice(toggleAt, modeSwitchAt);
  const setAt = toggleBody.indexOf('suppressViewportRefreshUntilRef.current = Date.now() + VIEWPORT_SUPPRESS_MS');
  const boundsAt = toggleBody.indexOf('map.setBounds(new AMap.Bounds');
  const centerAt = toggleBody.indexOf('map.setCenter?.(');
  assert.ok(setAt !== -1 && boundsAt !== -1 && centerAt !== -1, 'suppress marker / setBounds / setCenter must all exist in toggle');
  assert.ok(setAt < boundsAt, 'suppress marker must be set before map.setBounds');
  assert.ok(setAt < centerAt, 'suppress marker must be set before map.setCenter fallback');
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
  // 请求失败(网络/非 2xx):保留旧目录 + console.warn(现状行为保持,随 hook 移动)
  assert.match(hook, /console\.warn\("\[map-shell\] work viewport load failed:/);
  assert.match(hook, /console\.warn\("\[map-shell\] domain viewport load failed:/);
  // VIEWPORT_SUPPRESS_MS 抑制机制保留(tech/16 方案 A,收藏 fitToPins 兜底):
  // 事件侧窗口检查随 hook 移动,toggle 侧写入抑制标记仍在 map-shell
  assert.match(hook, /suppressViewportRefreshUntilRef\.current > Date\.now\(\)/);
  assert.match(shell, /suppressViewportRefreshUntilRef\.current = Date\.now\(\) \+ VIEWPORT_SUPPRESS_MS/);
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

test('map shell Bug3 locate: 挂载定位不抢占已交互相机(首次点 pin 不再被拽回)', () => {
  const shell = src('components/map-shell.tsx');
  // 交互标记 ref 已声明
  assert.match(shell, /hasInteractedRef = useRef\(false\)/);
  // 挂载 geolocation 回调:定位数据照常(userLocation/searchOrigin),相机移动被
  // hasInteractedRef 门控——未交互才 setCenter+setZoom+setMapCenter
  assert.match(shell, /getCurrentPosition\(map\)/);
  assert.match(shell, /setUserLocation\(\{ lng, lat \}\)/);
  assert.match(shell, /setSearchOrigin\(\(prev\) => prev \?\? \{ lng, lat \}\)/);
  assert.match(
    shell,
    /if \(!hasInteractedRef\.current\) \{[\s\S]{0,120}map\.setCenter\(\[\s*lng,\s*lat\s*\]\)[\s\S]{0,120}map\.setZoom\(15\)[\s\S]{0,120}setMapCenter\(\{ lng, lat \}\)/
  );
  // 已交互 → 锁定 mapCenter 不更新(距离圆心/相机都不甩去用户位置)
  assert.match(shell, /if \(!hasInteractedRef\.current\) \{[\s\S]{0,120}setMapCenter\(\{ lng, lat \}\)/);
  // 主动手势(drag/zoom/click)与 marker 点击都置交互标记
  assert.match(shell, /map\.on\("dragstart", \(\) => \{\s*hasInteractedRef\.current = true/);
  assert.match(shell, /map\.on\("zoomstart", \(\) => \{\s*hasInteractedRef\.current = true/);
  assert.match(shell, /map\.on\("click", \(\) => \{\s*hasInteractedRef\.current = true/);
  assert.match(shell, /onMarkerClick: \(id\) => \{[\s\S]{0,120}hasInteractedRef\.current = true/);
  // 定位按钮 handleLocate 原义保留:仍无条件 setCenter+setZoom(不受 hasInteractedRef 门控)
  const locateBlock = shell.slice(shell.indexOf("const handleLocate"), shell.indexOf("const handleMapStyleChange"));
  assert.match(locateBlock, /mapInstance\.current\.setCenter\(\[lng, lat\]\)/);
  assert.match(locateBlock, /mapInstance\.current\.setZoom\(15\)/);
  assert.doesNotMatch(locateBlock, /hasInteractedRef/);
});

test('logout resets saved overlay state and pref alongside saved places', () => {
  const shell = src('components/map-shell.tsx');
  const logoutBlock = shell.slice(shell.indexOf("const handleAuthAction"), shell.indexOf("const handleSaveProfile"));
  // 登出分支清空 savedPlaces 的同时重置 savedOverlay 状态 + 持久化 pref,避免收藏图层静默消失
  assert.match(logoutBlock, /setUser\(null\)/);
  assert.match(logoutBlock, /setSavedPlaces\(\[\]\)/);
  assert.match(logoutBlock, /setSavedOverlay\(false\)/);
  assert.match(logoutBlock, /writeSavedOverlayPref\(false\)/);
});
