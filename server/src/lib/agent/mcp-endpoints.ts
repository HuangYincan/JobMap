// MCP 端点常量 —— 三平台接入的单点校准处(tech/24 §5.1)。
//
// key 经 site-geocode.ts 的 getter 读取(trim 后非空即配),null = key 未配
// (provider 不注册)。本文件用 getter 惰性求值,测试可通过 env 注入/还原驱动。
// 安全:本文件含真实 key 值时禁止 console.log,只在内部拼 URL;错误信息只含
// host 与 status,绝不含 key。

import { amapWebKey, baiduWebKey, tencentWebKey } from '../site-geocode.ts';

export interface McpEndpoint {
  /** 完整端点 URL(已内嵌 key,只内部使用,绝不输出)。 */
  url: string;
  transport: 'streamable' | 'sse';
  auth: 'query' | 'bearer' | 'none';
  /** URL 里的鉴权参数名(query 型)。 */
  authParam?: string;
  /** 备选端点(transport 不同):初始化握手失败(404/405/400)时换它重试一次。 */
  fallbackUrl?: string;
}

function makeEndpoint(
  base: string,
  authParam: string,
  authValue: string,
  transport: 'streamable' | 'sse',
  extra = '',
): McpEndpoint {
  return {
    url: `${base}?${authParam}=${encodeURIComponent(authValue)}${extra}`,
    transport,
    auth: 'query',
    authParam,
  };
}

/**
 * 三平台 MCP 端点(惰性 getter:每次读取按当前 env 求值,测试可注入 env)。
 * - 高德:Streamable HTTP /mcp?key=<key>(2026-08-21 实测校准:POST initialize
 *   返回 200,协议版本 2025-03-26;旧 /sse 端点实测 404,已弃用)
 * - 腾讯:SSE,format=0 文本输出适合 LLM;key=TENCENT_MAP_KEY
 * - 百度:streamable(官方推荐),备选 SSE;ak=BAIDU_MAP_AK
 */
export const MCP_ENDPOINTS: Record<'amap' | 'tencent' | 'baidu', McpEndpoint | null> = {
  get amap(): McpEndpoint | null {
    const key = amapWebKey();
    if (!key) return null;
    // 2026-08-21 实测校准:高德为 Streamable HTTP(非官方文档所写 SSE);
    // 旧 /sse 端点实测 404 弃用。/mcp 端点 POST initialize 返回 200,
    // protocolVersion 2025-03-26。query auth 保持 key=<key>。
    return makeEndpoint('https://mcp.amap.com/mcp', 'key', key, 'streamable');
  },
  get tencent(): McpEndpoint | null {
    const key = tencentWebKey();
    if (!key) return null;
    return makeEndpoint('https://mcp.map.qq.com/sse', 'key', key, 'sse', '&format=0');
  },
  get baidu(): McpEndpoint | null {
    const ak = baiduWebKey();
    if (!ak) return null;
    return {
      ...makeEndpoint('https://mcp.map.baidu.com/mcp', 'ak', ak, 'streamable'),
      fallbackUrl: `https://mcp.map.baidu.com/sse?ak=${encodeURIComponent(ak)}`,
    };
  },
};
