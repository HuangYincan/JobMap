// 白名单无副作用工具(tech/24 §5.3):viewport 回显 + listTools。
// 无网络、无状态、无 secret;listTools 经工厂注入的 getter 读取当前工具集
// (route 侧在构建完工具后设置,闭包读取最新值)。

import type { AgentTool, ToolResult } from '../types.ts';

/**
 * 构建 builtin 工具组。
 * @param getToolNames 当前可用工具名列表的 getter(listTools 用;route 构建完工具集后生效)。
 */
export function builtinTools(getToolNames?: () => string[]): AgentTool[] {
  return [
    {
      name: 'builtin__viewport',
      description: '回显当前地图视野:中心点经纬度(GCJ-02)、缩放级别与可见边界;无需参数',
      inputSchema: { type: 'object', properties: {} },
      provider: 'builtin',
      async call(_input: Record<string, unknown>, ctx): Promise<ToolResult> {
        if (!ctx.viewport) return { ok: true, text: '当前没有可用的视野信息' };
        const { center, zoom, bounds } = ctx.viewport;
        const parts = [`中心: ${center.lng},${center.lat}`, `zoom: ${zoom}`];
        if (bounds) {
          parts.push(`边界: ${bounds.minLng},${bounds.minLat} ~ ${bounds.maxLng},${bounds.maxLat}`);
        }
        return { ok: true, text: parts.join(';') };
      },
    },
    {
      name: 'builtin__listTools',
      description: '列出当前会话可用的工具名称(不含任何密钥或内部配置)',
      inputSchema: { type: 'object', properties: {} },
      provider: 'builtin',
      async call(_input: Record<string, unknown>, _ctx): Promise<ToolResult> {
        const names = getToolNames?.() ?? [];
        if (names.length === 0) return { ok: true, text: '当前没有可用工具' };
        return { ok: true, text: names.join('\n') };
      },
    },
  ];
}
