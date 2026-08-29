"use client";

// ============================================================
// SecondarySidebar — 二级侧控栏容器（Apple Maps 风格）
//
// 设计遵循 tech/09-secondary-sidebar.md：
// - 从左侧主导航栏展开（非右侧独立面板）
// - 顶部：模式切换 + 搜索框
// - 中部：筛选器 + 排序（可折叠）
// - 下部：POI 卡片列表（虚拟滚动由外层 POIList 处理）
//
// 组件纯展示 + 状态提升：
// - 搜索/筛选/排序状态由父级持有，经 props 传入
// - 所有数据获取在父级（map-shell）
//
// 收藏图层互斥(2026-08-22 用户决策):savedMode 开时列表区切换为收藏
// 卡片列表(2026-08-22 卡片化:POIList + POICard,与普通模式同组件/同样式;
// 不渲染对比表/无限滚动;卡片右上「移除收藏」= onRemoveSaved),搜索管线列表
// 隐藏;关时恢复。对比表保留在账户页 SavedList(本组件不再消费)。
// ============================================================

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ModeSwitcher } from "./mode-switcher";
import { POIList } from "./poi-list";
import { POIDetailView } from "./poi-detail";
import { JdPanel } from "./jd-panel";
import { FilterPanel } from "./filter-panel";
import { SortSelector } from "./sort-selector";
import { t, type Language } from "@/lib/i18n";
import { canonicalMode, getMode } from "@/lib/modes";
import { selectedRoleFamilies, selectedTaxonomyPaths } from "@/lib/job-taxonomy";
import { suggestKeyAction } from "@/lib/suggest-nav";
import { savedPlacesToListPois } from "@/lib/saved-overlay";
import type { SavedPlace } from "@/lib/account";
import { isRecruitmentPOI, formatDistance, type FilterState, type MapMode, type POI, type Position, type RecruitmentPOI } from "@/lib/types";
import styles from "./secondary-sidebar.module.css";

/** 搜索建议（AutoComplete 结果的 UI 形态） */
export interface SearchSuggestion {
  id?: string;
  name: string;
  subtitle?: string;
  location?: { lng: number; lat: number };
  /** 招聘建议：点选后打开对应公司 */
  poiId?: string;
  positionId?: string;
  kind?: "place" | "company" | "job";
  /** 行首图标（emoji；服务端下发，缺省按 kind 回退） */
  icon?: string;
  /** 到参考点的距离（米）；无位置信息时缺省 */
  distance?: number;
}

/** 行首图标：优先用服务端下发的 icon（公司为 logo emoji），否则按 kind 回退。 */
export function suggestionDisplayIcon(s: { kind?: SearchSuggestion["kind"]; icon?: string }): string {
  if (s.icon) return s.icon;
  if (s.kind === "job") return "💼";
  if (s.kind === "company") return "🏢";
  return "📍";
}

/**
 * F2 候选类别：work 模式未选类别（无 query / jobTaxonomy / roleFamily）时，
 * 从 getMode(mode).filters 取 job-family（intern/campus/social）+ 职能
 * （tech/product/ops/design）chips，供 POIList 空态槽位渲染；点击直接写 filters。
 * 判定基于 filters 而非 catalog 是否为空（与 ws-v 的 listCatalog 解耦）。
 */
export function workCandidateCategories(
  mode: MapMode,
  query: string,
  filters: FilterState,
): { key: string; value: string; label: string }[] {
  if (canonicalMode(mode) !== "work") return [];
  if (query.trim()) return [];
  if (selectedTaxonomyPaths(filters).length > 0) return [];
  if (selectedRoleFamilies(filters).length > 0) return [];
  const chips: { key: string; value: string; label: string }[] = [];
  for (const config of getMode(mode).filters) {
    if (config.key !== "jobTaxonomy" && config.key !== "roleFamily") continue;
    for (const option of config.options ?? []) {
      chips.push({ key: config.key, value: option.value, label: option.label });
    }
  }
  return chips;
}

/**
 * F2 候选类别(domain 分支):domain 地图模式未选类别(无 query / filters.category)时,
 * 从 getMode(mode).filters 的 category(select 单选)取 CATEGORY_OPTIONS 9 类 chips,
 * 供 POIList 空态槽位渲染;点击写 filters.category(字符串,单选语义与 FilterPanel 一致)。
 */
