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
    | "proactive_insight"
    | "activity_history"
    | "cancel_confirmed";
  data: Record<string, unknown>;
};

/**
 * WebSocket hook resilient to React Strict Mode and session switching.
 *
 * Uses a monotonically increasing "generation" counter to prevent stale
 * reconnect loops from competing with the current connection.
 */
export function useAgentWebSocket(
  onMessage: (msg: WebSocketMessage) => void,
  onConnect: () => void,
  onDisconnect: () => void
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const isMounted = useRef(true);

  // Generation counter — incremented on every connect() call.
  // Stale onclose handlers from previous generations are ignored.
  const generation = useRef(0);

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

  const connect = useCallback((sessionId?: string) => {
    // Increment generation — any in-flight onclose from previous gen is stale
    const thisGen = ++generation.current;

    // Clear any pending reconnect from a previous connection
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }

    // Close existing connection
    if (wsRef.current) {
      // Close without waiting — the stale gen check will ignore its onclose
      wsRef.current.onclose = null; // detach handler before closing
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_BACKEND_WS_URL || "ws://localhost:8000";
    const url = sessionId
      ? `${baseUrl}/ws/chat?session_id=${sessionId}`
      : `${baseUrl}/ws/chat`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (thisGen !== generation.current || !isMounted.current) return;
      onConnectRef.current();
    };

    ws.onclose = () => {
      // Ignore if this is a stale generation or component unmounted
      if (thisGen !== generation.current || !isMounted.current) return;

      onDisconnectRef.current();

      // Auto-reconnect after 3s — but only if still current generation
      reconnectTimeout.current = setTimeout(() => {
        if (thisGen === generation.current && isMounted.current) {
          connect(sessionId);
        }
      }, 3000);
    };

    ws.onmessage = (event) => {
      if (thisGen !== generation.current || !isMounted.current) return;
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
  }, []); // Stable identity — uses refs + generation counter

  const send = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const disconnect = useCallback(() => {
    // Bump generation so any in-flight handlers become stale
    generation.current++;

    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMounted.current = false;
      generation.current++;
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
        reconnectTimeout.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return { connect, send, disconnect };
}
