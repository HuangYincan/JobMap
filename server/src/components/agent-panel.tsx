"use client";

// AI Agent 聊天面板:360px × 70vh liquid glass 卡片浮层,**以悬浮球为锚实时跟随**
// (transform 驱动,computePanelPlacement 纯函数;拖动球时同步移动,松手平滑归位)。
// 移动端(≤767px)与极窄视口 → 全宽底部 sheet(参照 mobileDrawer 动效)。
// - 消息列表(用户纯文本 / 助手 MarkdownText 渲染,助手侧可含建议卡片)+ 输入框 +
//   发送/停止/撤销;
// - 思考过程:reasoning 事件累积,每条助手消息内可折叠「💭 思考过程」(默认展开,
//   muted 小字,滚动上限);
// - 工具活动列表:每条 tool 事件(⟳ 开始 / ✓ 完成 / ✗ 失败 + 友好工具名 + summary),
//   渲染在助手消息上方;运行中工具另有顶部状态条;
// - 未配置提示:503 LLM_UNCONFIGURED → agentNotConfigured;
// - 建议卡片:执行器捕获 action 时渲染动作摘要按钮,点击 = 重放该 action;
// - 历史:sessionStorage 'dm.agent-history.v1' cap 30 条;新会话首条自动带视口快照;
// - 「停止」→ abort(链到 fetch);「撤销」→ executor.undo()。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import styles from "./agent-panel.module.css";
import { t, type Language } from "@/lib/i18n";
import type { AgentAction, AgentEvent } from "@/lib/agent/types";
import type { MapBridge } from "@/lib/agent-map-bridge";
import { streamAgentChat, type AgentChatRequest } from "./agent-chat-client";
import {
  createAgentMapExecutor,
  type AgentMapExecutor,
  type AgentMapExecutorCallbacks,
  type AgentToolInfo,
} from "./agent-map-executor";
import { computePanelPlacement, type BallRect, type BallSnapEdge, type ViewportSize } from "@/lib/agent-panel-placement";
import { MarkdownText } from "./markdown-text";

export interface ToolActivity {
  name: string;
  status: "start" | "done" | "error";
  summary?: string;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  actions?: AgentAction[];
  /** 思考过程(reasoning 事件流式累积;服务端已截断 4000 字符)。 */
  reasoning?: string;
  /** 工具活动列表(tool 事件;⟳ 开始 / ✓ 完成 / ✗ 失败)。 */
  tools?: ToolActivity[];
}

const HISTORY_KEY = "dm.agent-history.v1";
const HISTORY_CAP = 30;

interface Props {
  bridge: MapBridge | null;
  lang: Language;
  /** 悬浮球当前矩形(viewport 坐标);面板以此为锚实时跟随。 */
  ballRect: BallRect;
  /** 球正在拖拽:面板关闭吸附过渡,transform 跟手。 */
  dragging: boolean;
  /** 球当前吸附边缘(拖拽中/未吸附为 null → 面板按球心半区分侧,旧行为)。 */
  snapEdge: BallSnapEdge | null;
  onClose: () => void;
}

function readHistory(): AgentMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is AgentMessage =>
          !!m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string",
      )
      .slice(-HISTORY_CAP)
      .map((m) => ({
        role: m.role,
        content: m.content,
        ...(Array.isArray(m.actions) ? { actions: m.actions } : {}),
      }));
  } catch {
    return [];
  }
}

function saveHistory(msgs: AgentMessage[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify(msgs.slice(-HISTORY_CAP)));
  } catch {
    // 容量/隐私模式等:忽略
  }
}

function actionLabel(action: AgentAction, lang: Language): string {
  switch (action.type) {
    case "flyTo":
      return t("agentLocate", lang);
    case "drawCircle":
      return t("agentActionCircle", lang);
    case "addMarkers":
      return t("agentActionMarkers", lang).replace("{count}", String(action.payload.points.length));
    case "select":
      return t("agentActionSelect", lang);
    case "openDetail":
      return t("agentActionDetail", lang);
    case "search":
      return t("agentActionSearch", lang).replace("{query}", action.payload.query);
  }
}