export function domainCandidateCategories(
  mode: MapMode,
  query: string,
  filters: FilterState,
): { key: string; value: string; label: string }[] {
  if (canonicalMode(mode) !== "domain") return [];
  if (query.trim()) return [];
  if (filters.category) return [];
  const chips: { key: string; value: string; label: string }[] = [];
  for (const config of getMode(mode).filters) {
    if (config.key !== "category" || config.type !== "select") continue;
    for (const option of config.options ?? []) {
      chips.push({ key: config.key, value: option.value, label: option.label });
    }
  }
  return chips;
}

/** F2 候选类别(work + domain 合并;两模式互斥,至多一方非空)。 */
export function candidateCategoriesFor(
  mode: MapMode,
  query: string,
  filters: FilterState,
): { key: string; value: string; label: string }[] {
  return [
    ...workCandidateCategories(mode, query, filters),
    ...domainCandidateCategories(mode, query, filters),
  ];
}

/**
 * F2 候选类别 chip 点击:写 filters[key]。
 * 单选(select,如 domain category)写字符串;多选(multi-select,如 work jobTaxonomy/roleFamily)写数组。
 */
export function pickCategoryFilter(
  filters: FilterState,
  mode: MapMode,
  key: string,
  value: string,
): FilterState {
  const config = getMode(mode).filters.find((f) => f.key === key);
  const isSingle = config?.type === "select";
  return { ...filters, [key]: isSingle ? value : [value] };
}

export interface SecondarySidebarProps {
  /** 当前模式 */
  mode: MapMode;
  /** 模式切换回调 */
  onModeChange: (mode: MapMode) => void;
  /** 搜索关键词 */
  query: string;
  /** 搜索框输入回调 */
  onQueryChange: (q: string) => void;
  /** 筛选状态 */
  filters: FilterState;
  /** 筛选变化回调 */
  onFiltersChange: (filters: FilterState) => void;
  /** 重置筛选 */
  onFiltersReset: () => void;
  /** 当前排序 */
  sort: string;
  /** 排序变化回调 */
  onSortChange: (sort: string) => void;
  /** 结果列表 */
  pois: POI[];
  /** 加载状态 */
  loading?: boolean;
  /** 选中 POI（地图联动） */
  selectedId?: string | null;
  /** 高亮 POI（hover 联动） */
  highlightedId?: string | null;
  /** 卡片点击 */
  onSelect?: (poi: POI) => void;
  /** 卡片 hover */
  onHover?: (id: string | null) => void;
  /** 总结果数（用于显示） */
  totalCount?: number;
  /** 语言 */
  lang?: Language;
  /** 面板关闭回调（点击关闭按钮 / 外部） */
  onClose?: () => void;
  /** 搜索建议列表（AutoComplete 结果） */
  suggestions?: SearchSuggestion[];
  /** 选择建议回调（选中后定位到该地点） */
  onSelectSuggestion?: (s: SearchSuggestion) => void;
  /** 用户提交搜索（回车），用于写入账户搜索历史 */
  onCommitSearch?: (query: string) => void;
  /** 搜索框获取焦点回调（触发拉取建议） */
  onSearchFocus?: () => void;
  /** 左侧主导航是否已展开（展开时面板右移避开） */
  shifted?: boolean;
  /** 打开详情时由父级飞到该点 / 同步选中 */
  onOpenDetail?: (poi: POI) => void;
  /** 外部指定要打开的详情（地图 marker 点击） */
  detailPoi?: POI | null;
  /** 打开公司详情时顺便打开该岗位（搜索建议点岗位） */
  openPositionId?: string | null;
  /** 关闭详情（返回列表） */
  onCloseDetail?: () => void;
  /** 按当前视图重新搜索（清空累计池） */
  onRefreshHere?: () => void;
  /** 在累计池上再扩一页常见 POI */
  onNeedMore?: () => void;
  /** 桌面「加载更多」按钮(与滚动哨兵同一路径;移动抽屉不传) */
  onLoadMore?: () => void;
  /** 加载错误(失败 ≠ 没有更多;显示「重试」) */
  loadError?: string | null;
  /** 重试当前批次(不递增偏移,避免跳过失败批次) */
  onRetry?: () => void;
  /** 正在无限滚动追加加载(显示底部 spinner) */
  loadingMore?: boolean;
  /** 已达上限(显示「已达加载上限」并停止哨兵触发) */
  atCap?: boolean;
  /** 数据已耗尽(稀疏视野/回退窗口空;显示「没有更多结果」并停止哨兵) */
  noMore?: boolean;
  /** 空结果时扩大搜索范围 */
  onWidenSearch?: () => void;
  saved?: boolean;
  onToggleSave?: (poi: POI) => void;
  onApply?: (input: { position: Position; company: RecruitmentPOI; url?: string }) => void;
  /** 收藏图层互斥开:列表区切换为收藏卡片列表(2026-08-22 卡片化,关时恢复搜索管线) */
  savedMode?: boolean;
  /** 收藏列表数据(互斥开时经 savedPlacesToListPois 桥接为卡片 POIList) */
  savedItems?: SavedPlace[];
  /** 收藏行点击(沿用现有 saved pin 点击行为:打开详情) */
  onPickSaved?: (place: SavedPlace) => void;
  /** 收藏行移除(未登录不传) */
  onRemoveSaved?: (poiId: string) => void;
  /** 收藏列表活数据目录(与 SavedPanel 同口径) */
  savedCatalog?: POI[];
  /** 收藏列表距离参考点(与 SavedPanel 同口径) */
  savedOrigin?: { lng: number; lat: number } | null;
  workCommute?: ReactNode;
  workListReplace?: ReactNode;
  commuteMinutesById?: Record<string, number>;
  compareSelected?: string[];
  onToggleCompare?: (poi: POI) => void;
  /** 岗位卡片/详情展示距离圆心（用户定位，缺则视野中心）。 */
  displayOrigin?: { lng: number; lat: number } | null;
}

