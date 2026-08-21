// REST 兜底工具(常备,tech/24 §5.3/5.4):geocode / placeSearch / regeo。
// 只 import site-geocode.ts 的 geocodeAddressRest / placeTextSearchRest /
// regeoCityRest(自带 AMap→百度→腾讯三级兜底,**不改该文件**);输出统一转述
// 纯文本 + sanitizeToolText 截断 3000(复用 ws-a 的净化,防超长/script 串进
// LLM 上下文)。

import type { AgentTool, ToolResult } from '../types.ts';
import { geocodeAddressRest, placeTextSearchRest, regeoCityRest } from '../../site-geocode.ts';
import { sanitizeToolText } from '../run-agent.ts';

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

/**
 * 构建 REST 兜底工具组(fetchImpl 可注入,测试用;route 侧默认全局 fetch)。
 */
export function restFallbackTools(fetchImpl: typeof fetch = fetch): AgentTool[] {
  return [
    {
      name: 'rest__geocodeAddress',
      description: '地址/地名 → GCJ-02 经纬度(AMap→百度→腾讯三级兜底);返回坐标与来源',
      inputSchema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: '地址或地名,如「滨江区长河街道」' },
          city: { type: 'string', description: '城市,默认杭州' },
        },
        required: ['address'],
      },
      provider: 'rest',
      async call(input: Record<string, unknown>): Promise<ToolResult> {
        const address = str(input.address);
        if (!address) return textErr('geocodeAddress 需要 address 参数');
        const city = str(input.city) ?? '杭州';
        const r = await geocodeAddressRest(address, city, fetchImpl);
        if (!r.ok || !r.location) return textErr(`地理编码失败: ${r.reason ?? 'unknown'}`);
        return textOk(`坐标(GCJ-02): ${r.location.lng},${r.location.lat}(来源: ${r.provider ?? 'rest'};地址: ${address})`);
      },
    },
    {
      name: 'rest__placeSearch',
      description: '关键词 → POI 列表(名称/地址/经纬度,GCJ-02;AMap→百度→腾讯三级兜底)',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词,如「咖啡」' },
          city: { type: 'string', description: '城市,默认杭州' },
        },
        required: ['query'],
      },
      provider: 'rest',
      async call(input: Record<string, unknown>): Promise<ToolResult> {
        const query = str(input.query);
        if (!query) return textErr('placeSearch 需要 query 参数');
        const city = str(input.city) ?? '杭州';
        const r = await placeTextSearchRest(query, city, fetchImpl);
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
