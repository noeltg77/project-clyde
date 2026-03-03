import { createStore } from "zustand/vanilla";

export type TaskColumn = {
  id: string;
  name: string;
  position: number;
  created_at: string;
};

export type Task = {
  id: string;
  title: string;
  description: string;
  column_id: string;
  position: number;
  assignee_type: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  linked_docs: { path: string; name: string }[];
  session_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskState = {
  columns: TaskColumn[];
  tasks: Task[];
  loading: boolean;
};

export type TaskActions = {
  setColumns: (columns: TaskColumn[]) => void;
  addColumn: (column: TaskColumn) => void;
  updateColumn: (id: string, data: Partial<TaskColumn>) => void;
  removeColumn: (id: string) => void;
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (id: string, data: Partial<Task>) => void;
  removeTask: (id: string) => void;
  moveTask: (taskId: string, newColumnId: string, newPosition: number) => void;
  setLoading: (loading: boolean) => void;
};

export type TaskStore = TaskState & TaskActions;

export const createTaskStore = (initState?: Partial<TaskState>) =>
  createStore<TaskStore>()((set) => ({
    columns: [],
    tasks: [],
    loading: false,
    ...initState,

    setColumns: (columns) => set({ columns }),

    addColumn: (column) =>
      set((state) => {
        const existing = state.columns.find((c) => c.id === column.id);
        if (existing) return state;
        return { columns: [...state.columns, column].sort((a, b) => a.position - b.position) };
      }),

    updateColumn: (id, data) =>
      set((state) => ({
        columns: state.columns
          .map((c) => (c.id === id ? { ...c, ...data } : c))
          .sort((a, b) => a.position - b.position),
      })),

    removeColumn: (id) =>
      set((state) => ({
        columns: state.columns.filter((c) => c.id !== id),
        tasks: state.tasks.filter((t) => t.column_id !== id),
      })),

    setTasks: (tasks) => set({ tasks }),

    addTask: (task) =>
      set((state) => {
        const existing = state.tasks.find((t) => t.id === task.id);
        if (existing) return state;
        return { tasks: [...state.tasks, task] };
      }),

    updateTask: (id, data) =>
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...data } : t)),
      })),

    removeTask: (id) =>
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== id),
      })),

    moveTask: (taskId, newColumnId, newPosition) =>
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId
            ? { ...t, column_id: newColumnId, position: newPosition }
            : t
        ),
      })),

    setLoading: (loading) => set({ loading }),
  }));
