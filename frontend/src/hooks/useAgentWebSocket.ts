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
    | "visual"
    | "telegram_message"
    | "cost_saved";
  data: Record<string, unknown>;
};

/** Max buffered messages per background session to prevent memory leaks */
const MAX_BUFFER_SIZE = 500;

/**
 * Multi-connection WebSocket hook for concurrent chat sessions.
 *
 * Maintains a pool of WebSocket connections. The "active" connection
 * routes messages to onMessage; background connections route to
 * onBackgroundMessage for lightweight tracking (streaming state, titles, etc.)
 * AND buffer messages for replay when the user switches back.
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

  // Session → connId mapping for re-promotion
  const sessionConnMapRef = useRef<Map<string, string>>(new Map());

  // Background message buffers: sessionId → messages[]
  const backgroundBuffersRef = useRef<Map<string, WebSocketMessage[]>>(new Map());

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
   * Open a new WebSocket connection OR re-promote an existing background
   * connection for the given session. The connection becomes the active
   * connection. Returns a connection ID.
   */
  const connect = useCallback((sessionId?: string): string => {
    // --- Re-promotion: check if a live background connection exists for this session ---
    if (sessionId) {
      const existingConnId = sessionConnMapRef.current.get(sessionId);
      if (existingConnId && existingConnId !== activeConnIdRef.current) {
        const existingWs = connectionsRef.current.get(existingConnId);
        if (existingWs && existingWs.readyState === WebSocket.OPEN) {
          // Clear any pending reconnect for the previously active connection
          const prevActive = activeConnIdRef.current;
          if (prevActive) {
            const timeout = reconnectTimeouts.current.get(prevActive);
            if (timeout) {
              clearTimeout(timeout);
              reconnectTimeouts.current.delete(prevActive);
            }
          }

          // Promote this background connection to active
          activeConnIdRef.current = existingConnId;

          // Fire onConnect since we now have an active connection
          if (isMounted.current) {
            onConnectRef.current();
          }

          return existingConnId;
        }
      }
    }

    // --- No existing connection to re-promote: create a new one ---
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

    // Register in session→conn map
    if (sessionId) {
      sessionConnMapRef.current.set(sessionId, connId);
    }

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

      // Clean up session→conn map
      const sid = connMetaRef.current.get(connId);
      if (sid && sessionConnMapRef.current.get(sid) === connId) {
        sessionConnMapRef.current.delete(sid);
      }
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

        // Learn sessionId from session_created for ALL connections (active + background).
        // This is critical: deferred sessions (new chats) don't have a sessionId until
        // the backend creates one on the first user message. Without this, the
        // sessionConnMap never learns about the active connection's session, so
        // re-promotion fails when the user switches back.
        if (parsed.type === "session_created" && parsed.data?.session_id) {
          const newSid = parsed.data.session_id as string;
          connMetaRef.current.set(connId, newSid);
          sessionConnMapRef.current.set(newSid, connId);
        }

        if (connId === activeConnIdRef.current) {
          // Active connection → full message handling
          onMessageRef.current(parsed);
        } else {
          // Background connection → lightweight handling + buffering
          const sid = connMetaRef.current.get(connId) || null;

          // Buffer the message for replay when user switches back
          if (sid) {
            let buffer = backgroundBuffersRef.current.get(sid);
            if (!buffer) {
              buffer = [];
              backgroundBuffersRef.current.set(sid, buffer);
            }
            if (buffer.length < MAX_BUFFER_SIZE) {
              buffer.push(parsed);
            }
          }

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
   * Send data to a specific session's connection (not just the active one).
   * Used for permission responses that need to reach the correct backend session.
   */
  const sendToSession = useCallback((sessionId: string, data: Record<string, unknown>) => {
    const connId = sessionConnMapRef.current.get(sessionId);
    if (!connId) return;
    const ws = connectionsRef.current.get(connId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  /**
   * Drain and return all buffered background messages for a session.
   * Clears the buffer after draining.
   */
  const drainBuffer = useCallback((sessionId: string): WebSocketMessage[] => {
    const buffer = backgroundBuffersRef.current.get(sessionId);
    if (!buffer || buffer.length === 0) return [];
    backgroundBuffersRef.current.delete(sessionId);
    return buffer;
  }, []);

  /**
   * Check if a live background connection exists for a session.
   */
  const hasLiveConnection = useCallback((sessionId: string): boolean => {
    const connId = sessionConnMapRef.current.get(sessionId);
    if (!connId) return false;
    const ws = connectionsRef.current.get(connId);
    return !!ws && ws.readyState === WebSocket.OPEN;
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
      // Clean up session→conn map
      const sid = connMetaRef.current.get(id);
      if (sid && sessionConnMapRef.current.get(sid) === id) {
        sessionConnMapRef.current.delete(sid);
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
      sessionConnMapRef.current.clear();
      backgroundBuffersRef.current.clear();
      for (const timeout of reconnectTimeouts.current.values()) {
        clearTimeout(timeout);
      }
      reconnectTimeouts.current.clear();
    };
  }, []);

  return { connect, send, sendToSession, drainBuffer, hasLiveConnection, disconnect };
}
