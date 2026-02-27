import { createStore } from "zustand/vanilla";

export type ActiveView = "chat" | "orgchart" | "skills" | "cost" | "schedules" | "triggers" | "performance" | "insights" | "files";

export type SettingsState = {
  workingDir: string;
  backendUrl: string;
  isSettingsOpen: boolean;
  isSearchOpen: boolean;
  activeView: ActiveView;
};

export type SettingsActions = {
  setWorkingDir: (dir: string) => void;
  setBackendUrl: (url: string) => void;
  toggleSettings: () => void;
  setSettingsOpen: (open: boolean) => void;
  setActiveView: (view: ActiveView) => void;
  toggleSearch: () => void;
  setSearchOpen: (open: boolean) => void;
};

export type SettingsStore = SettingsState & SettingsActions;

export const createSettingsStore = (initState?: Partial<SettingsState>) =>
  createStore<SettingsStore>()((set) => ({
    workingDir: "",
    backendUrl: "http://localhost:8000",
    isSettingsOpen: false,
    isSearchOpen: false,
    activeView: "chat" as ActiveView,
    ...initState,
    setWorkingDir: (dir) => set({ workingDir: dir }),
    setBackendUrl: (url) => set({ backendUrl: url }),
    toggleSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen })),
    setSettingsOpen: (open) => set({ isSettingsOpen: open }),
    setActiveView: (view) => set({ activeView: view }),
    toggleSearch: () => set((s) => ({ isSearchOpen: !s.isSearchOpen })),
    setSearchOpen: (open) => set({ isSearchOpen: open }),
  }));