export function SecondarySidebar({
  mode,
  onModeChange,
  query,
  onQueryChange,
  filters,
  onFiltersChange,
  onFiltersReset,
  sort,
  onSortChange,
  pois,
  loading = false,
  selectedId,
  highlightedId,
  onSelect,
  onHover,
  totalCount,
  lang = "zh",
  onClose,
  suggestions,
  onSelectSuggestion,
  onCommitSearch,
  onSearchFocus,
  shifted = false,
  onOpenDetail,
  detailPoi: detailPoiProp = null,
  openPositionId = null,
  onCloseDetail,
  onRefreshHere,
  onNeedMore,
  onLoadMore,
  loadError,
  onRetry,
  loadingMore = false,
  atCap = false,
  noMore = false,
  onWidenSearch,
  saved = false,
  onToggleSave,
  onApply,
  savedMode = false,
  savedItems = [],
  onPickSaved,
  onRemoveSaved,
  savedCatalog = [],
  savedOrigin = null,
  workCommute,
  workListReplace,
  commuteMinutesById,
  compareSelected,
  onToggleCompare,
  displayOrigin,
}: SecondarySidebarProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [localDetail, setLocalDetail] = useState<POI | null>(null);
  const [jdPosition, setJdPosition] = useState<Position | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const config = getMode(mode);
  // 分类门控(poi-category-loading):domain 浏览态且未选分类 → 空态提示选类
  const domainNoCategory =
    config.kind === "domain" && !filters.category && !query.trim();
  // F2 候选类别(work/domain 未选类别):空态槽位渲染 chips,点击写 filters
  const candidateChips = candidateCategoriesFor(mode, query, filters);
  // 收藏模式列表数据桥接(2026-08-22 卡片化):活数据优先,快照兜底
  // (saved-overlay.savedPlacesToListPois),带 origin 补全快照 distance
  const savedListPois = useMemo(
    () => savedPlacesToListPois(savedItems, savedCatalog, savedOrigin),
    [savedItems, savedCatalog, savedOrigin],
  );
  const detailPoi = detailPoiProp ?? localDetail;
  const suggestionItems = suggestions ?? [];

  useEffect(() => {
    setActiveSuggestion(-1);
  }, [query, suggestionItems.length]);

  useEffect(() => {
    setLocalDetail(null);
    setJdPosition(null);
  }, [mode]);

  useEffect(() => {
    if (!openPositionId || !detailPoi || !isRecruitmentPOI(detailPoi)) return;
    const pos = detailPoi.positions.find((item) => item.id === openPositionId);
    if (pos) setJdPosition(pos);
  }, [openPositionId, detailPoi]);

  const selectedPoi = detailPoi
    ? pois.find((p) => p.id === detailPoi.id) ?? detailPoi
    : null;

  const openDetail = (poi: POI) => {
    setLocalDetail(poi);
    setJdPosition(null);
    onSelect?.(poi);
    onOpenDetail?.(poi);
  };

  const closeDetail = () => {
    setLocalDetail(null);
    setJdPosition(null);
    onCloseDetail?.();
  };

  const jdCompany = selectedPoi && isRecruitmentPOI(selectedPoi) ? selectedPoi : null;

  return (
    <div className={`${styles.cluster} ${shifted ? styles.shifted : ""}`}>
    <aside
      className={`${styles.sidebar} ${selectedPoi ? styles.detailMode : ""}`}
      aria-label="POI 详情侧栏"
    >
      {/* 顶部：标题栏 + 模式切换 */}
      <div className={styles.headerBar}>
        <div className={styles.modeBar}>
          <ModeSwitcher activeMode={mode} onModeChange={onModeChange} lang={lang} />
        </div>
        {onClose && (
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label={lang === "zh" ? "关闭面板" : "Close panel"}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>

      {selectedPoi ? (
        <POIDetailView
          poi={selectedPoi}
          onBack={closeDetail}
          lang={lang}
          accentColor={config.color}
          selectedPositionId={jdPosition?.id ?? null}
          onSelectPosition={(pos) => setJdPosition(pos)}
          saved={saved}
          onToggleSave={onToggleSave ? () => onToggleSave(selectedPoi) : undefined}
          displayOrigin={displayOrigin}
        />
      ) : (
      <>
      {/* 搜索框 */}
      <div className={styles.searchRow}>
        <div className={styles.searchWrap}>
          <div className={styles.searchBox}>
            <svg
              className={styles.searchIcon}
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              className={styles.searchInput}
              placeholder={lang === "en" ? (config.searchPlaceholderEn ?? config.searchPlaceholder) : config.searchPlaceholder}
              value={query}
              role="combobox"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={
                showSuggestions && activeSuggestion >= 0 ? `${listId}-${activeSuggestion}` : undefined
              }
              onChange={(e) => {
                onQueryChange(e.target.value);
                setShowSuggestions(true);
              }}
              onKeyDown={(e) => {
                const action = suggestKeyAction(
                  e.key,
                  activeSuggestion,
                  showSuggestions ? suggestionItems.length : 0,
                );
                if (action.type === "move") {
                  e.preventDefault();
                  setShowSuggestions(true);
                  setActiveSuggestion(action.index);
                  return;
                }
                if (action.type === "pick") {
                  e.preventDefault();
                  onSelectSuggestion?.(suggestionItems[action.index]);
                  setShowSuggestions(false);
                  setActiveSuggestion(-1);
                  return;
                }
                if (action.type === "close") {
                  setShowSuggestions(false);
                  setActiveSuggestion(-1);
                  return;
                }
                if (action.type === "commit") onCommitSearch?.(query);
              }}
              onFocus={() => {
                setShowSuggestions(true);
                onSearchFocus?.();
              }}
              onBlur={() => {
                // 延迟关闭，允许点击建议项
                setTimeout(() => setShowSuggestions(false), 150);
              }}
              aria-label={t("search", lang)}
              aria-expanded={showSuggestions && suggestionItems.length > 0}
            />
            {query && (
              <button
                className={styles.clearButton}
                onClick={() => {
                  onQueryChange("");
                  searchRef.current?.focus();
                }}
                aria-label={lang === "zh" ? "清空搜索" : "Clear search"}
              >
                ×
              </button>
            )}
          </div>

          {/* 搜索建议下拉（AutoComplete） */}
          {showSuggestions && suggestionItems.length > 0 && (
            <ul id={listId} className={styles.suggestionList} role="listbox" aria-label="Search suggestions">
              {suggestionItems.map((s, i) => (
                <li key={`${s.id || s.name}-${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === activeSuggestion}>
                  <button
                    className={`${styles.suggestionItem} ${i === activeSuggestion ? styles.suggestionActive : ""}`}
                    onMouseEnter={() => setActiveSuggestion(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onSelectSuggestion?.(s);
                      setShowSuggestions(false);
                      setActiveSuggestion(-1);
                    }}
                  >
                    <span className={styles.suggestionIcon} aria-hidden="true">
                      {suggestionDisplayIcon(s)}
                    </span>
                    <span className={styles.suggestionText}>
                      <span className={styles.suggestionName}>{s.name}</span>
                      {s.subtitle && <span className={styles.suggestionSub}>{s.subtitle}</span>}
                    </span>
                    {s.distance != null && (
                      <span className={styles.suggestionDistance}>{formatDistance(s.distance)}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 筛选 + 排序按钮 */}
        <div className={styles.actions}>
          <button
            className={`${styles.actionButton} ${styles.filterButton} ${showFilters ? styles.actionActive : ""}`}
            onClick={() => setShowFilters((v) => !v)}
            aria-label={t("filter", lang)}
            aria-expanded={showFilters}
            aria-pressed={showFilters}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M3 5h18M7 12h10M10 19h4" />
            </svg>
            {Object.keys(filters).length > 0 && <span className={styles.filterBadge} />}
          </button>
          <SortSelector
            options={config.sortOptions}
            value={sort}
            onChange={onSortChange}
            lang={lang}
          />
        </div>
      </div>

      {workCommute}

      {/* 筛选面板（可折叠）+ 结果标题 + POI 列表：共享滚动容器，顶部内容随滚走 */}
      <div className={styles.scrollRegion}>
        {savedMode ? (
          /* 收藏图层互斥开:列表区切换为收藏卡片列表(2026-08-22 卡片化,与普通
             模式同组件/同样式;不渲染对比表/无限滚动;卡片右上「移除收藏」=
             onRemoveSaved;卡片点击沿用 onPickSaved 打开详情),关时恢复搜索管线 */
          <POIList
            pois={savedListPois}
            selectedId={selectedId}
            highlightedId={highlightedId}
            onSelect={(poi) => {
              const place = savedItems.find((item) => item.poiId === poi.id);
              if (place) onPickSaved?.(place);
            }}
            onHover={onHover}
            loading={false}
            emptyTitle={savedItems.length === 0 || savedListPois.length === 0 ? t("savedEmpty", lang) : undefined}
            lang={lang}
            accentColor={config.color}
            onRemove={onRemoveSaved ? (poi) => onRemoveSaved(poi.id) : undefined}
            displayOrigin={displayOrigin}
          />
        ) : (
        <>
        {showFilters && (
          <div className={styles.filterPanel}>
            <FilterPanel
              filters={config.filters}
              values={filters}
              onChange={(key, value) => onFiltersChange({ ...filters, [key]: value })}
              onReset={onFiltersReset}
              resultCount={totalCount}
              lang={lang}
            />
          </div>
        )}

        {/* 结果标题 */}
        <div className={styles.resultHeader}>
          <div className={styles.resultMeta}>
            <span className={styles.resultCount}>
              {loading ? t("loading", lang) : `${totalCount ?? pois.length} ${t("resultsCount", lang)}`}
            </span>
            {onRefreshHere && pois.length === 0 && !loading && (
              <button
                type="button"
                className={styles.refreshIcon}
                onClick={onRefreshHere}
                disabled={loading}
                aria-label={t("refreshHere", lang)}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-2.6-6.3" />
                  <path d="M21 4v6h-6" />
                </svg>
              </button>
            )}
          </div>
          {/* 桌面「加载更多」:noMore/atCap 隐藏;loadingMore 显示「加载中…」;
              错误态显示「重试」(复用 loadError 态,poi-loading A) */}
          {pois.length > 0 && onLoadMore && !atCap && !noMore && !loading && (
            <button
              type="button"
              className={styles.loadMore}
              onClick={() => (loadError ? onRetry?.() : onLoadMore())}
              disabled={loadingMore}
              aria-label={loadError ? t("retry", lang) : t("loadMore", lang)}
            >
              {loadError
                ? t("retry", lang)
                : loadingMore
                  ? t("loadingMore", lang)
                  : t("loadMore", lang)}
            </button>
          )}
        </div>

        {/* POI 列表 */}
        {workListReplace ?? (
        <POIList
          pois={pois}
          selectedId={selectedId}
          highlightedId={highlightedId}
          onSelect={openDetail}
          onHover={onHover}
          loading={loading}
          emptyTitle={
            domainNoCategory || candidateChips.length > 0 ? t("pickCategory", lang) : undefined
          }
          candidateCategories={candidateChips.length > 0 ? candidateChips : undefined}
          onPickCategory={(key, value) => onFiltersChange(pickCategoryFilter(filters, mode, key, value))}
          lang={lang}
          accentColor={config.color}
          onWidenSearch={onWidenSearch}
          onNeedMore={onNeedMore}
          loadingMore={loadingMore}
          error={loadError}
          onRetry={onRetry}
          atCap={atCap}
          noMore={noMore}
          commuteMinutesById={commuteMinutesById}
          compareSelected={compareSelected}
          onToggleCompare={onToggleCompare}
          displayOrigin={displayOrigin}
        />
        )}
        </>
        )}
      </div>
      </>
      )}
    </aside>
    {jdCompany && jdPosition && (
      <JdPanel
        company={jdCompany}
        position={jdPosition}
        onClose={() => setJdPosition(null)}
        lang={lang}
        accentColor={config.color}
        onApply={onApply}
      />
    )}
    </div>
  );
}
