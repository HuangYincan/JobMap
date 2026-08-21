// AI Agent 全链路契约(ws-a: agent backend core)。
//
// 本文件只有类型与纯契约,零运行时逻辑。Agent 引擎由 run-agent.ts 驱动:
// LLM(OpenAI 兼容流式)↔ AgentTool 白名单 ↔ AgentEvent(SSE 事件流)。
// 注意:mode 一律用 string,不 import MapMode,避免与地图模式硬编码 union 耦合。

/** 一个白名单工具。route 侧(ws-b)按 key 配置构建实例注入 runAgent。 */
export interface AgentTool {
  /** 唯一名称,如 amap__place_search / rest__geocode / builtin__viewport。 */
  name: string;
  /** 注入 LLM 的描述,截断 ≤500 字符(截断在 run-agent 构建 tools 时做)。 */
  description: string;
  /** JSON Schema(OpenAI tools 参数,parameters 字段)。 */
  inputSchema: Record<string, unknown>;
  provider: 'amap' | 'tencent' | 'baidu' | 'rest' | 'builtin';
  call(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult>;
}

export type ToolResult = { ok: true; text: string } | { ok: false; error: string };

export interface AgentContext {
  viewport?: {
    center: { lng: number; lat: number };
    zoom: number;
    bounds?: { minLng: number; minLat: number; maxLng: number; maxLat: number };
  };
  lang: 'zh' | 'en';
  requestId: string;
  signal: AbortSignal;
}

/** 动作白名单(SSE action 事件 payload)。 */
export type AgentAction =
  | { type: 'flyTo'; payload: { center: { lng: number; lat: number }; zoom?: number } }
  | { type: 'select'; payload: { id: string; mode?: string } }
  | { type: 'addMarkers'; payload: { points: Array<{ lng: number; lat: number; label?: string }> } }
  | { type: 'drawCircle'; payload: { center: { lng: number; lat: number }; radiusMeters: number; label?: string } }
  | { type: 'openDetail'; payload: { id: string; mode?: string } }
  | { type: 'search'; payload: { query: string; mode?: string } };

export type AgentEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string } // 推理模型流式思考内容(DeepSeek reasoning_content;run-agent 截断 4000 字符)
  | { type: 'tool'; name: string; status: 'start' | 'done' | 'error'; summary?: string }
  | { type: 'action'; action: AgentAction }
  | { type: 'done'; truncated?: boolean }
  | { type: 'error'; code: string; message: string };
