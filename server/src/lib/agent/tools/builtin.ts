// 白名单无副作用工具(tech/24 §5.3):viewport 回显 + listTools。
// 无网络、无状态、无 secret;listTools 经工厂注入的 getter 读取当前工具集
// (route 侧在构建完工具后设置,闭包读取最新值)。
//
// builtin__memory_save(2026-08-22 ws-mem-a):用户个性化记忆写入(tech/30-agent-memory.md §4)。
// 有状态(写 user_memories),但只经 ctx.userId 归属当前会话用户,不接触任何 secret。

import type { AgentTool, ToolResult } from '../types.ts';
import { DbUnavailableError } from '../../account-store.ts';
import { addMemory, sanitizeMemoryContent } from '../../memory-store.ts';

/**
 * 构建 builtin 工具组。
 * @param getToolNames 当前可用工具名列表的 getter(listTools 用;route 构建完工具集后生效)。
 */
export function builtinTools(getToolNames?: () => string[]): AgentTool[] {
  return [
    {
      name: 'builtin__viewport',
      description:
        '回显用户位置(附近/岗位检索起点,优先)与当前地图视野中心(GCJ-02)、缩放与可见边界;无需参数。附近检索必须用用户位置,不得把视野中心当成人所在地。',
      inputSchema: { type: 'object', properties: {} },
      provider: 'builtin',
      async call(_input: Record<string, unknown>, ctx): Promise<ToolResult> {
        const parts: string[] = [];
        if (ctx.userLocation) {
          parts.push(`用户位置(附近检索/岗位检索起点): ${ctx.userLocation.lng},${ctx.userLocation.lat}`);
        }
        if (ctx.viewport) {
          const { center, zoom, bounds } = ctx.viewport;
          parts.push(`视野中心: ${center.lng},${center.lat}`, `zoom: ${zoom}`);
          if (bounds) {
            parts.push(`边界: ${bounds.minLng},${bounds.minLat} ~ ${bounds.maxLng},${bounds.maxLat}`);
          }
        }
        if (parts.length === 0) return { ok: true, text: '当前没有可用的视野信息' };
        if (!ctx.userLocation) {
          parts.unshift('用户位置未知,附近检索/岗位检索可回退视野中心');
        }
        return { ok: true, text: parts.join('; ') };
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

/**
 * 用户记忆保存工具(2026-08-22 ws-mem-a;tech/30-agent-memory.md §4)。
 * 仅在会话用户已登录时由 route 追加进工具集;ctx.userId 缺失(guest/防御)一律拒绝。
 * 敏感信息不做硬性拦截——由工具描述约束 LLM 不保存密码/密钥/完整地址等,
 * 存储层只做纯文本 sanitize(trim + 截断 200 字),不解析内容。
 */
export function memorySaveTool(): AgentTool {
  return {
    name: 'builtin__memory_save',
    description:
      '当用户明确表达个人偏好、身份信息、常驻城市、求职意向等希望长期记住的事实,且对未来的对话有用时,调用本工具保存一条记忆。禁止保存密码、密钥、验证码、完整家庭住址等敏感信息;只保存用户主动表达、可长期复用的事实。',
    inputSchema: {
      type: 'object',
      properties: { content: { type: 'string', description: '记忆内容,≤200 字' } },
      required: ['content'],
    },
    provider: 'builtin',
    async call(input: Record<string, unknown>, ctx): Promise<ToolResult> {
      if (!ctx.userId) return { ok: false, error: '请先登录后再保存记忆' };
      const content = sanitizeMemoryContent(input.content);
      if (!content) return { ok: false, error: '记忆内容不能为空' };
      try {
        await addMemory(ctx.userId, content);
      } catch (err) {
        if (err instanceof DbUnavailableError) return { ok: false, error: '记忆服务暂不可用,请稍后再试' };
        return { ok: false, error: '保存记忆失败,请稍后再试' };
      }
      return { ok: true, text: `已记住:${content}` };
    },
  };
}
