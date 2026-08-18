"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import { POICard } from "./poi-card";
import { t, type Language } from "@/lib/i18n";
import type { POI } from "@/lib/types";
import styles from "./poi-list.module.css";

export interface POIListProps {
  pois: POI[];
  /** 当前选中卡片 id（地图同步） */
  selectedId?: string | null;
  /** 当前高亮卡片 id（卡片-地图联动） */
  highlightedId?: string | null;
  onSelect?: (poi: POI) => void;
  onHover?: (id: string | null) => void;
  /** 仅移动端：点卡片边缘空隙/列表空白处取消选中（桌面不传，行为不变） */
  onDeselect?: () => void;
  loading?: boolean;
  empty?: boolean;
  /** 空态标题覆写(分类门控:domain 无分类时提示「选择类别开始浏览」) */
  emptyTitle?: string;
  lang?: Language;
  accentColor?: string;
  onWidenSearch?: () => void;
  /** 无限滚动：滚动到底时触发加载下一批 */
  onNeedMore?: () => void;
  /** 正在追加加载（显示底部 spinner） */
  loadingMore?: boolean;
  /** 加载错误:失败 ≠ 没有更多,footer 显示「加载失败,点击重试」(poi-loading A) */
  error?: string | null;
  /** 重试当前批次(不递增偏移) */
  onRetry?: () => void;
  /** 已达上限（显示「已达加载上限」并停止哨兵触发） */
  atCap?: boolean;
  /** 数据已耗尽（稀疏视野/回退窗口空;显示「没有更多结果」并停止哨兵） */
  noMore?: boolean;
}

type CSSVarStyle = CSSProperties & Record<`--${string}`, string | number>;

const SKELETON_COUNT = 3;

export function POIList({
  pois,
  selectedId,
  highlightedId,
  onSelect,
  onHover,
  onDeselect,
  loading = false,
  empty = false,
  emptyTitle,
  lang = "zh",
  accentColor,
  onWidenSearch,
  onNeedMore,
  loadingMore = false,
  error = null,
  onRetry,
  atCap = false,
  noMore = false,
}: POIListProps) {
  const showEmpty = !loading && (empty || pois.length === 0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onNeedMoreRef = useRef(onNeedMore);
  onNeedMoreRef.current = onNeedMore;
  const atCapRef = useRef(atCap);
  atCapRef.current = atCap;
  const noMoreRef = useRef(noMore);
  noMoreRef.current = noMore;
  const errorRef = useRef(error);
  errorRef.current = error;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const loadingMoreRef = useRef(loadingMore);
  loadingMoreRef.current = loadingMore;

  // 无限滚动：底部哨兵进入视口(提前 400px)触发 onNeedMore。
  // root:null(viewport)对桌面 sidebar 与移动 drawer 都基于浏览器视口,
  // rootMargin 提前量兼容嵌套滚动容器的高度差。
  // 依赖 pois.length：catalog 更新后 React 重建哨兵节点,需重新 observe
  // (否则 IO 盯着已脱离 DOM 的旧元素,无限滚动停在第一批之后)。
  // 依赖 loadingMore:追加加载即使 0 条可见(筛选过滤),loadingMore 翻转也会
  // 触发重新 observe → observe 的首次回调按当前交集状态补发,滚动链不断。
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !onNeedMoreRef.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (atCapRef.current) return; // 到顶停止触发
          if (noMoreRef.current) return; // 数据耗尽停止触发
          if (errorRef.current) return; // 失败态:不自动重发,等显式重试
          if (loadingRef.current || loadingMoreRef.current) return; // 加载中不重复触发
          onNeedMoreRef.current?.();
        }
      },
      { root: null, rootMargin: "0px 0px 400px 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [pois.length, loadingMore]);

  return (
    <div
      id="explore-results"
      className={styles.list}
      role="list"
      tabIndex={-1}
      aria-label={lang === "zh" ? "POI 搜索结果" : "POI search results"}
      aria-busy={loading}
      onClick={onDeselect ? () => onDeselect() : undefined}
    >
      {loading ? (
        <>
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <div
              key={`skeleton-${i}`}
              className={styles.skeleton}
              style={{ "--index": i } as CSSVarStyle}
              aria-hidden="true"
            >
              <div
                className={styles.skeletonLine}
                style={{ width: "52%", height: 14 }}
              />
              <div
                className={styles.skeletonLine}
                style={{ width: "72%", height: 11 }}
              />
              <div className={styles.skeletonPhotos} />
            </div>
          ))}
        </>
      ) : showEmpty ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          <p className={styles.emptyTitle}>{emptyTitle ?? t("noResults", lang)}</p>
          <p className={styles.emptyHint}>{t("noResultsHint", lang)}</p>
          {onWidenSearch && (
            <button type="button" className={styles.widen} onClick={onWidenSearch}>
              {t("widenSearch", lang)}
            </button>
          )}
        </div>
      ) : (
        <>
          {pois.map((poi, i) => (
            <div
              key={poi.id}
              role="listitem"
              className={styles.cardSlot}
              style={{ "--index": i % 8 } as CSSVarStyle}
              onMouseEnter={() => onHover?.(poi.id)}
              onMouseLeave={() => onHover?.(null)}
              onClick={
                onDeselect
                  ? (e) => {
                      onDeselect();
                      e.stopPropagation();
                    }
                  : undefined
              }
            >
              <POICard
                poi={poi}
                selected={poi.id === selectedId}
                highlighted={poi.id === highlightedId}
                onClick={onSelect}
                lang={lang}
                accentColor={accentColor}
              />
            </div>
          ))}
          {/* 底部哨兵 + 加载/错误重试/到底/耗尽指示 */}
          <div ref={sentinelRef} className={styles.sentinel}>
            {error ? (
              <button
                type="button"
                className={styles.retryBtn}
                onClick={onRetry}
                aria-label={t("loadFailedRetry", lang)}
              >
                {t("loadFailedRetry", lang)}
              </button>
            ) : atCap ? (
              <span aria-hidden="true" className={styles.sentinelText}>
                {lang === "zh" ? "── 已达加载上限 ──" : "── Reached load limit ──"}
              </span>
            ) : noMore ? (
              <span aria-hidden="true" className={styles.sentinelText}>
                {lang === "zh" ? "── 没有更多结果 ──" : "── No more results ──"}
              </span>
            ) : loadingMore ? (
              <span className={styles.spinner} aria-label={t("loading", lang)} />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