/** 工具类别(公开 SSE tool 事件 name 字段)→ i18n 文案;未知类别 → 「其他操作」。 */
function toolCategoryName(name: string, lang: Language): string {
  switch (name) {
    case "search":
      return t("agentToolSearch", lang);
    case "geocode":
      return t("agentToolGeocode", lang);
    case "directions":
      return t("agentToolDirections", lang);
    case "weather":
      return t("agentToolWeather", lang);
    case "project":
      return t("agentToolProject", lang);
    default:
      return t("agentToolOther", lang);
  }
}

export function AgentPanel({ bridge, lang, ballRect, dragging, snapEdge, onClose }: Props) {
  const [messages, setMessages] = useState<AgentMessage[]>(readHistory);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [tool, setTool] = useState<AgentToolInfo | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  // undo 可用性重渲染信号(执行器实例在 ref 中,栈变化不触发渲染)
  const [, setUndoVersion] = useState(0);
  // 折叠的思考过程(按消息下标;默认展开)
  const [collapsedThinking, setCollapsedThinking] = useState<number[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const langRef = useRef(lang);
  langRef.current = lang;

  // ---- 面板跟随:视口 + 实测尺寸 → 锚定位置(transform)----
  const [viewport, setViewport] = useState<ViewportSize>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // 初始尺寸用 CSS 规格(360 × 70vh)估算,layout effect 实测后校正——避免
  // 首帧 placement 用 (360, 0) 导致的高度回弹
  const [panelSize, setPanelSize] = useState({ width: 360, height: Math.round((typeof window !== "undefined" ? window.innerHeight : 0) * 0.7) });
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    setPanelSize({ width: el.offsetWidth, height: el.offsetHeight });
  }, [viewport]); // 视口变化(70vh 高度随之变)→ 重测

  const placement = useMemo(
    () => computePanelPlacement(ballRect, panelSize, viewport, snapEdge ?? undefined),
    [ballRect, panelSize, viewport, snapEdge],
  );
  const isSheet = placement.mode === "sheet";
  // side 模式:transform 锚定(--px/--py 供 CSS translate3d 与入场动画共用)
  const panelStyle: CSSProperties | undefined = isSheet
    ? undefined
    : ({ "--px": `${placement.left}px`, "--py": `${placement.top}px` } as CSSProperties);

  // ---- 渲染回调(供执行器分流;bridge 缺失时面板直接渲染无地图事件)----
  const handleDelta = useCallback((text: string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant") {
        const copy = [...prev];
        copy[copy.length - 1] = { ...last, content: last.content + text };
        return copy;
      }
      return [...prev, { role: "assistant", content: text }];
    });
  }, []);

  const handleReasoning = useCallback((text: string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant") {
        const copy = [...prev];
        copy[copy.length - 1] = { ...last, reasoning: (last.reasoning ?? "") + text };
        return copy;
      }
      return [...prev, { role: "assistant", content: "", reasoning: text }];
    });
  }, []);

  const handleTool = useCallback((info: AgentToolInfo) => {
    // 顶部状态条:只反映运行中的工具
    setTool(info.status === "start" ? info : null);
    // 活动列表:累积到当前助手消息(无助手消息则新建)
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== "assistant") {
        return [...prev, { role: "assistant", content: "", tools: [info] }];
      }
      const copy = [...prev];
      const tools = last.tools ? [...last.tools] : [];
      const idx = tools.findIndex((x) => x.name === info.name && x.status === "start");
      if (idx !== -1) {
        tools[idx] = { ...tools[idx], ...info }; // start → done/error 原位更新
      } else {
        tools.push(info);
      }
      copy[copy.length - 1] = { ...last, tools };
      return copy;
    });
  }, []);

  const handleDone = useCallback(() => {
    setTool(null);
    setMessages((prev) => {
      saveHistory(prev);
      return prev;
    });
  }, []);

  const handleError = useCallback((code: string) => {
    setTool(null);
    if (code === "LLM_UNCONFIGURED") setNotConfigured(true);
    else if (code === "RATE_LIMITED") setFatalError(t("agentRateLimited", langRef.current));
    else setFatalError(t("agentError", langRef.current));
  }, []);

  const handleAction = useCallback((action: AgentAction) => {
    // 动作已执行:在消息底部渲染「重放」建议卡片
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant") {
        const copy = [...prev];
        copy[copy.length - 1] = { ...last, actions: [...(last.actions ?? []), action] };
        return copy;
      }
      return [...prev, { role: "assistant", content: "", actions: [action] }];
    });
    setUndoVersion((v) => v + 1);
  }, []);

  // ---- 执行器实例:bridge 可用时惰性创建,bridge 实例变更时重建 ----
  const bridgeRef = useRef<MapBridge | null>(null);
  const executorRef = useRef<AgentMapExecutor | null>(null);
  if (bridgeRef.current !== bridge) {
    bridgeRef.current = bridge;
    executorRef.current = bridge
      ? createAgentMapExecutor(
          bridge,
          {
            onDelta: handleDelta,
            onReasoning: handleReasoning,
            onTool: handleTool,
            onDone: handleDone,
            onError: handleError,
            onAction: handleAction,
          } satisfies AgentMapExecutorCallbacks,
        )
      : null;
  }

  /** 统一事件入口:有执行器走执行器(动作落地地图),否则只渲染无地图事件 */
  const dispatchEvent = useCallback(
    (ev: AgentEvent) => {
      const ex = executorRef.current;
      if (ex) {
        ex.handleEvent(ev);
        return;
      }
      switch (ev.type) {
        case "delta":
          handleDelta(ev.text);
          break;
        case "reasoning":
          handleReasoning(ev.text);
          break;
        case "tool":
          handleTool(ev);
          break;
        case "done":
          handleDone();
          break;
        case "error":
          handleError(ev.code);
          break;
        case "action":
          break; // 无地图桥接:不执行动作
      }
    },
    [handleDelta, handleReasoning, handleTool, handleDone, handleError],
  );

  const runStream = useCallback(
    async (req: AgentChatRequest) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      try {
        for await (const ev of streamAgentChat(req, controller.signal)) {
          dispatchEvent(ev);
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          setFatalError(t("agentError", langRef.current));
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
        setTool(null);
        setMessages((prev) => {
          saveHistory(prev);
          return prev;
        });
      }
    },
    [dispatchEvent],
  );

  const send = useCallback(
    (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || streaming) return;
      const isFirst = messages.length === 0;
      const userMsg: AgentMessage = { role: "user", content };
      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setInput("");
      setNotConfigured(false);
      setFatalError(null);
      setTool(null);
      setCollapsedThinking([]);
      saveHistory(nextMessages); // 刷新/中断时保留本条用户消息
      // 新会话首条自动带视口快照(bridge.getSnapshot() → viewport 参数)
      const snapshot = bridgeRef.current?.getSnapshot() ?? null;
      const req: AgentChatRequest = {
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        ...(isFirst && snapshot ? { viewport: { center: snapshot.center, zoom: snapshot.zoom } } : {}),
        lang: langRef.current,
      };
      void runStream(req);
    },
    [input, streaming, messages, runStream],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const undo = useCallback(() => {
    if (executorRef.current?.undo()) setUndoVersion((v) => v + 1);
  }, []);

  const replayAction = useCallback((action: AgentAction) => {
    // 纯执行语义:只在地图上重放动作,不再回调 onAction(否则按钮翻倍 + 地图反复定位)
    executorRef.current?.execute(action);
  }, []);

  const toggleThinking = useCallback((idx: number) => {
    setCollapsedThinking((prev) => (prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx]));
  }, []);

  // 消息/状态变化 → 滚动到底部
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, tool, streaming]);

  const canUndo = Boolean(executorRef.current?.canUndo());
  const lastIsAssistant = messages[messages.length - 1]?.role === "assistant";

  return (
    <section
      ref={panelRef}
      className={`${styles.panel} ${isSheet ? styles.panelSheet : ""} ${dragging ? styles.panelDragging : ""}`}
      style={panelStyle}
      aria-label={t("agentTitle", lang)}
    >
      <header className={styles.header}>
        <span className={styles.titleIcon} aria-hidden="true">
          ✦
        </span>
        <strong className={styles.title}>{t("agentTitle", lang)}</strong>
        <button type="button" className={styles.close} onClick={onClose} aria-label={t("agentClose", lang)}>
          ✕
        </button>
      </header>

      {tool && (
        <div className={styles.toolBar} role="status">
          <span className={styles.toolDot} aria-hidden="true" />
          {t("agentToolRunning", lang).replace("{name}", toolCategoryName(tool.name, lang))}
        </div>
      )}

      <div ref={listRef} className={styles.list}>
        {messages.length === 0 && !streaming && <p className={styles.welcome}>{t("agentWelcome", lang)}</p>}
        {messages.map((m, i) => {
          const isCollapsed = collapsedThinking.includes(i);
          return (
            <div key={i} className={`${styles.msg} ${m.role === "user" ? styles.msgUser : styles.msgAssistant}`}>
              {m.role === "assistant" && m.reasoning && (
                <div className={styles.thinking}>
                  <button
                    type="button"
                    className={styles.thinkingToggle}
                    onClick={() => toggleThinking(i)}
                    aria-expanded={!isCollapsed}
                  >
                    <span aria-hidden="true">
                      💭 {t("agentThinkingSection", lang)}
                    </span>
                    <span className={styles.thinkingChevron} aria-hidden="true">
                      {isCollapsed ? "▸" : "▾"}
                    </span>
                  </button>
                  {!isCollapsed && <div className={styles.thinkingBody}>{m.reasoning}</div>}
                </div>
              )}
              {m.role === "assistant" && m.tools && m.tools.length > 0 && (
                <ul className={styles.toolActivity} aria-label={t("agentToolsSection", lang)}>
                  {m.tools.map((toolItem, j) => (
                    <li key={j} className={`${styles.toolRow} ${toolItem.status === "error" ? styles.toolRowError : ""}`}>
                      <span className={styles.toolStatus} aria-hidden="true">
                        {toolItem.status === "start" ? "⟳" : toolItem.status === "done" ? "✓" : "✗"}
                      </span>
                      <span className={styles.toolName}>{toolCategoryName(toolItem.name, lang)}</span>
                      {toolItem.status === "error" && (
                        <span className={styles.toolSummary}>{t("agentToolFailed", lang)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className={m.role === "user" ? styles.bubbleUser : styles.bubbleAssistant}>
                {m.role === "assistant" ? <MarkdownText text={m.content} /> : m.content}
              </div>
              {m.role === "assistant" && m.actions && m.actions.length > 0 && (
                <div className={styles.actions}>
                  {m.actions.map((a, j) => (
                    <button key={j} type="button" className={styles.actionBtn} onClick={() => replayAction(a)}>
                      {actionLabel(a, lang)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {streaming && !lastIsAssistant && (
          <div className={`${styles.msg} ${styles.msgAssistant}`}>
            <div className={`${styles.bubbleAssistant} ${styles.typing}`}>{t("agentThinking", lang)}</div>
          </div>
        )}
        {notConfigured && <p className={styles.notice}>{t("agentNotConfigured", lang)}</p>}
        {fatalError && <p className={styles.notice}>{fatalError}</p>}
      </div>

      <footer className={styles.footer}>
        <div className={styles.inputRow}>
          <input
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
            }}
            placeholder={t("agentInput", lang)}
            aria-label={t("agentInput", lang)}
            disabled={streaming}
          />
          <button
            type="button"
            className={styles.send}
            onClick={() => send()}
            disabled={!input.trim() || streaming}
            aria-label={t("agentSend", lang)}
          >
            {t("agentSend", lang)}
          </button>
        </div>
        <div className={styles.controls}>
          <button type="button" className={styles.controlBtn} onClick={stop} disabled={!streaming} aria-label={t("agentStop", lang)}>
            {t("agentStop", lang)}
          </button>
          <button type="button" className={styles.controlBtn} onClick={undo} disabled={!canUndo} aria-label={t("agentUndo", lang)}>
            {t("agentUndo", lang)}
          </button>
        </div>
      </footer>
    </section>
  );
}
