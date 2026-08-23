// baidu-ai-map skill 契约工具组(env 门控,tech/24 §5.2)。
//
// hasBaiduAgentPlan()(BAIDU_MAP_AUTH_TOKEN 非空)为 false 时**不注册**
// (导出空数组)。端点:GET https://api.map.baidu.com/agent_plan/v1/{...},
// header `Authorization: Bearer $BAIDU_MAP_AUTH_TOKEN`(token 只进请求头,
// 绝不进错误信息/日志/SSE)。
//
// 契约红线:不得编造坐标;坐标至少 6 位小数;坐标/center/location 仅来自用户
// 明确提供或可信来源(本组工具的坐标输出全部来自百度 API 原样响应);响应
// **不裁剪**(直接转述原文,不进 sanitizeToolText)。

import type { AgentContext, AgentTool, ToolResult } from '../types.ts';
import { hasBaiduAgentPlan } from '../config.ts';
import { fetchWithTimeout } from '../../fetch-with-timeout.ts';

const AGENT_PLAN_BASE = 'https://api.map.baidu.com/agent_plan/v1';

interface BaiduAgentPlanToolSpec {
  name: string;
  description: string;
  /** 必填参数(缺失 → 工具 error,不发请求)。 */
  required: string[];
  /** 可选参数。 */
  optional: string[];
  /** 额外校验:返回错误信息或 null(通过)。 */
  validate?: (input: Record<string, unknown>) => string | null;
}

const TOOL_SPECS: BaiduAgentPlanToolSpec[] = [
  {
    name: 'baidu__place',
    description: '地点检索:把完整用户需求交给百度地图智能体理解并返回地点结果(user_raw_request 必填,需完整描述需求;region 可选限定城市)',
    required: ['user_raw_request'],
    optional: ['region'],
  },
  {
    name: 'baidu__direction',
    description: '路线规划:user_raw_request 需包含起终点(完整用户需求);location 可选限定当前位置',
    required: ['user_raw_request'],
    optional: ['location'],
  },
  {
    name: 'baidu__geocoding',
    description: '地址 → 坐标(百度智能体;返回坐标来自百度 API,未经裁剪)',
    required: ['address'],
    optional: [],
  },
  {
    name: 'baidu__reverse_geocoding',
    description: '坐标 → 地址(百度智能体;location 格式为 "lat,lng",GCJ-02)',
    required: ['location'],
    optional: [],
    validate: (input) => {
      const loc = input.location;
      if (typeof loc !== 'string') return 'location 必须是 "lat,lng" 字符串(GCJ-02)';
      const parts = loc.split(',').map((s) => Number(s.trim()));
      if (parts.length !== 2 || !parts.every((n) => Number.isFinite(n))) return 'location 必须是 "lat,lng" 两个有限数字(GCJ-02)';
      return null;
    },
  },
  {
    name: 'baidu__weather',
    description: '天气查询(百度智能体;region 与 location 至少提供一个)',
    required: [],
    optional: ['region', 'location'],
    validate: (input) => {
      if (!input.region && !input.location) return 'weather 需要 region 或 location 至少一个';
      return null;
    },
  },
];

async function callAgentPlan(
  endpoint: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<{ text: string; isError: boolean }> {
  const token = process.env.BAIDU_MAP_AUTH_TOKEN?.trim();
  if (!token) return { text: 'baidu agent plan 未配置', isError: true };
  const url = new URL(`${AGENT_PLAN_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` }, signal }, fetchImpl);
  } catch {
    return { text: 'baidu agent plan 请求失败(网络错误)', isError: true };
  }
  let body = '';
  try {
    body = await res.text();
  } catch {
    return { text: `baidu agent plan 请求失败(status ${res.status})`, isError: true };
  }
  if (!res.ok) return { text: `baidu agent plan 请求失败(status ${res.status})`, isError: true };
  // 契约红线:响应不裁剪,直接转述原文
  return { text: body, isError: false };
}

/**
 * 构建 baidu-ai-map skill 工具组。BAIDU_MAP_AUTH_TOKEN 未配 → 空数组(不注册)。
 * fetchImpl 可注入(测试用;route 侧默认全局 fetch)。
 */
export function baiduAgentPlanTools(fetchImpl: typeof fetch = fetch): AgentTool[] {
  if (!hasBaiduAgentPlan()) return [];
  return TOOL_SPECS.map((spec) => {
    const path = spec.name.replace(/^baidu__/, '');
    return {
      name: spec.name,
      description: spec.description,
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(
          [...spec.required, ...spec.optional].map((k) => [k, { type: 'string' }]),
        ),
        required: spec.required,
      },
      provider: 'baidu',
      async call(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
        for (const k of spec.required) {
          const v = input[k];
          if (typeof v !== 'string' || v.trim().length === 0) {
            return { ok: false, error: `${spec.name} 需要必填参数 ${k}` };
          }
        }
        if (spec.validate) {
          const err = spec.validate(input);
          if (err) return { ok: false, error: err };
        }
        const params: Record<string, string> = {};
        for (const k of [...spec.required, ...spec.optional]) {
          const v = input[k];
          if (typeof v === 'string') params[k] = v;
        }
        const r = await callAgentPlan(path, params, fetchImpl, ctx.signal);
        return r.isError ? { ok: false, error: r.text } : { ok: true, text: r.text };
      },
    };
  });
}
