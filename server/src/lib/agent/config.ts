// env 读取单点(secret 只在此处读)。AGENT_LLM_* 优先,回退 LLM_*。
// 只读 process.env,绝不打印/记录/落日志任何 secret 值;reason 只含变量名。

export interface AgentConfig {
  /** AGENT_LLM_BASE_URL → 回退 LLM_BASE_URL。 */
  baseUrl: string;
  /** AGENT_LLM_API_KEY → 回退 LLM_API_KEY。 */
  apiKey: string;
  /** AGENT_LLM_MODEL → 回退 LLM_MODEL。 */
  model: string;
  /** AGENT_MAX_TOOL_TURNS,默认 8。 */
  maxTurns: number;
  /** AGENT_HISTORY_LIMIT(历史字符上限),默认 6000。 */
  maxHistoryChars: number;
}

function firstEnv(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = process.env[k];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return undefined;
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readAgentConfig(): { ok: true; cfg: AgentConfig } | { ok: false; reason: string } {
  const baseUrl = firstEnv('AGENT_LLM_BASE_URL', 'LLM_BASE_URL');
  const apiKey = firstEnv('AGENT_LLM_API_KEY', 'LLM_API_KEY');
  const model = firstEnv('AGENT_LLM_MODEL', 'LLM_MODEL');
  const missing: string[] = [];
  if (!baseUrl) missing.push('AGENT_LLM_BASE_URL/LLM_BASE_URL');
  if (!apiKey) missing.push('AGENT_LLM_API_KEY/LLM_API_KEY');
  if (!model) missing.push('AGENT_LLM_MODEL/LLM_MODEL');
  if (missing.length > 0) return { ok: false, reason: `agent LLM 未配置:缺少 ${missing.join('、')}` };
  return {
    ok: true,
    cfg: {
      baseUrl: baseUrl as string,
      apiKey: apiKey as string,
      model: model as string,
      maxTurns: positiveInt('AGENT_MAX_TOOL_TURNS', 8),
      maxHistoryChars: positiveInt('AGENT_HISTORY_LIMIT', 6000),
    },
  };
}

/** BAIDU_MAP_AUTH_TOKEN 非空(供 ws-b 的百度 agent 计划用,先在此定义)。 */
export function hasBaiduAgentPlan(): boolean {
  const token = process.env.BAIDU_MAP_AUTH_TOKEN;
  return typeof token === 'string' && token.trim().length > 0;
}
