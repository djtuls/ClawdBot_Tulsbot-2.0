"use client";

import { useEffect, useState } from "react";

interface Project {
  id: string;
  title: string;
  name?: string;
  description: string;
  status: "not_started" | "in_progress" | "completed";
  progress: number;
  created?: string;
  linkedTaskCount?: number;
  doneTaskCount?: number;
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee: string;
  project?: string;
}

const STATUS_STYLES: Record<string, { badge: string; label: string; dot: string }> = {
  not_started: { badge: "bg-zinc-500/20 text-zinc-400", label: "Not Started", dot: "bg-zinc-500" },
  in_progress: {
    badge: "bg-indigo-500/20 text-indigo-400",
    label: "In Progress",
    dot: "bg-indigo-500",
  },
  completed: { badge: "bg-green-500/20 text-green-400", label: "Completed", dot: "bg-green-500" },
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "text-red-400",
  high: "text-orange-400",
  medium: "text-yellow-400",
  low: "text-zinc-400",
};

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/tasks").then((r) => r.json()),
    ]).then(([p, t]) => {
      setProjects(Array.isArray(p) ? p : []);
      setTasks(Array.isArray(t) ? t : []);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-screen">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-xl font-bold text-white mb-2">Projects</h1>
      <p className="text-sm text-zinc-500 mb-8">
        {projects.length} projects &middot;{" "}
        {projects.filter((p) => p.status === "completed").length} completed
      </p>

      <div className="space-y-4">
        {projects.map((proj) => {
          const style = STATUS_STYLES[proj.status] || STATUS_STYLES.not_started;
          const isOpen = expandedId === proj.id;
          const linkedTasks = tasks.filter((t) => t.project === proj.id);
          const taskCount = proj.linkedTaskCount ?? linkedTasks.length;

          return (
            <div
              key={proj.id}
              className="bg-[#141416] border border-[#2A2A2E] rounded-xl overflow-hidden"
            >
              <button
                onClick={() => setExpandedId(isOpen ? null : proj.id)}
                className="w-full px-5 py-4 flex items-center gap-4 text-left hover:bg-[#1A1A1D] transition-colors"
              >
                <span className={`w-3 h-3 rounded-full shrink-0 ${style.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-sm font-semibold text-white">{proj.title || proj.name}</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${style.badge}`}>
                      {style.label}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500">{proj.description}</p>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className="text-lg font-bold text-white">{proj.progress}%</p>
                    <p className="text-[10px] text-zinc-600">{taskCount} tasks</p>
                  </div>
                  <svg
                    className={`w-4 h-4 text-zinc-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {isOpen && (
                <div className="px-5 pb-5 border-t border-[#2A2A2E]">
                  {/* Progress bar */}
                  <div className="mt-4 mb-4">
                    <div className="w-full bg-[#1C1C1F] rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${proj.status === "completed" ? "bg-green-500" : "bg-indigo-500"}`}
                        style={{ width: `${proj.progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Linked Tasks */}
                  {linkedTasks.length > 0 ? (
                    <div>
                      <h4 className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
                        Linked Tasks
                      </h4>
                      <div className="space-y-1.5">
                        {linkedTasks.map((t) => (
                          <div
                            key={t.id}
                            className="flex items-center gap-3 bg-[#1C1C1F] rounded-lg px-3 py-2"
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                t.status === "done"
                                  ? "bg-green-500"
                                  : t.status === "in_progress"
                                    ? "bg-indigo-500"
                                    : "bg-zinc-500"
                              }`}
                            />
                            <span className="text-xs text-zinc-300 flex-1">{t.title}</span>
                            <span
                              className={`text-[10px] ${PRIORITY_COLORS[t.priority] || "text-zinc-500"}`}
                            >
                              {t.priority}
                            </span>
                            <span className="text-[10px] text-zinc-600 capitalize">
                              {t.status.replace("_", " ")}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-600">
                      No tasks linked to this project yet. Assign tasks from the task board.
                    </p>
                  )}

                  {/* Metadata */}
                  <div className="flex items-center gap-4 mt-4 text-[10px] text-zinc-600">
                    {proj.created && <span>Created: {proj.created}</span>}
                    <span>ID: {proj.id}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {projects.length === 0 && (
          <div className="text-center py-12">
            <p className="text-zinc-600 text-sm">No projects yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
