"use client";

import { useEffect, useState } from "react";
import { Wrench, FileCode, Users } from "lucide-react";
import { FileViewerModal } from "@/components/files/FileViewerModal";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type SkillItem = {
  name: string;
  title: string;
  version: string;
  assignedTo: string[];
  file: string;
};

export function SkillsDashboard() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSkill, setEditingSkill] = useState<SkillItem | null>(null);

  useEffect(() => {
    fetchSkills();
  }, []);

  async function fetchSkills() {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/skills`);
      const data = await res.json();
      if (data.skills) {
        setSkills(
          data.skills.map(
            (s: {
              name: string;
              title: string;
              version: string;
              assigned_to: string[];
              file: string;
            }) => ({
              name: s.name,
              title: s.title,
              version: s.version,
              assignedTo: s.assigned_to || [],
              file: s.file,
            })
          )
        );
      }
    } catch (err) {
      console.error("Failed to fetch skills:", err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="h-8 w-32 bg-bg-tertiary animate-pulse rounded-[2px] mb-6" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-36 bg-bg-tertiary animate-pulse rounded-[2px]"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-6 pb-0">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <h2 className="text-lg font-semibold text-text-primary font-display">
            Skills
          </h2>
          <span className="px-2 py-0.5 text-[10px] font-bold rounded-[2px] bg-bg-tertiary text-text-secondary border border-border">
            {skills.length}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 pt-4">
        <div className="max-w-4xl mx-auto">
          {skills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Wrench size={40} strokeWidth={1.5} className="text-text-secondary/20 mb-4" />
              <p className="text-sm text-text-secondary/50">
                No skills created yet
              </p>
              <p className="text-[11px] text-text-secondary/30 mt-1">
                Ask Clyde to create one after a successful task
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {skills.map((sk) => (
                <button
                  key={sk.name}
                  onClick={() => setEditingSkill(sk)}
                  className="group text-left p-0 bg-bg-tertiary rounded-[2px] border border-border hover:border-accent-primary/50 transition-all overflow-hidden"
                >
                  {/* Card top accent */}
                  <div className="h-1 w-full bg-accent-primary/20 group-hover:bg-accent-primary/50 transition-colors" />

                  <div className="p-4 space-y-3">
                    {/* Title + version */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-text-primary truncate group-hover:text-accent-primary transition-colors">
                          {sk.title}
                        </h3>
                        <p className="text-[10px] font-mono text-text-secondary/40 mt-0.5 truncate">
                          {sk.name}
                        </p>
                      </div>
                      <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-mono font-bold rounded-[2px] bg-bg-secondary text-text-secondary border border-border">
                        v{sk.version}
                      </span>
                    </div>

                    {/* Agents */}
                    <div className="flex items-center gap-1.5">
                      <Users size={11} className="text-text-secondary/40 shrink-0" />
                      {sk.assignedTo.length > 0 ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          {sk.assignedTo.map((agent) => (
                            <span
                              key={agent}
                              className="px-1.5 py-0.5 text-[10px] font-medium rounded-[2px] bg-accent-primary/10 text-accent-primary"
                            >
                              {agent}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[10px] text-text-secondary/40">
                          Unassigned
                        </span>
                      )}
                    </div>

                    {/* File path */}
                    <div className="flex items-center gap-1.5">
                      <FileCode size={11} className="text-text-secondary/40 shrink-0" />
                      <p className="text-[10px] text-text-secondary/40 font-mono truncate">
                        {sk.file}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* File editor modal */}
      {editingSkill && (
        <FileViewerModal
          filePath={editingSkill.file}
          fileName={editingSkill.file.split("/").pop() || editingSkill.name}
          onClose={() => setEditingSkill(null)}
          onSaved={() => fetchSkills()}
        />
      )}
    </div>
  );
}
