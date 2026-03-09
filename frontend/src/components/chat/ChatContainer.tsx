"use client";

import { useEffect, useCallback, useRef } from "react";
import { useChatStore } from "@/stores/chat-store-provider";
import { useAgentStore } from "@/stores/agent-store-provider";
import { useInsightStore } from "@/stores/insight-store-provider";
import { useSettingsStore } from "@/stores/settings-store-provider";
import { useTaskStore } from "@/stores/task-store-provider";
import type { Task, TaskColumn } from "@/stores/task-store";
import {
  useAgentWebSocket,
  type WebSocketMessage,
} from "@/hooks/useAgentWebSocket";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import type { Message, MessageStep } from "@/stores/chat-store";
import type { Insight } from "@/stores/insight-store";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export function ChatContainer() {
  const sessionId = useChatStore((s) => s.sessionId);
  const setSessionId = useChatStore((s) => s.setSessionId);
  const addMessage = useChatStore((s) => s.addMessage);
  const appendToMessage = useChatStore((s) => s.appendToMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const addStepToMessage = useChatStore((s) => s.addStepToMessage);
  const setConnected = useChatStore((s) => s.setConnected);
  const setStreaming = useChatStore((s) => s.setStreaming);
  const setError = useChatStore((s) => s.setError);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const setMessages = useChatStore((s) => s.setMessages);
  const setLoadingSession = useChatStore((s) => s.setLoadingSession);
  const setSessions = useChatStore((s) => s.setSessions);
  const addSession = useChatStore((s) => s.addSession);
  const updateSessionTitle = useChatStore((s) => s.updateSessionTitle);

  // Agent store state + actions
  const agents = useAgentStore((s) => s.agents);
  const addPendingPermission = useAgentStore((s) => s.addPendingPermission);
  const removePendingPermission = useAgentStore(
    (s) => s.removePendingPermission
  );
  const addActivityEvent = useAgentStore((s) => s.addActivityEvent);
  const setActivityEvents = useAgentStore((s) => s.setActivityEvents);
  const clearActivityEvents = useAgentStore((s) => s.clearActivityEvents);
  const setAgents = useAgentStore((s) => s.setAgents);
  const setTeams = useAgentStore((s) => s.setTeams);
  const setOrchestrator = useAgentStore((s) => s.setOrchestrator);
  const setAgentActive = useAgentStore((s) => s.setAgentActive);
  const clearActiveAgents = useAgentStore((s) => s.clearActiveAgents);

  // Settings store actions
  const setDebugEnabled = useSettingsStore((s) => s.setDebugEnabled);

  // Insight store actions
  const addInsight = useInsightStore((s) => s.addInsight);

  // Task store actions
  const addTaskToStore = useTaskStore((s) => s.addTask);
  const updateTaskInStore = useTaskStore((s) => s.updateTask);
  const removeTaskFromStore = useTaskStore((s) => s.removeTask);
  const addColumnToStore = useTaskStore((s) => s.addColumn);
  const updateColumnInStore = useTaskStore((s) => s.updateColumn);
  const removeColumnFromStore = useTaskStore((s) => s.removeColumn);

  // Track current streaming message id and the last agent message (for cost attachment)
  const streamingMsgId = useRef<string | null>(null);
  const lastAgentMsgId = useRef<string | null>(null);
  // Persists after result is processed so debug_prompts can still attach to it
  const lastFinishedMsgId = useRef<string | null>(null);

  // Keep a ref to the send function so permission handlers can use it
  const sendRef = useRef<(data: Record<string, unknown>) => void>(() => {});

  const handleMessage = useCallback(
    (msg: WebSocketMessage) => {
      switch (msg.type) {
        case "init": {
          const sid = msg.data.session_id as string | null;
          // For resumed sessions, set the ID immediately.
          // For new chats, session_id is null — deferred until first message.
          if (sid) setSessionId(sid);
          setLoadingSession(false);
          break;
        }

        case "session_created": {
          // Backend created the session on first user message — set real ID + add to sidebar
          const newSid = msg.data.session_id as string;
          const title = (msg.data.title as string) || "New Chat";
          const createdAt = (msg.data.created_at as string) || new Date().toISOString();
          setSessionId(newSid);
          addSession({
            id: newSid,
            title,
            messageCount: 1,
            lastMessagePreview: "",
            totalCost: 0,
            createdAt,
            updatedAt: createdAt,
          });
          break;
        }

        case "background_session_created": {
          // A scheduler or trigger created a session in the background — add to sidebar
          const bgSid = msg.data.session_id as string;
          const bgTitle = (msg.data.title as string) || "New Chat";
          const bgCreatedAt = (msg.data.created_at as string) || new Date().toISOString();
          addSession({
            id: bgSid,
            title: bgTitle,
            messageCount: 1,
            lastMessagePreview: "",
            totalCost: 0,
            createdAt: bgCreatedAt,
            updatedAt: bgCreatedAt,
          });
          break;
        }

        case "session_history": {
          // Batch load prior messages when resuming a session
          const historyMessages = msg.data.messages as Array<{
            id: string;
            session_id: string;
            role: string;
            agent_name?: string;
            content: string;
            cost_usd?: number;
            metadata?: Record<string, unknown>;
            created_at: string;
          }>;
          if (historyMessages && historyMessages.length > 0) {
            const formatted: Message[] = historyMessages.map((m) => {
              // Extract persisted steps from metadata
              const meta = m.metadata || {};
              const steps = (meta.steps as MessageStep[] | undefined) || undefined;
              return {
                id: m.id,
                sessionId: m.session_id,
                role: m.role as "user" | "clyde" | "agent",
                agentName: m.agent_name || (m.role === "user" ? undefined : "Clyde"),
                content: m.content,
                costUsd: m.cost_usd || 0,
                metadata: meta,
                createdAt: m.created_at,
                steps,
              };
            });
            setMessages(formatted);
          }
          setLoadingSession(false);
          break;
        }

        case "activity_history": {
          // Hydrate activity feed from persisted Supabase data on session resume
          const events = msg.data.events as Array<{
            id: string;
            agent_id: string;
            agent_name: string;
            event_type: string;
            description: string;
            metadata: Record<string, unknown>;
            created_at: string;
          }>;
          if (events && events.length > 0) {
            const formatted = events.map((e) => ({
              id: e.id,
              agentId: e.agent_id,
              agentName: e.agent_name,
              eventType: e.event_type as "started" | "stopped" | "tool_use" | "permission_request" | "created" | "error",
              description: e.description || "",
              timestamp: e.created_at,
              parentAgent: (e.metadata?.parent_agent as string) || undefined,
              isTeamMember: (e.metadata?.is_team_member as boolean) || false,
            }));
            // Reverse so newest first (matches store convention)
            setActivityEvents(formatted.reverse());
          }
          break;
        }

        case "session_title_update": {
          const titleSessionId = msg.data.session_id as string;
          const newTitle = msg.data.title as string;
          if (titleSessionId && newTitle) {
            updateSessionTitle(titleSessionId, newTitle);
          }
          break;
        }

        case "assistant_text": {
          if (msg.data.streaming) {
            // Token-level streaming
            if (!streamingMsgId.current) {
              // Create a new message bubble for this text block
              const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              streamingMsgId.current = id;
              lastAgentMsgId.current = id;
              setStreaming(true);
              addMessage({
                id,
                sessionId: "",
                role: "clyde",
                agentName: (msg.data.agent_name as string) || "Clyde",
                agentAvatar: msg.data.agent_avatar as string | undefined,
                content: msg.data.text as string,
                createdAt: new Date().toISOString(),
                isStreaming: true,
                metadata: {
                  model_tier: msg.data.model_tier || "opus",
                  agent_role: msg.data.agent_role,
                },
              });
            } else {
              appendToMessage(
                streamingMsgId.current,
                msg.data.text as string
              );
            }
          } else if (msg.data.final) {
            // Final complete text for this text block
            if (streamingMsgId.current) {
              // Finalize the streaming message
              updateMessage(streamingMsgId.current, {
                content: msg.data.text as string,
                isStreaming: false,
                agentName: (msg.data.agent_name as string) || "Clyde",
                agentAvatar: msg.data.agent_avatar as string | undefined,
                metadata: {
                  model_tier: msg.data.model_tier || "opus",
                  agent_role: msg.data.agent_role,
                },
              });
            } else {
              // No streaming preceded this — create a standalone message
              const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              lastAgentMsgId.current = id;
              addMessage({
                id,
                sessionId: "",
                role: "clyde",
                agentName: (msg.data.agent_name as string) || "Clyde",
                agentAvatar: msg.data.agent_avatar as string | undefined,
                content: msg.data.text as string,
                createdAt: new Date().toISOString(),
                isStreaming: false,
                metadata: {
                  model_tier: msg.data.model_tier || "opus",
                  agent_role: msg.data.agent_role,
                },
              });
            }
            // Reset so the next text block creates a new message bubble
            streamingMsgId.current = null;
          }
          break;
        }

        case "tool_use": {
          {
            const stepTarget = streamingMsgId.current || lastAgentMsgId.current;
            if (stepTarget) {
              const toolName = msg.data.tool as string;
              const toolInput = msg.data.input as string | undefined;
              addStepToMessage(stepTarget, {
                type: "tool_use",
                label: toolName,
                detail: toolInput ? toolInput.slice(0, 200) : undefined,
                timestamp: new Date().toISOString(),
              });
            }
          }
          break;
        }

        case "result": {
          // Attach cost to the last agent message in this turn
          const costTarget = streamingMsgId.current || lastAgentMsgId.current;
          if (costTarget) {
            updateMessage(costTarget, {
              isStreaming: false,
              costUsd: (msg.data.total_cost_usd as number) || 0,
            });
          }
          // Preserve for debug_prompts which arrives after result
          lastFinishedMsgId.current = costTarget;
          streamingMsgId.current = null;
          lastAgentMsgId.current = null;
          setStreaming(false);
          // Notify TopBar to refresh the daily cost
          window.dispatchEvent(new Event("cost-updated"));
          break;
        }

        case "error": {
          setError(msg.data.message as string);
          streamingMsgId.current = null;
          lastAgentMsgId.current = null;
          setStreaming(false);
          setLoadingSession(false);
          break;
        }

        // --- Phase 2: Permission + Activity ---

        case "permission_request": {
          addPendingPermission({
            id: msg.data.id as string,
            toolName: msg.data.tool_name as string,
            toolInput: (msg.data.tool_input as Record<string, string>) || {},
            agentName: (msg.data.agent_name as string) || "Clyde",
            modelTier: (msg.data.model_tier as "opus" | "sonnet" | "haiku") || "opus",
            timestamp: new Date().toISOString(),
          });
          break;
        }

        case "permission_timeout": {
          removePendingPermission(msg.data.id as string);
          break;
        }

        case "agent_activity": {
          const eventType = msg.data.event as string;
          const agentId = msg.data.agent_id as string;
          const agentType = msg.data.agent_type as string;
          const parentAgent = (msg.data.parent_agent as string) || undefined;
          const isTeamMember = (msg.data.is_team_member as boolean) || false;

          // Use registry data sent by backend (accurate source of truth)
          const regName = (msg.data.name as string) || agentType || agentId;
          const regModel = msg.data.model as string | undefined;
          const regAvatar = msg.data.avatar as string | undefined;
          const regRegistryId = (msg.data.registry_id as string) || agentId;

          addActivityEvent({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            agentId: regRegistryId,
            agentName: regName,
            eventType: eventType as "started" | "stopped",
            description: isTeamMember
              ? `Team member ${eventType}`
              : `Agent ${eventType}`,
            timestamp: new Date().toISOString(),
            parentAgent,
            isTeamMember,
          });

          // Track as a step on the current or last agent message
          {
            const stepTarget = streamingMsgId.current || lastAgentMsgId.current;
            if (stepTarget) {
              addStepToMessage(stepTarget, {
                type: eventType === "started" ? "agent_started" : "agent_stopped",
                label: regName,
                detail: isTeamMember ? "Team member" : "Subagent",
                timestamp: new Date().toISOString(),
              });
            }
          }

          // Update active agent tracking — use registry data from backend
          if (eventType === "started") {
            setAgentActive(regRegistryId, true, {
              name: regName,
              model: regModel as "opus" | "sonnet" | "haiku" | undefined,
              avatar: regAvatar,
              role: (msg.data.role as string) || (isTeamMember ? "Team member" : "Subagent"),
            });
          } else if (eventType === "stopped") {
            setAgentActive(regRegistryId, false);
          }
          break;
        }

        case "registry_update": {
          // Refresh agent list from the WebSocket data directly
          const agents = msg.data.agents as Array<{
            id: string;
            name: string;
            role: string;
            model: "opus" | "sonnet" | "haiku";
            avatar: string;
            status: "active" | "paused" | "archived";
            tools: string[];
            skills: string[];
            team?: string;
          }>;
          if (agents) {
            setAgents(
              agents.map((a) => ({
                registryId: a.id,
                name: a.name,
                role: a.role,
                model: a.model || "sonnet",
                avatar: a.avatar || "",
                status: a.status || "active",
                tools: a.tools || [],
                skills: a.skills || [],
                team: a.team || null,
              }))
            );
          }

          // Refresh teams
          const teams = msg.data.teams as Array<{
            id: string;
            name: string;
            color: string;
            created_at?: string;
          }>;
          if (teams) {
            setTeams(
              teams.map((t) => ({
                id: t.id,
                name: t.name,
                color: t.color,
                created_at: t.created_at || "",
              }))
            );
          }

          // Refresh orchestrator
          const orch = msg.data.orchestrator as {
            id: string;
            name: string;
            role: string;
            model: string;
            avatar?: string;
            status?: string;
          } | undefined;
          if (orch && orch.id) {
            setOrchestrator({
              registryId: orch.id,
              name: orch.name || "Clyde",
              role: orch.role || "CEO",
              model: (orch.model as "opus" | "sonnet" | "haiku") || "opus",
              avatar: orch.avatar || "",
              status: (orch.status as "active" | "paused" | "archived") || "active",
              tools: [],
              skills: [],
              team: null,
            });
          }
          break;
        }

        case "agent_notification": {
          // Could display as a toast — for now, add to activity feed
          addActivityEvent({
            id: `notif-${Date.now()}`,
            agentId: "system",
            agentName: "System",
            eventType: "started",
            description: msg.data.message as string,
            timestamp: new Date().toISOString(),
          });
          break;
        }

        // --- Phase 6: Proactive Insights ---

        case "proactive_insight": {
          const raw = msg.data;
          const insight: Insight = {
            id: raw.id as string,
            insightType: raw.insight_type as Insight["insightType"],
            title: raw.title as string,
            description: raw.description as string,
            severity: raw.severity as Insight["severity"],
            data: (raw.data as Record<string, unknown>) || {},
            status: (raw.status as Insight["status"]) || "pending",
            snoozedUntil: raw.snoozed_until as string | undefined,
            createdAt: raw.created_at as string || new Date().toISOString(),
          };
          addInsight(insight);
          break;
        }

        // --- Task Board real-time events ---

        case "task_created": {
          addTaskToStore(msg.data as Task);
          break;
        }

        case "task_updated": {
          const t = msg.data as Task;
          updateTaskInStore(t.id, t);
          break;
        }

        case "task_deleted": {
          removeTaskFromStore(msg.data.id as string);
          break;
        }

        case "task_column_created": {
          addColumnToStore(msg.data as TaskColumn);
          break;
        }

        case "task_column_updated": {
          const c = msg.data as TaskColumn;
          updateColumnInStore(c.id, c);
          break;
        }

        case "task_column_deleted": {
          removeColumnFromStore(msg.data.id as string);
          break;
        }

        case "debug_prompts": {
          // Attach debug prompt data to the last finished agent message
          const debugTarget = lastFinishedMsgId.current;
          if (debugTarget) {
            updateMessage(debugTarget, {
              debugPrompts: {
                systemPrompt: msg.data.system_prompt as string,
                userMessage: msg.data.user_message as string,
              },
            });
          }
          break;
        }
      }
    },
    [
      setSessionId,
      addMessage,
      addSession,
      appendToMessage,
      updateMessage,
      addStepToMessage,
      setStreaming,
      setError,
      setMessages,
      setLoadingSession,
      updateSessionTitle,
      addPendingPermission,
      removePendingPermission,
      addActivityEvent,
      setAgents,
      setTeams,
      setAgentActive,
      addInsight,
      addTaskToStore,
      updateTaskInStore,
      removeTaskFromStore,
      addColumnToStore,
      updateColumnInStore,
      removeColumnFromStore,
    ]
  );

  const handleConnect = useCallback(() => {
    setConnected(true);
    setError(null);
  }, [setConnected, setError]);

  const handleDisconnect = useCallback(() => {
    setConnected(false);
  }, [setConnected]);

  const { connect, send, disconnect } = useAgentWebSocket(
    handleMessage,
    handleConnect,
    handleDisconnect
  );

  // Keep send ref updated
  sendRef.current = send;

  // Fetch sessions + agents on mount
  useEffect(() => {
    async function fetchSessions() {
      try {
        const res = await fetch(`${API_URL}/api/sessions`);
        const data = await res.json();
        if (data.sessions) {
          setSessions(
            data.sessions.map(
              (s: {
                id: string;
                title: string;
                message_count: number;
                last_message_preview: string;
                total_cost: number;
                created_at: string;
                updated_at: string;
              }) => ({
                id: s.id,
                title: s.title,
                messageCount: s.message_count || 0,
                lastMessagePreview: s.last_message_preview || "",
                totalCost: s.total_cost || 0,
                createdAt: s.created_at,
                updatedAt: s.updated_at,
              })
            )
          );
        }
      } catch (err) {
        console.error("Failed to fetch sessions:", err);
      }
    }

    async function fetchAgents() {
      try {
        const res = await fetch(`${API_URL}/api/agents`);
        if (res.ok) {
          const data = await res.json();
          const agents = (data.agents || []).map(
            (a: {
              id: string;
              name: string;
              role: string;
              model: string;
              avatar?: string;
              status: string;
              tools?: string[];
              skills?: string[];
              team?: string;
            }) => ({
              registryId: a.id,
              name: a.name,
              role: a.role,
              model: a.model || "sonnet",
              avatar: a.avatar || "",
              status: a.status || "active",
              tools: a.tools || [],
              skills: a.skills || [],
              team: a.team || null,
            })
          );
          setAgents(agents);

          // Populate orchestrator (Clyde) in the store
          const orch = data.orchestrator;
          if (orch && orch.id) {
            setOrchestrator({
              registryId: orch.id,
              name: orch.name || "Clyde",
              role: orch.role || "CEO",
              model: orch.model || "opus",
              avatar: orch.avatar || "",
              status: orch.status || "active",
              tools: orch.tools || [],
              skills: orch.skills || [],
              team: null,
            });
          }

          // Populate teams
          const teamsData = (data.teams || []).map(
            (t: { id: string; name: string; color: string; created_at?: string }) => ({
              id: t.id,
              name: t.name,
              color: t.color,
              created_at: t.created_at || "",
            })
          );
          setTeams(teamsData);
        }
      } catch (err) {
        console.error("Failed to fetch agents:", err);
      }
    }

    async function fetchDebugSetting() {
      try {
        const res = await fetch(`${API_URL}/api/registry/settings`);
        const data = await res.json();
        setDebugEnabled(!!data.debug_mode_enabled);
      } catch {
        // ignore
      }
    }

    fetchSessions();
    fetchAgents();
    fetchDebugSetting();
  }, [setSessions, setAgents, setTeams, setOrchestrator, setDebugEnabled]);

  // Connect to WebSocket on mount (new session) — runs once
  useEffect(() => {
    connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for session-switch events from Sidebar
  useEffect(() => {
    const handleSwitch = (e: Event) => {
      const { sessionId: targetId } = (e as CustomEvent).detail;
      setLoadingSession(true);
      clearMessages();
      clearActivityEvents();
      streamingMsgId.current = null;
      lastAgentMsgId.current = null;
      disconnect();
      connect(targetId || undefined);
    };

    const handleNewChat = () => {
      setLoadingSession(true);
      clearMessages();
      clearActivityEvents();
      streamingMsgId.current = null;
      lastAgentMsgId.current = null;
      disconnect();
      connect(); // no sessionId = new session
    };

    window.addEventListener("session-switch", handleSwitch);
    window.addEventListener("new-chat", handleNewChat);
    return () => {
      window.removeEventListener("session-switch", handleSwitch);
      window.removeEventListener("new-chat", handleNewChat);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- clearActivityEvents is a stable Zustand action
  }, [connect, disconnect, clearMessages, setLoadingSession]);

  // Listen for permission-response events from AppShell/PermissionStack
  useEffect(() => {
    const handlePermEvent = (e: Event) => {
      const { id, decision } = (e as CustomEvent).detail;
      sendRef.current({ type: "permission_response", id, decision });
    };
    window.addEventListener("permission-response", handlePermEvent);
    return () =>
      window.removeEventListener("permission-response", handlePermEvent);
  }, []);

  // Listen for cancel-request events from ActiveAgentOverlay kill button
  // Uses sendRef (stable ref) to avoid dependency on handleCancel declaration order
  useEffect(() => {
    const handleCancelEvent = () => {
      sendRef.current({ type: "cancel_request" });
      if (streamingMsgId.current) {
        updateMessage(streamingMsgId.current, { isStreaming: false });
        appendToMessage(streamingMsgId.current, "\n\n_[Cancelled by user]_");
      }
      streamingMsgId.current = null;
      setStreaming(false);
      clearActiveAgents();
    };
    window.addEventListener("cancel-request", handleCancelEvent);
    return () =>
      window.removeEventListener("cancel-request", handleCancelEvent);
  }, [updateMessage, appendToMessage, setStreaming, clearActiveAgents]);

  // Listen for insight-action events from InsightsDashboard
  useEffect(() => {
    const handleInsightAction = (e: Event) => {
      const { action, insight } = (e as CustomEvent).detail;
      // Status PATCH is already handled by InsightsDashboard — just route
      if (action === "act" && insight) {
        _routeInsightAction(insight);
      }
    };
    window.addEventListener("insight-action", handleInsightAction);
    return () =>
      window.removeEventListener("insight-action", handleInsightAction);
  }, []);

  // Route insight actions: switch to chat, start new session, auto-send the message
  function _routeInsightAction(insight: Insight) {
    const data = insight.data || {};

    // Build the message content based on insight type
    let content = "";
    switch (insight.insightType) {
      case "agent_suggestion":
      case "usage_pattern": {
        const pattern = data.pattern as string || "this type of work";
        content = `Create a dedicated specialist agent for "${pattern}"`;
        break;
      }
      case "agent_archival": {
        const agentName = data.agent_name as string || "this agent";
        content = `Archive ${agentName} — they haven't been used recently`;
        break;
      }
      case "performance_trend": {
        const trend = data.trend as string;
        if (trend === "negative") {
          const name = data.agent_name as string || "the agent";
          content = `Review and improve ${name}'s system prompt — their performance has been declining`;
        } else {
          // Positive trend — just switch to performance view, no action needed
          window.dispatchEvent(
            new CustomEvent("switch-view", { detail: { view: "performance" } })
          );
          return;
        }
        break;
      }
      case "workflow_optimisation": {
        content = insight.description;
        break;
      }
    }

    if (!content) return;

    // 1. Switch to chat view so the user sees the conversation
    window.dispatchEvent(
      new CustomEvent("switch-view", { detail: { view: "chat" } })
    );

    // 2. Start a new chat session
    window.dispatchEvent(new CustomEvent("new-chat"));

    // 3. After a short delay (WebSocket needs to connect), auto-send the message
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("auto-send-message", { detail: { content } })
      );
    }, 800);
  }

  const handleSend = useCallback(
    (content: string, fileRefs?: string[], folderContext?: string, tasksEnabled?: boolean) => {
      // Add user message to store immediately (optimistic)
      addMessage({
        id: `user-${Date.now()}`,
        sessionId: "",
        role: "user",
        content,
        createdAt: new Date().toISOString(),
        metadata: {
          ...(fileRefs && fileRefs.length > 0 ? { file_refs: fileRefs } : {}),
          ...(folderContext !== undefined ? { folder_context: folderContext } : {}),
        },
      });

      // Mark as streaming so the thinking indicator shows immediately
      setStreaming(true);

      // Send to backend — include file_refs, folder_context, and tasks_enabled if present
      send({
        type: "user_message",
        content,
        ...(fileRefs && fileRefs.length > 0 ? { file_refs: fileRefs } : {}),
        ...(folderContext !== undefined ? { folder_context: folderContext } : {}),
        ...(tasksEnabled ? { tasks_enabled: true } : {}),
      });
    },
    [addMessage, setStreaming, send]
  );

  const handleCancel = useCallback(() => {
    // Send cancel signal to backend
    send({ type: "cancel_request" });

    // Immediately reset streaming state on frontend
    if (streamingMsgId.current) {
      updateMessage(streamingMsgId.current, { isStreaming: false });
      appendToMessage(streamingMsgId.current, "\n\n_[Cancelled by user]_");
    }
    streamingMsgId.current = null;
    setStreaming(false);
  }, [send, updateMessage, appendToMessage, setStreaming]);

  // Permission response handler — exposed via context or prop drilling
  const handlePermissionResponse = useCallback(
    (id: string, decision: string) => {
      sendRef.current({ type: "permission_response", id, decision });
      removePendingPermission(id);
    },
    [removePendingPermission]
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <MessageList />
      <ChatInput onSend={handleSend} onCancel={handleCancel} />
    </div>
  );
}

// Export the permission response handler type for use by PermissionStack
export type PermissionResponseHandler = (
  id: string,
  decision: string
) => void;
