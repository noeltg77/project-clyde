"use client";

import { useEffect, useState, useCallback } from "react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import { AnimatePresence } from "motion/react";
import { useTaskStore } from "@/stores/task-store-provider";
import type { Task, TaskColumn } from "@/stores/task-store";
import { TaskCard } from "./TaskCard";
import { TaskModal } from "./TaskModal";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export function TaskBoard() {
  const columns = useTaskStore((s) => s.columns);
  const tasks = useTaskStore((s) => s.tasks);
  const loading = useTaskStore((s) => s.loading);
  const setColumns = useTaskStore((s) => s.setColumns);
  const setTasks = useTaskStore((s) => s.setTasks);
  const addColumn = useTaskStore((s) => s.addColumn);
  const updateColumn = useTaskStore((s) => s.updateColumn);
  const removeColumn = useTaskStore((s) => s.removeColumn);
  const addTask = useTaskStore((s) => s.addTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const removeTask = useTaskStore((s) => s.removeTask);
  const moveTask = useTaskStore((s) => s.moveTask);
  const setLoading = useTaskStore((s) => s.setLoading);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [createColumnId, setCreateColumnId] = useState<string | null>(null);

  // Column editing
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingColumnName, setEditingColumnName] = useState("");

  // Fetch data on mount
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [colRes, taskRes] = await Promise.all([
          fetch(`${API_URL}/api/tasks/columns`),
          fetch(`${API_URL}/api/tasks`),
        ]);
        const colData = await colRes.json();
        const taskData = await taskRes.json();
        setColumns(colData.columns || []);
        setTasks(taskData.tasks || []);
      } catch (err) {
        console.error("Failed to fetch task data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [setColumns, setTasks, setLoading]);

  // Get tasks for a specific column, sorted by position
  const getColumnTasks = useCallback(
    (columnId: string) =>
      tasks
        .filter((t) => t.column_id === columnId)
        .sort((a, b) => a.position - b.position),
    [tasks]
  );

  // Drag and drop handler
  const handleDragEnd = useCallback(
    async (result: DropResult) => {
      const { draggableId, source, destination } = result;
      if (!destination) return;
      if (
        source.droppableId === destination.droppableId &&
        source.index === destination.index
      )
        return;

      const newColumnId = destination.droppableId;
      const newPosition = destination.index;

      // Optimistic update
      moveTask(draggableId, newColumnId, newPosition);

      // Build reorder payload for all affected tasks
      const destTasks = tasks
        .filter(
          (t) => t.column_id === newColumnId && t.id !== draggableId
        )
        .sort((a, b) => a.position - b.position);

      // Insert the moved task at the new position
      destTasks.splice(newPosition, 0, { id: draggableId } as Task);

      const updates = destTasks.map((t, idx) => ({
        id: t.id,
        column_id: newColumnId,
        position: idx,
      }));

      // If moving across columns, also reorder source column
      if (source.droppableId !== destination.droppableId) {
        const srcTasks = tasks
          .filter(
            (t) =>
              t.column_id === source.droppableId && t.id !== draggableId
          )
          .sort((a, b) => a.position - b.position);
        srcTasks.forEach((t, idx) => {
          updates.push({
            id: t.id,
            column_id: source.droppableId,
            position: idx,
          });
        });
      }

      try {
        await fetch(`${API_URL}/api/tasks/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates }),
        });
      } catch (err) {
        console.error("Failed to reorder tasks:", err);
      }
    },
    [tasks, moveTask]
  );

  // Create task
  const handleCreateTask = useCallback(
    async (data: {
      title: string;
      description: string;
      column_id: string;
      assignee_type: string | null;
      assignee_id: string | null;
      assignee_name: string | null;
      linked_docs: { path: string; name: string }[];
    }) => {
      try {
        const res = await fetch(`${API_URL}/api/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const result = await res.json();
        if (result.task) {
          addTask(result.task);
        }
      } catch (err) {
        console.error("Failed to create task:", err);
      }
      setModalOpen(false);
      setCreateColumnId(null);
    },
    [addTask]
  );

  // Update task
  const handleUpdateTask = useCallback(
    async (data: {
      title: string;
      description: string;
      column_id: string;
      assignee_type: string | null;
      assignee_id: string | null;
      assignee_name: string | null;
      linked_docs: { path: string; name: string }[];
    }) => {
      if (!editingTask) return;
      try {
        const res = await fetch(`${API_URL}/api/tasks/${editingTask.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const result = await res.json();
        if (result.task) {
          updateTask(editingTask.id, result.task);
        }
      } catch (err) {
        console.error("Failed to update task:", err);
      }
      setModalOpen(false);
      setEditingTask(null);
    },
    [editingTask, updateTask]
  );

  // Delete task
  const handleDeleteTask = useCallback(async () => {
    if (!editingTask) return;
    try {
      await fetch(`${API_URL}/api/tasks/${editingTask.id}`, {
        method: "DELETE",
      });
      removeTask(editingTask.id);
    } catch (err) {
      console.error("Failed to delete task:", err);
    }
    setModalOpen(false);
    setEditingTask(null);
  }, [editingTask, removeTask]);

  // Add column
  const handleAddColumn = useCallback(async () => {
    try {
      const position = columns.length;
      const res = await fetch(`${API_URL}/api/tasks/columns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Column", position }),
      });
      const result = await res.json();
      if (result.column) {
        addColumn(result.column);
      }
    } catch (err) {
      console.error("Failed to add column:", err);
    }
  }, [columns.length, addColumn]);

  // Rename column
  const handleRenameColumn = useCallback(
    async (columnId: string, newName: string) => {
      if (!newName.trim()) return;
      try {
        await fetch(`${API_URL}/api/tasks/columns/${columnId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName.trim() }),
        });
        updateColumn(columnId, { name: newName.trim() });
      } catch (err) {
        console.error("Failed to rename column:", err);
      }
      setEditingColumnId(null);
    },
    [updateColumn]
  );

  // Delete column
  const handleDeleteColumn = useCallback(
    async (columnId: string) => {
      try {
        await fetch(`${API_URL}/api/tasks/columns/${columnId}`, {
          method: "DELETE",
        });
        removeColumn(columnId);
      } catch (err) {
        console.error("Failed to delete column:", err);
      }
    },
    [removeColumn]
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-text-secondary text-sm">Loading tasks...</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-display font-semibold text-text-primary">
            Tasks
          </h1>
          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-[2px] bg-accent-secondary/20 text-accent-secondary border border-accent-secondary/30">
            WIP
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleAddColumn}
            className="px-3 py-1.5 text-[11px] font-semibold text-text-secondary border border-border rounded-[2px] hover:text-text-primary hover:border-text-secondary/40 transition-colors"
          >
            + Column
          </button>
          <button
            onClick={() => {
              setEditingTask(null);
              setCreateColumnId(columns[0]?.id || null);
              setModalOpen(true);
            }}
            className="px-3 py-1.5 text-[11px] font-semibold bg-accent-primary text-bg-primary rounded-[2px] hover:bg-accent-primary/90 transition-colors"
          >
            + New Task
          </button>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex gap-4 p-6 h-full min-w-min">
            {columns.map((column) => (
              <div
                key={column.id}
                className="flex flex-col w-72 flex-shrink-0 bg-bg-primary border border-border rounded-[2px]"
              >
                {/* Column header */}
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
                  {editingColumnId === column.id ? (
                    <input
                      value={editingColumnName}
                      onChange={(e) => setEditingColumnName(e.target.value)}
                      onBlur={() =>
                        handleRenameColumn(column.id, editingColumnName)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          handleRenameColumn(column.id, editingColumnName);
                        if (e.key === "Escape") setEditingColumnId(null);
                      }}
                      autoFocus
                      className="flex-1 px-1 py-0 text-xs font-semibold bg-transparent text-text-primary border-b border-accent-primary focus:outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        setEditingColumnId(column.id);
                        setEditingColumnName(column.name);
                      }}
                      className="text-xs font-semibold text-text-primary uppercase tracking-wider hover:text-accent-primary transition-colors"
                    >
                      {column.name}
                    </button>
                  )}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-text-secondary/60">
                      {getColumnTasks(column.id).length}
                    </span>
                    <button
                      onClick={() => handleDeleteColumn(column.id)}
                      className="text-text-secondary/40 hover:text-error transition-colors"
                      title="Delete column"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Droppable area */}
                <Droppable droppableId={column.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 overflow-y-auto p-2 space-y-2 min-h-[60px] transition-colors ${
                        snapshot.isDraggingOver
                          ? "bg-accent-primary/5"
                          : ""
                      }`}
                    >
                      {getColumnTasks(column.id).map((task, index) => (
                        <Draggable
                          key={task.id}
                          draggableId={task.id}
                          index={index}
                        >
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={`${
                                snapshot.isDragging
                                  ? "opacity-90 shadow-lg"
                                  : ""
                              }`}
                            >
                              <TaskCard
                                task={task}
                                onClick={() => {
                                  setEditingTask(task);
                                  setModalOpen(true);
                                }}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>

                {/* Add task to column */}
                <div className="px-2 py-2 border-t border-border/50">
                  <button
                    onClick={() => {
                      setEditingTask(null);
                      setCreateColumnId(column.id);
                      setModalOpen(true);
                    }}
                    className="w-full text-left px-2 py-1 text-[11px] text-text-secondary/60 hover:text-text-secondary transition-colors rounded-[2px] hover:bg-bg-tertiary/50"
                  >
                    + Add task
                  </button>
                </div>
              </div>
            ))}

            {/* Empty state */}
            {columns.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center text-text-secondary">
                <p className="text-sm mb-3">
                  No columns yet. Add columns to start organising tasks.
                </p>
                <button
                  onClick={handleAddColumn}
                  className="px-4 py-2 text-sm bg-accent-primary text-bg-primary font-semibold rounded-[2px] hover:bg-accent-primary/90 transition-colors"
                >
                  + Add First Column
                </button>
              </div>
            )}
          </div>
        </DragDropContext>
      </div>

      {/* Task Modal */}
      <AnimatePresence>
        {modalOpen && (
          <TaskModal
            task={editingTask}
            columns={columns}
            defaultColumnId={createColumnId || undefined}
            onSave={editingTask ? handleUpdateTask : handleCreateTask}
            onDelete={editingTask ? handleDeleteTask : undefined}
            onClose={() => {
              setModalOpen(false);
              setEditingTask(null);
              setCreateColumnId(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
