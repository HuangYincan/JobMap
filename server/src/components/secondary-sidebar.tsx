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
// ============================================================

import { useEffect, useRef, useState } from "react";
import { ModeSwitcher } from "./mode-switcher";
import { POIList } from "./poi-list";
import { POIDetailView } from "./poi-detail";
import { JdPanel } from "./jd-panel";
import { FilterPanel } from "./filter-panel";
import { SortSelector } from "./sort-selector";
import { t, type Language } from "@/lib/i18n";
import { getMode } from "@/lib/modes";
import { isRecruitmentPOI, type FilterState, type MapMode, type POI, type Position } from "@/lib/types";
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
  /** 关闭详情（返回列表） */
  onCloseDetail?: () => void;
  /** 按当前视图重新搜索（清空累计池） */
  onRefreshHere?: () => void;
  /** 在累计池上再扩一页常见 POI */
  onNeedMore?: () => void;
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
  onCloseDetail,
  onRefreshHere,
  onNeedMore,
}: SecondarySidebarProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [localDetail, setLocalDetail] = useState<POI | null>(null);
  const [jdPosition, setJdPosition] = useState<Position | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const config = getMode(mode);
  const detailPoi = detailPoiProp ?? localDetail;

  useEffect(() => {
    setLocalDetail(null);
    setJdPosition(null);
  }, [mode]);

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
          <ModeSwitcher activeMode={mode} onModeChange={onModeChange} />
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
              placeholder={config.searchPlaceholder}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCommitSearch?.(query);
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
              aria-expanded={showSuggestions}
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
          {showSuggestions && suggestions && suggestions.length > 0 && (
            <ul className={styles.suggestionList} role="listbox" aria-label="Search suggestions">
              {suggestions.map((s, i) => (
                <li key={`${s.id || s.name}-${i}`} role="option">
                  <button
                    className={styles.suggestionItem}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onSelectSuggestion?.(s);
                      setShowSuggestions(false);
                    }}
                  >
                    <span className={styles.suggestionIcon} aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Z" />
                        <circle cx="12" cy="10" r="2.5" />
                      </svg>
                    </span>
                    <span className={styles.suggestionText}>
                      <span className={styles.suggestionName}>{s.name}</span>
                      {s.subtitle && <span className={styles.suggestionSub}>{s.subtitle}</span>}
                    </span>
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

      {/* 筛选面板（可折叠） */}
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
          {onRefreshHere && (
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
        {onNeedMore && (
          <button
            type="button"
            className={styles.moreIcon}
            onClick={onNeedMore}
            disabled={loading}
            aria-label={t("needMore", lang)}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v8M8 12h8" />
            </svg>
          </button>
        )}
      </div>

      {/* POI 列表 */}
      <POIList
        pois={pois}
        selectedId={selectedId}
        highlightedId={highlightedId}
        onSelect={openDetail}
        onHover={onHover}
        loading={loading}
        lang={lang}
        accentColor={config.color}
      />
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
      />
    )}
    </div>
  );
}
