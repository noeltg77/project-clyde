"use client";

import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";
import { createChatStore, type ChatStore } from "./chat-store";

const ChatStoreContext = createContext<StoreApi<ChatStore> | null>(null);

export function ChatStoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<StoreApi<ChatStore> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createChatStore();
  }
  return (
    <ChatStoreContext.Provider value={storeRef.current}>
      {children}
    </ChatStoreContext.Provider>
  );
}

export function useChatStore<T>(selector: (state: ChatStore) => T): T {
  const store = useContext(ChatStoreContext);
  if (!store)
    throw new Error("useChatStore must be used within ChatStoreProvider");
  return useStore(store, selector);
}
