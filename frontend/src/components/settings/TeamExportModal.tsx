"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useAgentStore } from "@/stores/agent-store-provider";
import { springs } from "@/lib/design-tokens";

const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function TeamExportModal({ isOpen, onClose }: Props) {
  const teams = useAgentStore((s) => s.teams);
  const agents = useAgentStore((s) => s.agents);

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  // Get unique skills from agents in the selected team
  const teamSkills = useMemo(() => {
    if (!selectedTeamId) return [];
    const members = agents.filter((a) => a.team === selectedTeamId);
    const skillSet = new Set<string>();
    for (const member of members) {
      for (const skill of member.skills) {
        skillSet.add(skill);
      }
    }
    return Array.from(skillSet).sort();
  }, [selectedTeamId, agents]);

  // When team changes, select all skills by default
  function handleTeamChange(teamId: string) {
    setSelectedTeamId(teamId || null);
    if (teamId) {
      const members = agents.filter((a) => a.team === teamId);
      const allSkills = new Set<string>();
      for (const member of members) {
        for (const skill of member.skills) {
          allSkills.add(skill);
        }
      }
      setSelectedSkills(allSkills);
    } else {
      setSelectedSkills(new Set());
    }
  }

  function toggleSkill(skill: string) {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) {
        next.delete(skill);
      } else {
        next.add(skill);
      }
      return next;
    });
  }

  async function handleExport() {
    if (!selectedTeamId) return;
    setExporting(true);
    try {
      const skillsParam = Array.from(selectedSkills).join(",");
      const url = `${API_URL}/api/teams/${selectedTeamId}/export?skills=${encodeURIComponent(skillsParam)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) {
        alert(`Export failed: ${data.error}`);
        return;
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const teamName =
        teams.find((t) => t.id === selectedTeamId)?.name ?? "team";
      const safeName = teamName.toLowerCase().replace(/\s+/g, "-");
      a.download = `${safeName}.clyde.json`;
      a.click();
      URL.revokeObjectURL(blobUrl);
      onClose();
    } catch {
      alert("Export failed");
    } finally {
      setExporting(false);
    }
  }

  const memberCount = selectedTeamId
    ? agents.filter((a) => a.team === selectedTeamId).length
    : 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-[60]"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={springs.snappy}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] bg-bg-secondary border border-border rounded-[4px] z-[61] flex flex-col"
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-3 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary">
                Export Team
              </h2>
              <p className="text-[10px] text-text-secondary/60 mt-1">
                Export a team as a .clyde package with agents, prompts, memory,
                and skills.
              </p>
            </div>

            {/* Body */}
            <div className="px-5 py-4 flex flex-col gap-4">
              {/* Team selector */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-1.5 block">
                  Team
                </label>
                <select
                  value={selectedTeamId ?? ""}
                  onChange={(e) => handleTeamChange(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-tertiary border border-border text-text-primary text-sm rounded-[2px] outline-none focus:border-accent-primary transition-colors"
                >
                  <option value="">Select a team...</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
                {selectedTeamId && (
                  <p className="text-[10px] text-text-secondary/50 mt-1">
                    {memberCount} agent{memberCount !== 1 ? "s" : ""} in this
                    team
                  </p>
                )}
              </div>

              {/* Skills checkboxes */}
              {selectedTeamId && teamSkills.length > 0 && (
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-1.5 block">
                    Include Skills
                  </label>
                  <div className="flex flex-col gap-1.5">
                    {teamSkills.map((skill) => (
                      <label
                        key={skill}
                        className="flex items-center gap-2.5 px-3 py-2 bg-bg-tertiary border border-border rounded-[2px] cursor-pointer hover:border-accent-primary/40 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedSkills.has(skill)}
                          onChange={() => toggleSkill(skill)}
                          className="w-3.5 h-3.5 accent-accent-primary shrink-0"
                        />
                        <span className="text-sm text-text-primary">
                          {skill}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {selectedTeamId && teamSkills.length === 0 && (
                <p className="text-[10px] text-text-secondary/50">
                  No skills assigned to agents in this team.
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 pt-2 flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 py-2 bg-bg-tertiary border border-border text-text-primary text-sm font-semibold rounded-[2px] hover:border-accent-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={!selectedTeamId || exporting}
                className="flex-1 py-2 bg-accent-primary text-bg-primary text-sm font-semibold rounded-[2px] hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {exporting ? "Exporting..." : "Export"}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
