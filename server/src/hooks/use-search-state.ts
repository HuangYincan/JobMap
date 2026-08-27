"use client";

// ============================================================
// useSearchState — 搜索建议数据流 Hook
//
// 持有 suggestions 状态与建议获取 effect：
// - work：/api/suggest 服务端目录（公司 + 岗位 + 标签），0 命中/报错回退本地池；
// - domain：本地优先（/api/suggest → hz_pois 前缀匹配），0 命中/报错回退高德
//   AutoComplete 一次，回退失败返回空列表不卡死。
// 依赖只留 [query, mode]：之前 [query, mode, zoom, catalog] 里 catalog 每批替换、
// zoom 每次平移都取消 200ms 定时器——hz-poi Stage 4 后 catalog 高频变化，
// 候选列表永远不落地。zoom/catalog 改经 ref 读取。
// ============================================================

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { MapMode, POI } from "@/lib/types";
import { haversineDistance, isRecruitmentMode } from "@/lib/types";
import type { MapEngine } from "@/lib/map-engine/types";
import { suggestRecruitment, suggestSearchTags } from "@/lib/search";
import {
  fetchSearchSuggest,
  type SearchSuggestion as ApiSearchSuggestion,
} from "@/lib/api";
import type { SearchSuggestion } from "@/components/secondary-sidebar";

/** /api/suggest 服务端建议 → 客户端 UI 形态。
 *  距离优先用客户端实时 origin 重算（地图平移/定位后仍新鲜），服务端 center
 *  算好的 distance 兜底；无 location 不显示距离。domain 行 kind 一律 place。 */
function mapApiSuggestion(
  tip: ApiSearchSuggestion,
  mode: MapMode,
  origin: { lng: number; lat: number } | null
): SearchSuggestion {
  const kind: SearchSuggestion["kind"] =
    tip.type === "position" ? "job" : tip.type === "tag" ? "place" : isRecruitmentMode(mode) ? "company" : "place";
  return {
    id: tip.id,
    name: tip.title,
    subtitle: tip.subtitle,
    location: tip.location,
    poiId: tip.poiId ?? (tip.type === "position" || tip.type === "tag" ? undefined : tip.id),
    positionId: tip.type === "position" ? tip.id : undefined,
    kind,
    icon: tip.icon,
    distance: tip.location && origin ? haversineDistance(tip.location, origin) : tip.distance,
  };
}

export interface SearchStateOptions {
  query: string;
  mode: MapMode;
  distanceOriginRef: MutableRefObject<{ lng: number; lat: number }>;
  zoomRef: MutableRefObject<number>;
  catalogRef: MutableRefObject<POI[]>;
  /** 活跃引擎(use-map-engine 注入;domain 建议兜底经 engine.search.fetchSuggestions) */
  engine: MapEngine | null;
  /** 视图已创建且引擎 search provider 可用;用于输入早于地图就绪时重试当前 query。 */
  engineReady?: boolean;
}

export function useSearchState(options: SearchStateOptions) {
  const { query, mode, distanceOriginRef, zoomRef, catalogRef, engine, engineReady = Boolean(engine) } = options;
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  // 引擎经 ref 读取:依赖保持原始 query/mode + 稳定 readiness key(引擎切换/地图
  // 就绪时重跑;每次 render 不因对象引用变化而重置 200ms 防抖)。
  const engineRef = useRef(engine);
  engineRef.current = engine;
  // 仅 Domain 兜底依赖引擎 readiness；work 的服务端建议不因地图 view 就绪重复请求。
  const searchReadyKey = mode === "domain" && engineReady ? engine?.id ?? null : null;

  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      const origin = distanceOriginRef.current;

      if (isRecruitmentMode(mode)) {
        const fallback = () => {
          // DB-only：兜底只用已加载 catalog；目录空时仅返回标签（无示例数据池）。
          const pool = catalogRef.current;
          const tags = suggestSearchTags(query, 3).map((tag) => ({
            id: tag.id,
            name: tag.title,
            subtitle: tag.key,
            kind: "place" as const,
          }));
          const tips = suggestRecruitment(pool, query, 8).map((tip) => ({
            id: tip.id,
            name: tip.name,
            subtitle: tip.subtitle,
            location: tip.location,
            poiId: tip.poiId,
            positionId: tip.positionId,
            kind: tip.kind,
          }));
          return [...tags, ...tips].slice(0, 8);
        };
        try {
          const res = await fetchSearchSuggest(query.trim(), mode, origin);
          if (cancelled) return;
          if (!res.suggestions.length) {
            setSuggestions(fallback());
            return;
          }
          setSuggestions(res.suggestions.map((tip) => mapApiSuggestion(tip, mode, origin)));
        } catch {
          if (!cancelled) setSuggestions(fallback());
        }
        return;
      }

      // domain：本地优先
      try {
        const res = await fetchSearchSuggest(query.trim(), mode, origin);
        if (cancelled) return;
        if (res.suggestions.length) {
          setSuggestions(res.suggestions.map((tip) => mapApiSuggestion(tip, mode, origin)));
          return;
        }
      } catch {
        if (cancelled) return;
      }
      // 本地 0 命中 / 请求失败 → 回退活跃引擎 AutoComplete 一次(经 use-map-engine
      // 注入;引擎未就绪时本轮让路,searchReadyKey 在 view ready 后重跑当前 query)。
      try {
        if (!engineReady || !engineRef.current) return;
        const tips = await engineRef.current.search.fetchSuggestions(query.trim(), zoomRef.current <= 8 ? "全国" : "");
        if (cancelled) return;
        setSuggestions(
          tips.map((tip) => ({
            id: tip.id,
            name: tip.name,
            subtitle: [tip.district, tip.address].filter(Boolean).join(" · ") || tip.type,
            location: tip.location,
            kind: "place",
            icon: "📍",
          }))
        );
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, mode, searchReadyKey]);

  return { suggestions, setSuggestions };
}
