"use client";

import { useEffect, useState, useCallback } from "react";

interface TaskComment {
  id: string;
  author: "tulio" | "tulsbot";
  text: string;
  ts: string;
  type?: "comment" | "command" | "ai_summary";
}

interface Task {
  id: string;
  title: string;
  description?: string;
  status: "backlog" | "in_progress" | "review" | "done";
  priority: "low" | "medium" | "high" | "urgent";
  assignee: "tulio" | "tulsbot";
  project?: string;
  created: string;
  comments?: TaskComment[];
}

interface SystemEvent {
  ts: string;
  type: string;
  status: string;
  source: string;
}

interface Project {
  id: string;
  title: string;
}

const COLUMNS: { key: Task["status"]; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "in_progress", label: "In Progress" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500/20 text-red-400",
  high: "bg-orange-500/20 text-orange-400",
  medium: "bg-yellow-500/20 text-yellow-400",
  low: "bg-zinc-500/20 text-zinc-400",
};

function AssigneeBadge({ assignee }: { assignee: string }) {
  return (
    <div
      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
        assignee === "tulsbot"
          ? "bg-indigo-500/20 text-indigo-400"
          : "bg-emerald-500/20 text-emerald-400"
      }`}
    >
      {assignee === "tulsbot" ? "B" : "T"}
    </div>
  );
}

function TaskDetailPanel({
  task,
  projects,
  onClose,
  onUpdate,
}: {
  task: Task;
  projects: Project[];
  onClose: () => void;
  onUpdate: (t: Task) => void;
}) {
  const [commentText, setCommentText] = useState("");
  const [commentType, setCommentType] = useState<"comment" | "command">("comment");
  const [aiLoading, setAiLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDesc, setEditDesc] = useState(task.description || "");
  const [editTitle, setEditTitle] = useState(task.title);

  const addComment = async () => {
    if (!commentText.trim()) {
      return;
    }
    const res = await fetch(`/api/tasks/${task.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: commentText, author: "tulio", type: commentType }),
    });
    if (res.ok) {
      const comment = await res.json();
      const updated = { ...task, comments: [...(task.comments || []), comment] };
      onUpdate(updated);
      setCommentText("");
    }
  };

  const askAI = async () => {
    setAiLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Analyze this task and provide a brief actionable summary with next steps:\n\nTitle: ${task.title}\nDescription: ${task.description || "None"}\nStatus: ${task.status}\nPriority: ${task.priority}\nAssignee: ${task.assignee}\nComments: ${(task.comments || []).map((c) => `[${c.author}] ${c.text}`).join("\n") || "None"}`,
          context: `Task detail view for: ${task.title}`,
        }),
      });
      const data = await res.json();
      const aiComment: TaskComment = {
        id: `ai-${Date.now()}`,
        author: "tulsbot",
        text: data.reply || "Could not generate summary",
        ts: new Date().toISOString(),
        type: "ai_summary",
      };

      await fetch(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: aiComment.text, author: "tulsbot", type: "ai_summary" }),
      });

      const updated = { ...task, comments: [...(task.comments || []), aiComment] };
      onUpdate(updated);
    } catch {
      /* ignore */
    } finally {
      setAiLoading(false);
    }
  };

  const saveEdit = async () => {
    const res = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, title: editTitle, description: editDesc }),
    });
    if (res.ok) {
      const updated = await res.json();
      onUpdate({ ...task, ...updated });
      setEditing(false);
    }
  };

  const updateField = async (field: string, value: string) => {
    const res = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, [field]: value }),
    });
    if (res.ok) {
      const updated = await res.json();
      onUpdate({ ...task, ...updated });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex justify-end z-40" onClick={onClose}>
      <div
        className="w-[500px] h-full bg-[#111113] border-l border-[#2A2A2E] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2A2A2E] shrink-0">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Task Detail
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white">
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Title & Description */}
          {editing ? (
            <div className="space-y-3">
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full bg-[#1C1C1F] border border-[#2A2A2E] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-indigo-500"
              />
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={4}
                className="w-full bg-[#1C1C1F] border border-[#2A2A2E] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-indigo-500 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={saveEdit}
                  className="bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs hover:bg-indigo-600"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="text-zinc-500 text-xs hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold text-white leading-snug">{task.title}</h3>
                <button
                  onClick={() => setEditing(true)}
                  className="text-zinc-600 hover:text-white shrink-0"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </div>
              {task.description && (
                <p className="text-sm text-zinc-400 mt-2 leading-relaxed">{task.description}</p>
              )}
            </div>
          )}

          {/* Fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-zinc-600 uppercase tracking-wider">Status</label>
              <select
                value={task.status}
                onChange={(e) => updateField("status", e.target.value)}
                className="w-full bg-[#1C1C1F] border border-[#2A2A2E] rounded-lg px-2 py-1.5 text-xs text-white outline-none mt-1"
              >
                {COLUMNS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-zinc-600 uppercase tracking-wider">Priority</label>
              <select
                value={task.priority}
                onChange={(e) => updateField("priority", e.target.value)}
                className="w-full bg-[#1C1C1F] border border-[#2A2A2E] rounded-lg px-2 py-1.5 text-xs text-white outline-none mt-1"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-zinc-600 uppercase tracking-wider">Assignee</label>
              <select
                value={task.assignee}
                onChange={(e) => updateField("assignee", e.target.value)}
                className="w-full bg-[#1C1C1F] border border-[#2A2A2E] rounded-lg px-2 py-1.5 text-xs text-white outline-none mt-1"
              >
                <option value="tulio">Tulio</option>
                <option value="tulsbot">Tulsbot</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-zinc-600 uppercase tracking-wider">Project</label>
              <select
                value={task.project || ""}
                onChange={(e) => updateField("project", e.target.value)}
                className="w-full bg-[#1C1C1F] border border-[#2A2A2E] rounded-lg px-2 py-1.5 text-xs text-white outline-none mt-1"
              >
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* AI Summary Button */}
          <button
            onClick={askAI}
            disabled={aiLoading}
            className="w-full flex items-center justify-center gap-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 py-2 rounded-lg text-xs font-medium hover:bg-indigo-500/20 disabled:opacity-50"
          >
            {aiLoading ? (
              <>
                <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                Thinking...
              </>
            ) : (
              <>
                <span>🦞</span>
                Ask Tulsbot for AI Summary
              </>
            )}
          </button>

          {/* Comments / Activity */}
          <div>
            <h4 className="text-xs text-zinc-500 uppercase tracking-wider mb-3">
              Comments &amp; Activity
            </h4>
            <div className="space-y-3">
              {(!task.comments || task.comments.length === 0) && (
                <p className="text-xs text-zinc-600">No comments yet.</p>
              )}
              {(task.comments || []).map((c) => (
                <div key={c.id} className="flex gap-2">
                  <AssigneeBadge assignee={c.author} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium text-zinc-300 capitalize">
                        {c.author}
                      </span>
                      {c.type === "command" && (
                        <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">
                          cmd
                        </span>
                      )}
                      {c.type === "ai_summary" && (
                        <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded">
                          AI
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-600">
                        {new Date(c.ts).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 whitespace-pre-wrap">{c.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Comment Input */}
        <div className="px-5 pb-4 pt-3 border-t border-[#2A2A2E] shrink-0">
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setCommentType("comment")}
              className={`text-[10px] px-2 py-1 rounded ${commentType === "comment" ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-white"}`}
            >
              Comment
            </button>
            <button
              onClick={() => setCommentType("command")}
              className={`text-[10px] px-2 py-1 rounded ${commentType === "command" ? "bg-amber-500/20 text-amber-400" : "text-zinc-500 hover:text-white"}`}
            >
              /command
            </button>
          </div>
          <div className="flex gap-2">
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addComment()}
              placeholder={
                commentType === "command" ? "Send a command to Tulsbot..." : "Add a comment..."
              }
              className="flex-1 bg-[#1C1C1F] border border-[#2A2A2E] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-indigo-500 placeholder:text-zinc-600"
            />
            <button
              onClick={addComment}
              disabled={!commentText.trim()}
              className="bg-indigo-500 text-white px-3 py-2 rounded-lg text-xs hover:bg-indigo-600 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TaskBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<Task["priority"]>("medium");
  const [newAssignee, setNewAssignee] = useState<Task["assignee"]>("tulio");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    Promise.all([
      fetch("/api/tasks").then((r) => r.json()),
      fetch("/api/events?limit=15").then((r) => r.json()),
      fetch("/api/projects").then((r) => r.json()),
    ]).then(([t, e, p]) => {
      setTasks(Array.isArray(t) ? t : []);
      setEvents(Array.isArray(e) ? e : []);
      setProjects(Array.isArray(p) ? p : []);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const addTask = async () => {
    if (!newTitle.trim()) {
      return;
    }
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle, priority: newPriority, assignee: newAssignee }),
    });
    const task = await res.json();
    setTasks((prev) => [...prev, task]);
    setNewTitle("");
    setShowNew(false);
  };

  const moveTask = async (id: string, status: Task["status"]) => {
    const res = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    const updated = await res.json();
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updated } : t)));
    if (selectedTask?.id === id) {
      setSelectedTask({ ...selectedTask, ...updated });
    }
  };

  const handleTaskUpdate = (updated: Task) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setSelectedTask(updated);
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-screen">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8 h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Tasks</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            {tasks.length} total &middot; {tasks.filter((t) => t.status === "in_progress").length}{" "}
            in progress
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-600"
        >
          + New Task
        </button>
      </div>

      {/* New Task Form */}
      {showNew && (
        <div className="bg-[#141416] border border-[#2A2A2E] rounded-xl p-4 mb-6">
          <div className="flex gap-3">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              placeholder="Task title..."
              autoFocus
              className="flex-1 bg-[#1C1C1F] border border-[#2A2A2E] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-indigo-500"
            />
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value as Task["priority"])}
              className="bg-[#1C1C1F] border border-[#2A2A2E] rounded-lg px-3 py-2 text-white text-sm outline-none"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            <select
              value={newAssignee}
              onChange={(e) => setNewAssignee(e.target.value as Task["assignee"])}
              className="bg-[#1C1C1F] border border-[#2A2A2E] rounded-lg px-3 py-2 text-white text-sm outline-none"
            >
              <option value="tulio">Tulio</option>
              <option value="tulsbot">Tulsbot</option>
            </select>
            <button
              onClick={addTask}
              className="bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-600"
            >
              Add
            </button>
            <button
              onClick={() => setShowNew(false)}
              className="text-zinc-500 hover:text-white text-sm px-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Board + Activity */}
      <div className="flex gap-6 flex-1 min-h-0">
        {/* Kanban */}
        <div className="flex-1 flex gap-4 overflow-x-auto">
          {COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.key);
            return (
              <div key={col.key} className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    {col.label}
                  </h3>
                  <span className="text-xs text-zinc-600 bg-[#1C1C1F] px-2 py-0.5 rounded-full">
                    {colTasks.length}
                  </span>
                </div>
                <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-280px)]">
                  {colTasks.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => setSelectedTask(task)}
                      className="bg-[#141416] border border-[#2A2A2E] rounded-lg p-3 group cursor-pointer hover:border-indigo-500/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="text-sm text-white font-medium leading-snug">{task.title}</p>
                        <AssigneeBadge assignee={task.assignee} />
                      </div>
                      {task.description && (
                        <p className="text-xs text-zinc-500 mb-2 line-clamp-2">
                          {task.description}
                        </p>
                      )}
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLORS[task.priority]}`}
                        >
                          {task.priority}
                        </span>
                        <div className="flex items-center gap-2">
                          {(task.comments?.length || 0) > 0 && (
                            <span className="text-[10px] text-zinc-600">
                              {task.comments!.length} 💬
                            </span>
                          )}
                          <select
                            value={task.status}
                            onChange={(e) => {
                              e.stopPropagation();
                              moveTask(task.id, e.target.value as Task["status"]);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="opacity-0 group-hover:opacity-100 bg-[#1C1C1F] border border-[#2A2A2E] rounded text-xs text-zinc-400 py-0.5 px-1 outline-none transition-opacity"
                          >
                            {COLUMNS.map((c) => (
                              <option key={c.key} value={c.key}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Activity Sidebar */}
        <div className="w-64 shrink-0">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Activity
          </h3>
          <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-220px)]">
            {events.length === 0 && <p className="text-xs text-zinc-600">No events yet</p>}
            {events.map((ev, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span
                  className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                    ev.status === "ok"
                      ? "bg-green-500"
                      : ev.status === "error"
                        ? "bg-red-500"
                        : "bg-yellow-500"
                  }`}
                />
                <div className="min-w-0">
                  <span className="text-zinc-300">{ev.source}</span>
                  <span className="text-zinc-600 ml-1">
                    {new Date(ev.ts).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Task Detail Panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          projects={projects}
          onClose={() => setSelectedTask(null)}
          onUpdate={handleTaskUpdate}
        />
      )}
    </div>
  );
}
