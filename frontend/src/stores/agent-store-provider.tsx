"use client";

import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";
import { createAgentStore, type AgentStore } from "./agent-store";

const AgentStoreContext = createContext<StoreApi<AgentStore> | null>(null);

export function AgentStoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<StoreApi<AgentStore> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createAgentStore();
  }
  return (
    <AgentStoreContext.Provider value={storeRef.current}>
      {children}
    </AgentStoreContext.Provider>
  );
}

export function useAgentStore<T>(selector: (state: AgentStore) => T): T {
  const store = useContext(AgentStoreContext);
  if (!store)
    throw new Error("useAgentStore must be used within AgentStoreProvider");
  return useStore(store, selector);
}
