// Agent 搜索结果图片:从工具结果抽取/净化,供最终回答气泡下方展示。
// 只接受 http(s) 图床或短 data:image;不把二进制塞进 LLM 上下文。

export interface AgentImage {
  url: string;
  alt?: string;
}

export const AGENT_IMAGES_MAX = 6;
export const AGENT_IMAGE_URL_MAX = 2000;
export const AGENT_DATA_URL_MAX = 80 * 1024;

const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|bmp)(?:$|\?)/i;
const IMAGE_HOST_RE =
  /(?:store\.is\.autonavi\.com|img\d*\.place\.qpic\.cn|qpic\.cn|img\.alicdn\.com|gw\.alicdn\.com|p[0-9]\.meituan\.net)/i;
const URL_IN_TEXT_RE = /https?:\/\/[^\s"'<>\\]+/gi;
const JSON_IMAGE_KEY_RE = /"(?:photos?|images?|logoUrl|logo_url|icon|thumbnail)"\s*:\s*/i;

function upgradeHttp(url: string): string {
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
}

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isLikelyImageUrl(url: string): boolean {
  return IMAGE_EXT_RE.test(url) || IMAGE_HOST_RE.test(url);
}

function isSafeDataUrl(url: string): boolean {
  return /^data:image\/(?:jpeg|jpg|png|gif|webp);base64,/i.test(url) && url.length <= AGENT_DATA_URL_MAX;
}

export function sanitizeAgentImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > AGENT_IMAGE_URL_MAX) return null;
  if (trimmed.startsWith('data:')) return isSafeDataUrl(trimmed) ? trimmed : null;
  if (!isSafeHttpUrl(trimmed)) return null;
  const https = upgradeHttp(trimmed);
  if (https.length > AGENT_IMAGE_URL_MAX) return null;
  try {
    const parsed = new URL(https);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    return https;
  } catch {
    return null;
  }
}

export function normalizeAgentImage(raw: unknown): AgentImage | null {
  if (!raw || typeof raw !== 'object') {
    const url = sanitizeAgentImageUrl(raw);
    return url ? { url } : null;
  }
  const item = raw as { url?: unknown; alt?: unknown };
  const url = sanitizeAgentImageUrl(item.url);
  if (!url) return null;
  const alt = typeof item.alt === 'string' ? item.alt.trim().slice(0, 80) : '';
  return alt ? { url, alt } : { url };
}

export function normalizeAgentImages(raw: unknown): AgentImage[] {
  if (!Array.isArray(raw)) {
    const one = normalizeAgentImage(raw);
    return one ? [one] : [];
  }
  const out: AgentImage[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const image = normalizeAgentImage(item);
    if (!image || seen.has(image.url)) continue;
    seen.add(image.url);
    out.push(image);
    if (out.length >= AGENT_IMAGES_MAX) break;
  }
  return out;
}

export function mergeAgentImages(...groups: Array<AgentImage[] | undefined>): AgentImage[] {
  return normalizeAgentImages(groups.flatMap((group) => group ?? []));
}

/** MCP image content → 短 data URL;超长丢弃,避免打爆 SSE。 */
export function agentImageFromMcp(data: unknown, mimeType: unknown): AgentImage | null {
  if (typeof data !== 'string' || !data.trim()) return null;
  let mime = 'image/jpeg';
  if (typeof mimeType === 'string' && mimeType.trim()) {
    if (!/^image\/(?:jpeg|jpg|png|gif|webp)$/i.test(mimeType)) return null;
    mime = mimeType.toLowerCase().replace('image/jpg', 'image/jpeg');
  }
  const payload = data.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(payload)) return null;
  return sanitizeAgentImageUrl(`data:${mime};base64,${payload}`)
    ? { url: `data:${mime};base64,${payload}` }
    : null;
}

/**
 * 从工具转述文本里捞图片 URL。只收扩展名/已知图床,避免把投递链接当图。
 * JSON 的 photos/logoUrl 字段附近的 URL 即使无扩展名也收。
 */
export function extractAgentImagesFromText(text: string): AgentImage[] {
  if (!text) return [];
  const out: AgentImage[] = [];
  const seen = new Set<string>();
  const nearImageKey = (index: number): boolean => {
    const start = Math.max(0, index - 80);
    return JSON_IMAGE_KEY_RE.test(text.slice(start, index));
  };
  let match: RegExpExecArray | null;
  const re = new RegExp(URL_IN_TEXT_RE);
  while ((match = re.exec(text)) !== null) {
    const raw = match[0].replace(/[),.;]+$/, '');
    if (!isLikelyImageUrl(raw) && !nearImageKey(match.index)) continue;
    const url = sanitizeAgentImageUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url });
    if (out.length >= AGENT_IMAGES_MAX) break;
  }
  return out;
}

export function collectToolImages(result: { images?: AgentImage[]; text?: string }): AgentImage[] {
  return mergeAgentImages(result.images, extractAgentImagesFromText(result.text ?? ''));
}
