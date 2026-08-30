// ============================================================
// Agent 会话存储(ws-panel2:多会话管理)
//
// 纯函数 + 注入式存储:localStorage/sessionStorage 读写作为参数传入,
// node 环境零 window 依赖可单测。存储 key `dm.agent-sessions.v1`,
// 结构 `{sessions: [{id, title, messages, updatedAt}], activeId}`。
//
// 规则:
// - cap:10 会话 × 每会话 30 条消息(超出丢最旧);
// - 标题 deriveTitle:首条用户消息截断 12 字(按码点),无 → 「新会话」;
// - 删除当前会话 → 切到最近(updatedAt 最大);全删 → 新建空会话;
// - 面板清屏(2026-08-31):saveMessages(activeId, []) 清空当前会话,不归档;
//   流式中先 removeStream(abort + 丢掉未完成助手输出)。archiveAndNew 仍保留
//   给存储层/测试,UI 不再调用;
// - 迁移:无 v1 键时读旧 sessionStorage `dm.agent-history.v1`(前端单会话
//   历史)迁为第一个会话(保留原消息);迁移后旧键清除。
// ============================================================

import type { AgentMessage } from "./agent-panel-state.ts";
import { validateAction } from "./agent/action-schema.ts";
import { normalizeAgentImages } from "./agent/result-images.ts";

/** 新版会话存储 key(localStorage)。 */
export const SESSIONS_KEY = "dm.agent-sessions.v1";
/** 旧版单会话历史 key(sessionStorage;仅迁移读)。 */
export const LEGACY_HISTORY_KEY = "dm.agent-history.v1";
/** 本地会话整份原文上限;超过直接视为损坏,不进入 JSON.parse。 */
export const AGENT_STATE_RAW_MAX = 4 * 1024 * 1024;
/** 旧版历史原文上限(旧键只存单会话,上限更严)。 */
export const LEGACY_HISTORY_RAW_MAX = 512 * 1024;
/** 会话数上限。 */
export const SESSIONS_CAP = 10;
/** 单会话消息数上限。 */
export const SESSION_MESSAGES_CAP = 30;
/** Persisted text and attachment arrays are bounded before entering app memory. */
export const MESSAGE_CONTENT_MAX = 4000;
export const ACTIONS_PER_MESSAGE_CAP = 20;
export const TOOLS_PER_MESSAGE_CAP = 32;
export const TOOL_SUMMARY_MAX = 200;
export const IMAGES_PER_MESSAGE_CAP = 6;
export const SESSION_ID_MAX = 128;
/** 标题截断长度(码点)。 */
export const TITLE_MAX = 12;
/** 无用户消息时的默认标题。 */
export const DEFAULT_SESSION_TITLE = "新会话";

/** 注入式存储(兼容 window.localStorage / window.sessionStorage 子集)。 */
export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AgentSession {
  id: string;
  title: string;
  messages: AgentMessage[];
  /** 最后活动时间(epoch ms)。 */
  updatedAt: number;
}

export interface AgentSessionState {
  sessions: AgentSession[];
  activeId: string | null;
}

export type SessionRelativeTime =
  | { kind: "justNow" }
  | { kind: "minutes"; n: number }
  | { kind: "hours"; n: number }
  | { kind: "date"; month: number; day: number };

/** 会话 id:时间基 + 随机后缀。 */
export function createSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isValidMessage(m: unknown): m is AgentMessage {
  if (!m || typeof m !== "object") return false;
  const r = m as { role?: unknown; content?: unknown };
  return (r.role === "user" || r.role === "assistant") && typeof r.content === "string";
}

function isValidToolActivity(value: unknown): value is {
  name: string;
  status: "start" | "done" | "error";
  summary?: string;
} {
  if (!value || typeof value !== "object") return false;
  const tool = value as { name?: unknown; status?: unknown };
  return (
    typeof tool.name === "string" &&
    (tool.status === "start" || tool.status === "done" || tool.status === "error")
  );
}

