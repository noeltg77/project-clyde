"use client";

import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";
import { createInsightStore, type InsightStore } from "./insight-store";

const InsightStoreContext = createContext<StoreApi<InsightStore> | null>(null);

export function InsightStoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<StoreApi<InsightStore> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createInsightStore();
  }
  return (
    <InsightStoreContext.Provider value={storeRef.current}>
      {children}
    </InsightStoreContext.Provider>
  );
}

export function useInsightStore<T>(selector: (state: InsightStore) => T): T {
  const store = useContext(InsightStoreContext);
  if (!store)
    throw new Error("useInsightStore must be used within InsightStoreProvider");
  return useStore(store, selector);
}
