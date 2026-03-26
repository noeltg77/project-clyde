"use client";

import { useEffect, useRef, useCallback } from "react";

export type WebSocketMessage = {
  type:
    | "assistant_text"
    | "tool_use"
    | "tool_result"
    | "result"
    | "error"
    | "init"
    | "permission_request"
    | "permission_timeout"
    | "agent_activity"
    | "agent_notification"
    | "registry_update"
    | "session_history"
    | "session_title_update"
    | "session_created"
    | "background_session_created"
    | "proactive_insight"
    | "activity_history"
    | "cancel_confirmed"
    | "task_created"
    | "task_updated"
    | "task_deleted"
    | "task_column_created"
    | "task_column_updated"
    | "task_column_deleted"
    | "debug_prompts"
    | "visualization"
    | "visual";
  data: Record<string, unknown>;
};

/**
 * Single-connection WebSocket hook.
 *
 * Only ONE WebSocket connection is active at a time. Calling connect()
 * closes any previous connection before opening a new one. The backend
 * gracefully handles disconnection by continuing to process the response
 * and saving it to the database.
 */
export function useAgentWebSocket(
  onMessage: (msg: WebSocketMessage) => void,
  onConnect: () => void,
  onDisconnect: () => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const isMounted = useRef(true);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);

  // Store callbacks in refs so connect() never changes identity
  const onMessageRef = useRef(onMessage);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  onMessageRef.current = onMessage;
  onConnectRef.current = onConnect;
  onDisconnectRef.current = onDisconnect;

  // Track mounted state for Strict Mode resilience
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  /** Close the current connection cleanly. */
  const closeCurrentConnection = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }
    const ws = wsRef.current;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.close();
      wsRef.current = null;
    }
  }, []);

  /**
   * Open a new WebSocket connection, closing any existing one first.
   */
  const connect = useCallback((sessionId?: string) => {
    // Close previous connection — backend continues processing & saves to DB
    closeCurrentConnection();

    sessionIdRef.current = sessionId;

    const baseUrl =
      process.env.NEXT_PUBLIC_BACKEND_WS_URL || "ws://localhost:8000";
    const url = sessionId
      ? `${baseUrl}/ws/chat?session_id=${sessionId}`
      : `${baseUrl}/ws/chat`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isMounted.current) return;
      onConnectRef.current();
    };

    ws.onclose = () => {
      if (!isMounted.current) return;
      // Only handle if this is still the current connection
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      onDisconnectRef.current();

      // Auto-reconnect after 3s if no new connection was created
      reconnectTimeout.current = setTimeout(() => {
        if (isMounted.current && !wsRef.current) {
          connect(sessionIdRef.current);
        }
      }, 3000);
    };

    ws.onmessage = (event) => {
      if (!isMounted.current) return;
      // Ignore messages from stale connections
      if (wsRef.current !== ws) return;
      try {
        const parsed = JSON.parse(event.data) as WebSocketMessage;
        onMessageRef.current(parsed);
      } catch {
        console.error("Failed to parse WebSocket message:", event.data);
      }
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }, [closeCurrentConnection]);

  /**
   * Send data on the active connection.
   */
  const send = useCallback((data: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  /**
   * Disconnect the current connection.
   */
  const disconnect = useCallback(() => {
    closeCurrentConnection();
  }, [closeCurrentConnection]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMounted.current = false;
      closeCurrentConnection();
    };
  }, [closeCurrentConnection]);

  return { connect, send, disconnect };
}
