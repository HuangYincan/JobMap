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
import { INTERNSHIP_SEED } from "@/lib/seed-data";
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
}

export function useSearchState(options: SearchStateOptions) {
  const { query, mode, distanceOriginRef, zoomRef, catalogRef, engine } = options;
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  // 引擎经 ref 读取:依赖保持 [query, mode](引擎切换由 f 扩展统一处理)
  const engineRef = useRef(engine);
  engineRef.current = engine;

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
          const pool = catalogRef.current.length ? catalogRef.current : INTERNSHIP_SEED;
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
      // 本地 0 命中 / 请求失败 → 回退高德 AutoComplete 一次(经活跃引擎,
      // use-map-engine 注入;引擎未就绪 → 无建议回退,与地图不可用同语义)
      try {
        if (!engineRef.current) return;
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
  }, [query, mode]);

  return { suggestions, setSuggestions };
}
