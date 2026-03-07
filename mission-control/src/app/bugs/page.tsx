"use client";

import { useEffect, useState } from "react";

type BugRecord = {
  id: string;
  ts: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "investigating" | "resolved";
  source: string;
  title: string;
  details?: string;
  needsHuman?: boolean;
};

export default function BugsPage() {
  const [bugs, setBugs] = useState<BugRecord[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch("/api/bugs?limit=200", { cache: "no-store" });
    const json = await res.json();
    setBugs(Array.isArray(json) ? json : []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const critical = bugs.filter((b) => b.severity === "critical" && b.status !== "resolved").length;

  return (
    <div className="p-8 max-w-6xl space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Bugs & Failures</h1>
          <p className="text-sm text-zinc-500">
            Durable bug log for cron failures, runtime errors, and self-heal incidents.
          </p>
        </div>
        <button onClick={load} className="px-3 py-2 rounded-lg text-sm bg-zinc-800 text-zinc-200">
          Refresh
        </button>
      </div>

      <div className="bg-[#141416] border border-[#2A2A2E] rounded-lg p-3 text-sm text-zinc-300">
        Open critical issues: <span className="text-red-300 font-semibold">{critical}</span>
      </div>

      {loading ? <p className="text-zinc-400">Loading…</p> : null}

      <div className="space-y-2">
        {bugs.map((b) => (
          <div key={b.id} className="bg-[#141416] border border-[#2A2A2E] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs px-2 py-0.5 rounded ${badge(b.severity)}`}>
                {b.severity}
              </span>
              <span className="text-xs text-zinc-500">{b.status}</span>
              {b.needsHuman ? <span className="text-xs text-amber-300">needs human</span> : null}
            </div>
            <p className="text-white text-sm font-medium">{b.title}</p>
            <p className="text-zinc-400 text-xs mt-1">
              {b.source} · {new Date(b.ts).toLocaleString()}
            </p>
            {b.details ? <p className="text-zinc-300 text-sm mt-2">{b.details}</p> : null}
          </div>
        ))}
        {!loading && bugs.length === 0 ? (
          <p className="text-zinc-600">No bugs logged yet.</p>
        ) : null}
      </div>
    </div>
  );
}

function badge(sev: string) {
  if (sev === "critical") {
    return "bg-red-500/20 text-red-300";
  }
  if (sev === "high") {
    return "bg-amber-500/20 text-amber-300";
  }
  if (sev === "medium") {
    return "bg-blue-500/20 text-blue-300";
  }
  return "bg-zinc-700/40 text-zinc-300";
}