function normalizeToolActivity(tool: { name: string; status: "start" | "done" | "error"; summary?: string }) {
  return {
    name: tool.name.slice(0, 64),
    status: tool.status,
    ...(typeof tool.summary === "string"
      ? { summary: tool.summary.slice(0, TOOL_SUMMARY_MAX) }
      : {}),
  };
}

/** 消息归一化:只保留 role/content + 合法 actions/tools 数组。 */
function normalizeMessage(m: AgentMessage): AgentMessage {
  const actions = Array.isArray(m.actions)
    ? m.actions
        .map(validateAction)
        .filter((action): action is NonNullable<typeof action> => action !== null)
        .slice(0, ACTIONS_PER_MESSAGE_CAP)
    : [];
  const tools = Array.isArray(m.tools)
    ? m.tools.filter(isValidToolActivity).map(normalizeToolActivity).slice(0, TOOLS_PER_MESSAGE_CAP)
    : [];
  const images = Array.isArray(m.images)
    ? normalizeAgentImages(m.images)
        .filter((img) => img.url.startsWith("https://"))
        .slice(0, IMAGES_PER_MESSAGE_CAP)
    : [];
  return {
    role: m.role,
    content: m.content.slice(0, MESSAGE_CONTENT_MAX),
    ...(actions.length > 0 ? { actions } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(images.length > 0 ? { images } : {}),
  };
}

/**
 * 标题派生(纯函数):首条用户消息 trim 后按码点截断 12 字;
 * 无用户消息(或空内容)→ 「新会话」。
 */
export function deriveTitle(messages: AgentMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const text = (first?.content ?? "").trim();
  if (!text) return DEFAULT_SESSION_TITLE;
  return [...text].slice(0, TITLE_MAX).join("");
}

export function emptyState(): AgentSessionState {
  return { sessions: [], activeId: null };
}

/** 纯解析:坏 JSON / 结构不符 → null;部分行损坏 → 丢弃该行。 */
export function parseState(raw: string | null): AgentSessionState | null {
  if (!raw || raw.length > AGENT_STATE_RAW_MAX) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as { sessions?: unknown; activeId?: unknown };
  if (!Array.isArray(d.sessions)) return null;
  const sessions: AgentSession[] = [];
  for (const s of d.sessions) {
    if (!s || typeof s !== "object") continue;
    const row = s as { id?: unknown; title?: unknown; messages?: unknown; updatedAt?: unknown };
    if (typeof row.id !== "string" || !row.id || row.id.length > SESSION_ID_MAX) continue;
    if (typeof row.updatedAt !== "number" || !Number.isFinite(row.updatedAt)) continue;
    if (!Array.isArray(row.messages)) continue;
    const messages = row.messages
      .slice(-SESSION_MESSAGES_CAP)
      .filter(isValidMessage)
      .map(normalizeMessage);
    sessions.push({
      id: row.id,
      title: typeof row.title === "string" && row.title
        ? [...row.title].slice(0, TITLE_MAX).join("")
        : deriveTitle(messages),
      messages,
      updatedAt: row.updatedAt,
    });
  }
  // A corrupted store may contain thousands of rows; keep the most recent
  // product-supported working set instead of materializing all of it.
  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  sessions.length = Math.min(sessions.length, SESSIONS_CAP);
  const activeId = typeof d.activeId === "string" && sessions.some((s) => s.id === d.activeId)
    ? d.activeId
    : sessions.length > 0
      ? sessions.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a)).id
      : null;
  return { sessions, activeId };
}

/** 旧版历史(裸消息数组)解析:坏数据/空 → []。 */
export function parseLegacyHistory(raw: string | null): AgentMessage[] {
  if (!raw || raw.length > LEGACY_HISTORY_RAW_MAX) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidMessage).map(normalizeMessage).slice(-SESSION_MESSAGES_CAP);
  } catch {
    return [];
  }
}

