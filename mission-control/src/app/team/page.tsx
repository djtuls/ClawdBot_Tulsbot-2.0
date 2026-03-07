"use client";

import { useEffect, useState } from "react";

interface ServiceStatus {
  name: string;
  status: string;
  detail?: string;
}

const MODES = [
  {
    name: "/builder",
    description: "Focused implementation mode. Writes code, runs scripts, deploys changes.",
    color: "text-indigo-400",
    bg: "bg-indigo-500/10",
  },
  {
    name: "/tulsday",
    description: "Daily operations mode. Runs briefings, syncs, manages tasks and priorities.",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
  {
    name: "/report",
    description: "Reporting mode. Generates summaries, metrics, and status updates.",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
  },
];

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ok: "bg-green-500/20 text-green-400",
    warn: "bg-yellow-500/20 text-yellow-400",
    error: "bg-red-500/20 text-red-400",
    unknown: "bg-zinc-500/20 text-zinc-400",
  };
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full ${styles[status] || styles.unknown}`}>
      {status}
    </span>
  );
}

export default function Team() {
  const [health, setHealth] = useState<ServiceStatus[]>([]);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth);
  }, []);

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-xl font-bold text-white mb-2">Team</h1>
      <p className="text-sm text-zinc-500 mb-8">Agent overview and system status</p>

      {/* Tulsbot Card */}
      <div className="bg-[#141416] border border-[#2A2A2E] rounded-xl p-6 mb-8">
        <div className="flex items-start gap-5">
          <div className="w-16 h-16 bg-indigo-500 rounded-2xl flex items-center justify-center shrink-0">
            <span className="text-3xl">🦞</span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-lg font-bold text-white">Tulsbot</h2>
              <span className="text-xs bg-indigo-500/20 text-indigo-400 px-2.5 py-1 rounded-full">
                Main Agent
              </span>
            </div>
            <p className="text-sm text-zinc-400 leading-relaxed mb-4">
              Personal AI operations agent for Tulio. Runs on the Mac Mini hub 24/7 via OpenClaw.
              Handles daily briefings, task management, code building, system maintenance, and
              domain-specific work across INFT, Live Engine, and Creative Tools.
            </p>

            {/* Mission */}
            <div className="bg-[#1C1C1F] rounded-lg p-4 mb-4">
              <h3 className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Mission</h3>
              <p className="text-sm text-zinc-300">
                Be Tulio&apos;s most reliable operating partner — proactive, context-aware, and
                always ready. Manage the day-to-day so Tulio can focus on creative and strategic
                work.
              </p>
            </div>

            {/* Capabilities */}
            <div className="flex flex-wrap gap-2 mb-4">
              {[
                "Telegram Bot",
                "Cron Jobs",
                "Code Generation",
                "Memory System",
                "Domain Knowledge",
                "System Monitoring",
              ].map((cap) => (
                <span
                  key={cap}
                  className="text-xs bg-[#1C1C1F] text-zinc-400 px-2.5 py-1 rounded-full"
                >
                  {cap}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Modes */}
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
        Behavioral Modes
      </h2>
      <div className="grid grid-cols-3 gap-4 mb-8">
        {MODES.map((mode) => (
          <div key={mode.name} className={`${mode.bg} border border-[#2A2A2E] rounded-xl p-4`}>
            <h3 className={`text-sm font-bold ${mode.color} mb-2 font-mono`}>{mode.name}</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">{mode.description}</p>
          </div>
        ))}
      </div>

      {/* System Status */}
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
        System Status
      </h2>
      <div className="grid grid-cols-2 gap-4">
        {health.map((svc) => (
          <div
            key={svc.name}
            className="bg-[#141416] border border-[#2A2A2E] rounded-xl p-4 flex items-center justify-between"
          >
            <div>
              <h3 className="text-sm font-medium text-white capitalize">{svc.name}</h3>
              <p className="text-xs text-zinc-500">{svc.detail || "—"}</p>
            </div>
            <StatusBadge status={svc.status} />
          </div>
        ))}

        {health.length === 0 && (
          <div className="col-span-2 text-center py-8">
            <p className="text-zinc-600 text-sm">Loading system status...</p>
          </div>
        )}
      </div>

      {/* Tulio Card */}
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4 mt-8">
        Operator
      </h2>
      <div className="bg-[#141416] border border-[#2A2A2E] rounded-xl p-5 flex items-center gap-4">
        <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center">
          <span className="text-emerald-400 font-bold text-lg">T</span>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white">Tulio Ferro</h3>
          <p className="text-xs text-zinc-500">Operator &amp; Owner</p>
        </div>
      </div>
    </div>
  );
}
