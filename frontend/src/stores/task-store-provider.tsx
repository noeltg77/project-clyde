"use client";

import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";
import { createTaskStore, type TaskStore } from "./task-store";

const TaskStoreContext = createContext<StoreApi<TaskStore> | null>(null);

export function TaskStoreProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<StoreApi<TaskStore> | null>(null);
  if (!storeRef.current) {
    storeRef.current = createTaskStore();
  }
  return (
    <TaskStoreContext.Provider value={storeRef.current}>
      {children}
    </TaskStoreContext.Provider>
  );
}

export function useTaskStore<T>(selector: (state: TaskStore) => T): T {
  const store = useContext(TaskStoreContext);
  if (!store)
    throw new Error("useTaskStore must be used within TaskStoreProvider");
  return useStore(store, selector);
}
