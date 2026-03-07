"use client";

import { useEffect, useState } from "react";

interface SystemEvent {
  ts: string;
  type: string;
  status: string;
  source: string;
}

interface CronJob {
  name: string;
  schedule: string;
  description: string;
  type: "heartbeat" | "sync" | "maintenance" | "security" | "report";
  hours: number[];
}

const CRON_JOBS: CronJob[] = [
  {
    name: "Heartbeat (Hourly)",
    schedule: "Every hour",
    description: "10-step system health check",
    type: "heartbeat",
    hours: Array.from({ length: 24 }, (_, i) => i),
  },
  {
    name: "Morning Brief",
    schedule: "7:00 AM",
    description: "Daily priorities and agenda",
    type: "report",
    hours: [7],
  },
  {
    name: "Midday Sync",
    schedule: "12:00 PM",
    description: "Midday progress check",
    type: "sync",
    hours: [12],
  },
  {
    name: "Evening Report",
    schedule: "7:00 PM",
    description: "End-of-day summary",
    type: "report",
    hours: [19],
  },
  {
    name: "Nightly Maintenance",
    schedule: "2:00 AM",
    description: "Log rotation, cleanup",
    type: "maintenance",
    hours: [2],
  },
  {
    name: "Security Scan",
    schedule: "3:00 AM",
    description: "Token validation, dependency check",
    type: "security",
    hours: [3],
  },
  {
    name: "Backup to Drive",
    schedule: "4:00 AM",
    description: "Workspace backup",
    type: "maintenance",
    hours: [4],
  },
  {
    name: "Log Rotation",
    schedule: "1:00 AM",
    description: "Archive old event logs",
    type: "maintenance",
    hours: [1],
  },
  {
    name: "Weekly Review",
    schedule: "Sun 10:00 AM",
    description: "Weekly metrics summary",
    type: "report",
    hours: [10],
  },
];

const TYPE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  heartbeat: { bg: "bg-green-500/10", text: "text-green-400", dot: "bg-green-500" },
  sync: { bg: "bg-blue-500/10", text: "text-blue-400", dot: "bg-blue-500" },
  report: { bg: "bg-blue-500/10", text: "text-blue-400", dot: "bg-blue-500" },
  maintenance: { bg: "bg-purple-500/10", text: "text-purple-400", dot: "bg-purple-500" },
  security: { bg: "bg-red-500/10", text: "text-red-400", dot: "bg-red-500" },
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function Calendar() {
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const currentHour = new Date().getHours();

  useEffect(() => {
    fetch("/api/events?limit=200")
      .then((r) => r.json())
      .then(setEvents);
  }, []);

  function lastRunStatus(jobName: string): { status: string; time: string } | null {
    const match = events.find((e) =>
      e.source.toLowerCase().includes(jobName.toLowerCase().split(" ")[0]),
    );
    if (!match) {
      return null;
    }
    return {
      status: match.status,
      time: new Date(match.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    };
  }

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-xl font-bold text-white mb-2">Calendar</h1>
      <p className="text-sm text-zinc-500 mb-8">Cron job schedule and execution status</p>

      {/* Legend */}
      <div className="flex gap-6 mb-6">
        {Object.entries(TYPE_COLORS).map(([type, colors]) => (
          <div key={type} className="flex items-center gap-2 text-xs">
            <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
            <span className="text-zinc-400 capitalize">{type}</span>
          </div>
        ))}
      </div>

      {/* Schedule Grid */}
      <div className="bg-[#141416] border border-[#2A2A2E] rounded-xl overflow-hidden">
        {/* Hour headers */}
        <div className="grid grid-cols-[200px_repeat(24,1fr)] border-b border-[#2A2A2E]">
          <div className="px-4 py-2 text-xs text-zinc-600">Job</div>
          {HOURS.map((h) => (
            <div
              key={h}
              className={`text-center py-2 text-xs ${h === currentHour ? "text-indigo-400 font-bold bg-indigo-500/5" : "text-zinc-600"}`}
            >
              {h.toString().padStart(2, "0")}
            </div>
          ))}
        </div>

        {/* Job rows */}
        {CRON_JOBS.map((job) => {
          const colors = TYPE_COLORS[job.type];
          const lastRun = lastRunStatus(job.name);
          return (
            <div
              key={job.name}
              className="grid grid-cols-[200px_repeat(24,1fr)] border-b border-[#2A2A2E] last:border-b-0 hover:bg-[#1A1A1D]"
            >
              <div className="px-4 py-3">
                <p className={`text-xs font-medium ${colors.text}`}>{job.name}</p>
                <p className="text-[10px] text-zinc-600">{job.schedule}</p>
                {lastRun && (
                  <p className="text-[10px] text-zinc-600 mt-0.5">
                    Last:{" "}
                    <span className={lastRun.status === "ok" ? "text-green-500" : "text-red-500"}>
                      {lastRun.status}
                    </span>{" "}
                    at {lastRun.time}
                  </p>
                )}
              </div>
              {HOURS.map((h) => {
                const active = job.hours.includes(h);
                return (
                  <div
                    key={h}
                    className={`flex items-center justify-center ${h === currentHour ? "bg-indigo-500/5" : ""}`}
                  >
                    {active && <span className={`w-2 h-2 rounded-full ${colors.dot}`} />}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Job Detail Cards */}
      <div className="grid grid-cols-3 gap-4 mt-8">
        {CRON_JOBS.map((job) => {
          const colors = TYPE_COLORS[job.type];
          const lastRun = lastRunStatus(job.name);
          return (
            <div key={job.name} className={`${colors.bg} border border-[#2A2A2E] rounded-xl p-4`}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                <h3 className={`text-sm font-semibold ${colors.text}`}>{job.name}</h3>
              </div>
              <p className="text-xs text-zinc-400 mb-1">{job.description}</p>
              <p className="text-xs text-zinc-600">{job.schedule}</p>
              {lastRun && (
                <p className="text-xs text-zinc-500 mt-2">
                  Last run:{" "}
                  <span className={lastRun.status === "ok" ? "text-green-400" : "text-red-400"}>
                    {lastRun.status}
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
