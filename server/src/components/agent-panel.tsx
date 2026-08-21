"use client";

// AI Agent 聊天面板:360px × 70vh liquid glass 卡片浮层,贴悬浮球吸附侧;
// 移动端(≤767px)变全宽底部 sheet(参照 mobileDrawer 动效)。
// - 消息列表(用户/助手气泡,助手侧可含建议卡片)+ 输入框 + 发送/停止/撤销;
// - tool 状态条(「{name} 正在执行…」,tool 事件驱动);
// - 未配置提示:503 LLM_UNCONFIGURED → agentNotConfigured;
// - 建议卡片:执行器捕获 action 时渲染动作摘要按钮,点击 = 重放该 action;
// - 历史:sessionStorage 'dm.agent-history.v1' cap 30 条;新会话首条自动带视口快照;
// - 「停止」→ abort(链到 fetch);「撤销」→ executor.undo()。

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./agent-panel.module.css";
import { t, type Language } from "@/lib/i18n";
import type { AgentAction, AgentEvent } from "@/lib/agent/types";
import type { MapBridge } from "@/lib/agent-map-bridge";
import { streamAgentChat, type AgentChatRequest } from "./agent-chat-client";
import { createAgentMapExecutor, type AgentMapExecutor, type AgentMapExecutorCallbacks, type AgentToolInfo } from "./agent-map-executor";

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  actions?: AgentAction[];
}

const HISTORY_KEY = "dm.agent-history.v1";
const HISTORY_CAP = 30;

interface Props {
  bridge: MapBridge | null;
  lang: Language;
  side: "left" | "right";
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

export function AgentPanel({ bridge, lang, side, onClose }: Props) {
  const [messages, setMessages] = useState<AgentMessage[]>(readHistory);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [tool, setTool] = useState<AgentToolInfo | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  // undo 可用性重渲染信号(执行器实例在 ref 中,栈变化不触发渲染)
  const [, setUndoVersion] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const langRef = useRef(lang);
  langRef.current = lang;

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

  const handleTool = useCallback((info: AgentToolInfo) => {
    setTool(info.status === "start" ? info : null);
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
    [handleDelta, handleTool, handleDone, handleError],
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
    executorRef.current?.handleEvent({ type: "action", action });
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
      className={`${styles.panel} ${side === "left" ? styles.panelLeft : styles.panelRight}`}
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
          {t("agentToolRunning", lang).replace("{name}", tool.name)}
        </div>
      )}

      <div ref={listRef} className={styles.list}>
        {messages.length === 0 && !streaming && <p className={styles.welcome}>{t("agentWelcome", lang)}</p>}
        {messages.map((m, i) => (
          <div key={i} className={`${styles.msg} ${m.role === "user" ? styles.msgUser : styles.msgAssistant}`}>
            <div className={m.role === "user" ? styles.bubbleUser : styles.bubbleAssistant}>{m.content}</div>
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
        ))}
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