/** 会话列表:按 updatedAt 倒序(深一层的副本,调用方改写不影响原状态)。 */
export function listSessions(state: AgentSessionState): AgentSession[] {
  return state.sessions
    .map((s) => ({ ...s, messages: [...s.messages] }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 新建会话(空,activeId 指向新会话);超 cap 丢最旧(updatedAt 最小,平局丢最先生成的)。 */
export function createSession(
  state: AgentSessionState,
  opts: { id?: string; now?: number } = {},
): AgentSessionState {
  const id = opts.id ?? createSessionId();
  const session: AgentSession = { id, title: DEFAULT_SESSION_TITLE, messages: [], updatedAt: opts.now ?? Date.now() };
  const sessions = [session, ...state.sessions];
  if (sessions.length > SESSIONS_CAP) {
    // 从不丢新会话(下标 0 恒跳过);updatedAt 最小为最旧,平局丢数组靠后的
    // (数组 = 新→旧创建序,靠后 = 更早创建)
    let oldestIdx = 1;
    for (let i = 1; i < sessions.length; i++) {
      const cur = sessions[i];
      const oldest = sessions[oldestIdx];
      if (cur.updatedAt < oldest.updatedAt || (cur.updatedAt === oldest.updatedAt && i > oldestIdx)) {
        oldestIdx = i;
      }
    }
    sessions.splice(oldestIdx, 1);
  }
  return { sessions, activeId: id };
}

/** 切换会话:未知 id → 原状态不动。 */
export function switchSession(state: AgentSessionState, id: string): AgentSessionState {
  if (!state.sessions.some((s) => s.id === id) || state.activeId === id) return state;
  return { ...state, activeId: id };
}

/**
 * 删除会话:未知 id → 原状态不动;删非当前 → 仅移除;
 * 删当前 → 切到最近(updatedAt 最大,平局取列表先出现的);全删 → 新建空会话。
 */
export function deleteSession(
  state: AgentSessionState,
  id: string,
  opts: { id?: string; now?: number } = {},
): AgentSessionState {
  const target = state.sessions.find((s) => s.id === id);
  if (!target) return state;
  const sessions = state.sessions.filter((s) => s.id !== id);
  if (state.activeId !== id) return { ...state, sessions };
  if (sessions.length === 0) {
    const fresh: AgentSession = {
      id: opts.id ?? createSessionId(),
      title: DEFAULT_SESSION_TITLE,
      messages: [],
      updatedAt: opts.now ?? Date.now(),
    };
    return { sessions: [fresh], activeId: fresh.id };
  }
  const next = sessions.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
  return { sessions, activeId: next.id };
}

/** 追加一条消息:更新标题 + updatedAt;超 cap 丢最旧(队首)。未知会话 → 原状态不动。 */
export function appendMessage(
  state: AgentSessionState,
  id: string,
  message: AgentMessage,
  opts: { now?: number } = {},
): AgentSessionState {
  if (!isValidMessage(message)) return state;
  const idx = state.sessions.findIndex((s) => s.id === id);
  if (idx === -1) return state;
  const sessions = [...state.sessions];
  const cur = sessions[idx];
  const messages = [...cur.messages, normalizeMessage(message)].slice(-SESSION_MESSAGES_CAP);
  sessions[idx] = { ...cur, messages, title: deriveTitle(messages), updatedAt: opts.now ?? Date.now() };
  return { ...state, sessions };
}

/** 整份替换某会话消息(流结束快照 / 清屏);更新标题 + updatedAt;未知会话 → 原状态不动。 */
export function saveMessages(
  state: AgentSessionState,
  id: string,
  messages: AgentMessage[],
  opts: { now?: number } = {},
): AgentSessionState {
  const idx = state.sessions.findIndex((s) => s.id === id);
  if (idx === -1) return state;
  const sessions = [...state.sessions];
  const cur = sessions[idx];
  const normalized = messages.filter(isValidMessage).map(normalizeMessage).slice(-SESSION_MESSAGES_CAP);
  sessions[idx] = { ...cur, messages: normalized, title: deriveTitle(normalized), updatedAt: opts.now ?? Date.now() };
  return { ...state, sessions };
}

/**
 * 清屏(ws-clearfix):归档当前会话 → 新建空会话并激活。
 * - activeId 存在且 messages 非空 → 该会话消息落库为历史:替换为传入消息
 *   (cap 30),**标题保留原样**(不清 title;无传入标题时派生兜底),updatedAt 刷新;
 * - 空会话(无消息)不产生空历史:会话条目不动;
 * - 未知/无 activeId → 无归档;
 * - 随后新建空会话(「新会话」)并置为 active,cap 裁剪照旧(归档+新建可能
 *   挤出最旧会话,但归档会话 updatedAt 已刷新,不会被丢)。
 */
export function archiveAndNew(
  state: AgentSessionState,
  opts: { activeId: string | null; messages: AgentMessage[]; title?: string; id?: string; now?: number },
): AgentSessionState {
  const now = opts.now ?? Date.now();
  const sessions = [...state.sessions];
  const idx = opts.activeId ? sessions.findIndex((s) => s.id === opts.activeId) : -1;
  if (idx !== -1) {
    const normalized = opts.messages.filter(isValidMessage).map(normalizeMessage).slice(-SESSION_MESSAGES_CAP);
    if (normalized.length > 0) {
      const customTitle = opts.title?.trim();
      sessions[idx] = {
        ...sessions[idx],
        messages: normalized,
        title: customTitle ? [...customTitle].slice(0, TITLE_MAX).join("") : deriveTitle(normalized),
        updatedAt: now,
      };
    }
    // 空消息 → 不归档(不产生空历史),会话条目保留原样
  }
  return createSession({ ...state, sessions }, { id: opts.id, now });
}

export function saveSessionState(storage: SessionStorageLike | null | undefined, state: AgentSessionState): void {
  if (!storage) return;
  try {
    storage.setItem(SESSIONS_KEY, JSON.stringify(state));
  } catch {
    // 容量/隐私模式等:忽略
  }
}

/**
 * 读会话状态(含迁移):
 * - v1 键存在且可解析 → 直接用(旧键保留不动);
 * - v1 缺失/损坏 → 读旧 sessionStorage `dm.agent-history.v1` 迁为第一个会话
 *   (保留原消息,cap 30),迁移后旧键清除;旧键为空/坏 → 空状态。
 */
export function loadSessionState(
  storage: SessionStorageLike | null | undefined,
  legacyStorage?: SessionStorageLike | null,
): AgentSessionState {
  if (!storage) return emptyState();
  let raw: string | null = null;
  try {
    raw = storage.getItem(SESSIONS_KEY);
  } catch {
    return emptyState();
  }
  const parsed = parseState(raw);
  if (parsed) return parsed;
  let legacyRaw: string | null = null;
  try {
    legacyRaw = legacyStorage?.getItem(LEGACY_HISTORY_KEY) ?? null;
  } catch {
    legacyRaw = null;
  }
  const legacy = parseLegacyHistory(legacyRaw);
  const now = Date.now();
  let state: AgentSessionState;
  if (legacy.length > 0) {
    const id = createSessionId();
    state = {
      sessions: [{ id, title: deriveTitle(legacy), messages: legacy, updatedAt: now }],
      activeId: id,
    };
  } else {
    state = emptyState();
  }
  saveSessionState(storage, state);
  if (legacyRaw !== null) {
    try {
      legacyStorage?.removeItem(LEGACY_HISTORY_KEY);
    } catch {
      // 忽略
    }
  }
  return state;
}

/**
 * 相对时间(纯函数):<1 分钟 → justNow;<1 小时 → minutes;<24 小时 → hours;
 * 更早 → 日期(month/day)。now 为注入基准(测试确定性)。
 */
export function relativeTime(updatedAt: number, now: number): SessionRelativeTime {
  const diff = Math.max(0, now - updatedAt);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return { kind: "justNow" };
  if (minutes < 60) return { kind: "minutes", n: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { kind: "hours", n: hours };
  const d = new Date(updatedAt);
  return { kind: "date", month: d.getMonth() + 1, day: d.getDate() };
}
