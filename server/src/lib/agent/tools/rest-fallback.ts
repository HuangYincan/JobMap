// REST 兜底工具(常备,tech/24 §5.3/5.4):geocode / placeSearch / regeo。
// 地点检索/地理编码先查本地招聘目录与杭州 POI,未命中再走
// site-geocode.ts 的 geocodeAddressRest / placeTextSearchRest /
// regeoCityRest(自带 AMap→百度→腾讯三级兜底,**不改该文件**);输出统一转述
// 纯文本 + sanitizeToolText 截断 3000(复用 ws-a 的净化,防超长/script 串进
// LLM 上下文)。

import type { AgentTool, ToolResult } from '../types.ts';
import { geocodeAddressRest, placeTextSearchRest, regeoCityRest } from '../../site-geocode.ts';
import { sanitizeToolText } from '../run-agent.ts';
import {
  formatLocalPlaceHits,
  parsePlaceQuery,
  searchLocalPlaces,
  type LocalPlaceHit,
} from '../local-place-search.ts';

function textOk(text: string): ToolResult {
  return { ok: true, text: sanitizeToolText(text) };
}

function textErr(text: string): ToolResult {
  return { ok: false, error: sanitizeToolText(text) };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export interface RestFallbackDeps {
  searchLocal?: (query: string, city?: string) => Promise<LocalPlaceHit[]>;
}

/**
 * 构建 REST 兜底工具组(fetchImpl 可注入,测试用;route 侧默认全局 fetch)。
 */
export function restFallbackTools(
  fetchImpl: typeof fetch = fetch,
  deps: RestFallbackDeps = {},
): AgentTool[] {
  const searchLocal = deps.searchLocal ?? searchLocalPlaces;
  return [
    {
      name: 'rest__geocodeAddress',
      description:
        '地址/地名 → GCJ-02 经纬度。先查本地招聘目录与杭州 POI,未命中再走 AMap→百度→腾讯 REST;返回坐标与来源',
      inputSchema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: '地址或地名,如「滨江区长河街道」' },
          city: { type: 'string', description: '城市;可从地址中的城市名推断,不要默认当成杭州' },
        },
        required: ['address'],
      },
      provider: 'rest',
      async call(input: Record<string, unknown>): Promise<ToolResult> {
        const address = str(input.address);
        if (!address) return textErr('geocodeAddress 需要 address 参数');
        const parsed = parsePlaceQuery(address, str(input.city));
        const local = await searchLocal(address, parsed.city);
        if (local.length > 0) return textOk(formatLocalPlaceHits(local));
        const city = parsed.city ?? '杭州';
        const r = await geocodeAddressRest(address, city, fetchImpl);
        if (!r.ok || !r.location) return textErr(`地理编码失败: ${r.reason ?? 'unknown'}`);
        return textOk(`坐标(GCJ-02): ${r.location.lng},${r.location.lat}(来源: ${r.provider ?? 'rest'};地址: ${address})`);
      },
    },
    {
      name: 'rest__placeSearch',
      description:
        '关键词 → POI。先查本地招聘目录与杭州 POI(如「深圳腾讯」),未命中再走 AMap→百度→腾讯 REST;返回名称/地址/GCJ-02 经纬度',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词,如「深圳腾讯」或「咖啡」' },
          city: { type: 'string', description: '城市;可从关键词中的城市名推断,不要默认当成杭州' },
        },
        required: ['query'],
      },
      provider: 'rest',
      async call(input: Record<string, unknown>): Promise<ToolResult> {
        const query = str(input.query);
        if (!query) return textErr('placeSearch 需要 query 参数');
        const parsed = parsePlaceQuery(query, str(input.city));
        const local = await searchLocal(query, parsed.city);
        if (local.length > 0) return textOk(formatLocalPlaceHits(local));
        const city = parsed.city ?? '杭州';
        const r = await placeTextSearchRest(parsed.keyword || query, city, fetchImpl);
        if (!r.ok) return textErr(`搜索失败: ${r.reason ?? 'unknown'}`);
        if (r.pois.length === 0) return textOk(`「${query}」在 ${city} 没有找到 POI`);
        const lines = r.pois.map((p, i) => `${i + 1}. ${p.name} — ${p.address} — ${p.lng},${p.lat}`);
        return textOk(`找到 ${r.pois.length} 个 POI(来源: ${r.provider ?? 'rest'};城市: ${city}):\n${lines.join('\n')}`);
      },
    },
    {
      name: 'rest__regeo',
      description: '经纬度 → 省/市/区(逆地理编码;AMap→百度→腾讯三级兜底)',
      inputSchema: {
        type: 'object',
        properties: {
          lng: { type: 'number', description: '经度(GCJ-02)' },
          lat: { type: 'number', description: '纬度(GCJ-02)' },
        },
        required: ['lng', 'lat'],
      },
      provider: 'rest',
      async call(input: Record<string, unknown>): Promise<ToolResult> {
        const lng = num(input.lng);
        const lat = num(input.lat);
        if (lng === undefined || lat === undefined) return textErr('regeo 需要 lng/lat 两个有限数字参数');
        const r = await regeoCityRest(lng, lat, fetchImpl);
        if (!r.ok) return textErr(`逆地理编码失败`);
        const parts = [r.province, r.cityname, r.district].filter((v): v is string => !!v);
        return textOk(`坐标 ${lng},${lat} 位于 ${parts.join('/') || '未知区域'}(来源: ${r.provider ?? 'rest'})`);
      },
    },
  ];
}
