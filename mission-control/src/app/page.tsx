"use client";

import { useEffect, useState } from "react";

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee: string;
}

interface SystemEvent {
  ts: string;
  type: string;
  status: string;
  source: string;
}

interface ServiceStatus {
  name: string;
  status: string;
  detail?: string;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) {
    return "Good morning";
  }
  if (h < 18) {
    return "Good afternoon";
  }
  return "Good evening";
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="bg-[#141416] border border-[#2A2A2E] rounded-xl p-4">
      <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ok: "bg-green-500",
    warn: "bg-yellow-500",
    error: "bg-red-500",
    unknown: "bg-zinc-500",
  };
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || colors.unknown}`} />
  );
}

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [health, setHealth] = useState<ServiceStatus[]>([]);
  const [newTask, setNewTask] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/tasks")
        .then((r) => r.json())
        .catch(() => []),
      fetch("/api/events?limit=10")
        .then((r) => r.json())
        .catch(() => []),
      fetch("/api/health")
        .then((r) => r.json())
        .catch(() => []),
    ]).then(([t, e, h]) => {
      setTasks(Array.isArray(t) ? t : []);
      setEvents(Array.isArray(e) ? e : []);
      setHealth(Array.isArray(h) ? h : []);
      setLoading(false);
    });
  }, []);

  const addTask = async () => {
    if (!newTask.trim()) {
      return;
    }
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTask }),
    });
    const task = await res.json();
    setTasks((prev) => [...prev, task]);
    setNewTask("");
  };

  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const errors24h = events.filter((e) => {
    const age = Date.now() - new Date(e.ts).getTime();
    return e.status === "error" && age < 86400000;
  }).length;

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-screen">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">{greeting()}, Tulio</h1>
        <p className="text-zinc-500 text-sm mt-1">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard label="In Progress" value={inProgress} color="text-indigo-400" />
        <StatCard
          label="Errors (24h)"
          value={errors24h}
          color={errors24h > 0 ? "text-red-400" : "text-green-400"}
        />
        <StatCard label="Total Tasks" value={tasks.length} color="text-white" />
        <div className="bg-[#141416] border border-[#2A2A2E] rounded-xl p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">System</p>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {health.map((s) => (
              <div key={s.name} className="flex items-center gap-1.5 text-xs text-zinc-400">
                <StatusDot status={s.status} />
                <span className="capitalize">{s.name}</span>
              </div>
            ))}
            {health.length === 0 && <span className="text-xs text-zinc-600">Loading...</span>}
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="flex gap-3">
          <input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            placeholder="Quick add a task..."
            className="flex-1 bg-[#141416] border border-[#2A2A2E] rounded-lg px-4 py-3 text-white text-sm outline-none focus:border-indigo-500 placeholder:text-zinc-600"
          />
          <button
            onClick={addTask}
            disabled={!newTask.trim()}
            className="bg-indigo-500 text-white px-6 py-3 rounded-lg text-sm font-medium hover:bg-indigo-600 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
          Recent Activity
        </h2>
        <div className="space-y-2">
          {events.length === 0 && (
            <p className="text-zinc-600 text-sm">
              No events yet. System activity will appear here.
            </p>
          )}
          {events.map((ev, i) => (
            <div
              key={i}
              className="flex items-center gap-3 bg-[#141416] border border-[#2A2A2E] rounded-lg px-4 py-3"
            >
              <StatusDot status={ev.status} />
              <div className="flex-1 min-w-0">
                <span className="text-sm text-white">{ev.source}</span>
                <span className="text-xs text-zinc-500 ml-2">{ev.type}</span>
              </div>
              <span className="text-xs text-zinc-600 shrink-0">
                {new Date(ev.ts).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
