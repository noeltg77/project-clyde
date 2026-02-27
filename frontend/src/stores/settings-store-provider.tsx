"use client";

import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";
import { createSettingsStore, type SettingsStore } from "./settings-store";

const SettingsStoreContext = createContext<StoreApi<SettingsStore> | null>(null);

export function SettingsStoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<StoreApi<SettingsStore> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createSettingsStore();
  }
  return (
    <SettingsStoreContext.Provider value={storeRef.current}>
      {children}
    </SettingsStoreContext.Provider>
  );
}

export function useSettingsStore<T>(selector: (state: SettingsStore) => T): T {
  const store = useContext(SettingsStoreContext);
  if (!store)
    throw new Error(
      "useSettingsStore must be used within SettingsStoreProvider"
    );
  return useStore(store, selector);
}
