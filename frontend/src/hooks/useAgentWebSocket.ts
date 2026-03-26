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
 * Multi-connection WebSocket hook for concurrent chat sessions.
 *
 * Maintains a pool of WebSocket connections. The "active" connection
 * routes messages to onMessage; background connections route to
 * onBackgroundMessage for lightweight tracking (streaming state, titles, etc.).
 */
export function useAgentWebSocket(
  onMessage: (msg: WebSocketMessage) => void,
  onConnect: () => void,
  onDisconnect: () => void,
  onBackgroundMessage?: (sessionId: string | null, msg: WebSocketMessage) => void
) {
  // Connection pool: connId → WebSocket
  const connectionsRef = useRef<Map<string, WebSocket>>(new Map());
  // Metadata per connection: connId → sessionId (learned from session_created or connect param)
  const connMetaRef = useRef<Map<string, string | undefined>>(new Map());
  // Which connection is currently "active" (displayed in the UI)
  const activeConnIdRef = useRef<string | null>(null);

  const isMounted = useRef(true);
  const reconnectTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Store callbacks in refs so connect() never changes identity
  const onMessageRef = useRef(onMessage);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onBackgroundMessageRef = useRef(onBackgroundMessage);
  onMessageRef.current = onMessage;
  onConnectRef.current = onConnect;
  onDisconnectRef.current = onDisconnect;
  onBackgroundMessageRef.current = onBackgroundMessage;

  // Track mounted state for Strict Mode resilience
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  /**
   * Open a new WebSocket connection. The new connection becomes
   * the active connection. Returns a connection ID.
   */
  const connect = useCallback((sessionId?: string): string => {
    const connId = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Clear any pending reconnect for the previously active connection
    const prevActive = activeConnIdRef.current;
    if (prevActive) {
      const timeout = reconnectTimeouts.current.get(prevActive);
      if (timeout) {
        clearTimeout(timeout);
        reconnectTimeouts.current.delete(prevActive);
      }
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_BACKEND_WS_URL || "ws://localhost:8000";
    const url = sessionId
      ? `${baseUrl}/ws/chat?session_id=${sessionId}`
      : `${baseUrl}/ws/chat`;

    const ws = new WebSocket(url);
    connectionsRef.current.set(connId, ws);
    connMetaRef.current.set(connId, sessionId);
    activeConnIdRef.current = connId;

    ws.onopen = () => {
      if (!isMounted.current) return;
      // Only fire onConnect for the active connection
      if (connId === activeConnIdRef.current) {
        onConnectRef.current();
      }
    };

    ws.onclose = () => {
      if (!isMounted.current) return;
      connectionsRef.current.delete(connId);
      connMetaRef.current.delete(connId);

      if (connId === activeConnIdRef.current) {
        activeConnIdRef.current = null;
        onDisconnectRef.current();

        // Auto-reconnect active connection after 3s
        const timeout = setTimeout(() => {
          if (isMounted.current && activeConnIdRef.current === null) {
            connect(sessionId);
          }
        }, 3000);
        reconnectTimeouts.current.set(connId, timeout);
      }
      // Background connections: silent cleanup, no auto-reconnect
    };

    ws.onmessage = (event) => {
      if (!isMounted.current) return;
      try {
        const parsed = JSON.parse(event.data) as WebSocketMessage;

        if (connId === activeConnIdRef.current) {
          // Active connection → full message handling
          onMessageRef.current(parsed);
        } else {
          // Background connection → lightweight handling
          // Learn sessionId from session_created if we don't have it yet
          if (parsed.type === "session_created" && parsed.data?.session_id) {
            connMetaRef.current.set(connId, parsed.data.session_id as string);
          }
          const sid = connMetaRef.current.get(connId) || null;
          onBackgroundMessageRef.current?.(sid, parsed);
        }
      } catch {
        console.error("Failed to parse WebSocket message:", event.data);
      }
    };

    ws.onerror = () => {
      // onclose will fire after this
    };

    return connId;
  }, []); // Stable identity — uses refs

  /**
   * Send data on the active connection.
   */
  const send = useCallback((data: Record<string, unknown>) => {
    const connId = activeConnIdRef.current;
    if (!connId) return;
    const ws = connectionsRef.current.get(connId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  /**
   * Close a specific connection by ID, or all connections if no ID given.
   */
  const disconnect = useCallback((connId?: string) => {
    const closeConn = (id: string) => {
      const ws = connectionsRef.current.get(id);
      if (ws) {
        ws.onclose = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.close();
        connectionsRef.current.delete(id);
      }
      connMetaRef.current.delete(id);
      const timeout = reconnectTimeouts.current.get(id);
      if (timeout) {
        clearTimeout(timeout);
        reconnectTimeouts.current.delete(id);
      }
      if (id === activeConnIdRef.current) {
        activeConnIdRef.current = null;
      }
    };

    if (connId) {
      closeConn(connId);
    } else {
      // Close all connections
      for (const id of Array.from(connectionsRef.current.keys())) {
        closeConn(id);
      }
    }
  }, []);

  /**
   * Find an existing open connection for a given sessionId.
   * Returns the connId if found, null otherwise.
   */
  const getConnectionForSession = useCallback((sessionId: string): string | null => {
    for (const [connId, sid] of connMetaRef.current.entries()) {
      if (sid === sessionId) {
        const ws = connectionsRef.current.get(connId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          return connId;
        }
      }
    }
    return null;
  }, []);

  /**
   * Promote an existing background connection to be the active connection.
   * Messages will immediately start routing to onMessage instead of onBackgroundMessage.
   * Returns true if promotion succeeded.
   */
  const promoteToActive = useCallback((connId: string): boolean => {
    const ws = connectionsRef.current.get(connId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;

    // Clear reconnect timeout for the previously active connection
    const prevActive = activeConnIdRef.current;
    if (prevActive) {
      const timeout = reconnectTimeouts.current.get(prevActive);
      if (timeout) {
        clearTimeout(timeout);
        reconnectTimeouts.current.delete(prevActive);
      }
    }

    activeConnIdRef.current = connId;
    onConnectRef.current();
    return true;
  }, []);

  // Cleanup all connections on unmount
  useEffect(() => {
    return () => {
      isMounted.current = false;
      for (const ws of connectionsRef.current.values()) {
        ws.onclose = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.close();
      }
      connectionsRef.current.clear();
      connMetaRef.current.clear();
      for (const timeout of reconnectTimeouts.current.values()) {
        clearTimeout(timeout);
      }
      reconnectTimeouts.current.clear();
    };
  }, []);

  return { connect, send, disconnect, getConnectionForSession, promoteToActive };
}
