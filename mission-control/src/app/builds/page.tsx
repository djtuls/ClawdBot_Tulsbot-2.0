"use client";

import { useEffect, useState } from "react";

interface BuildFile {
  name: string;
  content: string;
  mtime: number;
}

interface BuildsData {
  queue: BuildFile[];
  active: BuildFile[];
  done: BuildFile[];
}

function statusColor(section: "queue" | "active" | "done") {
  if (section === "active") {
    return "bg-indigo-500/20 text-indigo-400 border-indigo-500/30";
  }
  if (section === "done") {
    return "bg-green-500/20 text-green-400 border-green-500/30";
  }
  return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
}

function statusDot(section: "queue" | "active" | "done") {
  if (section === "active") {
    return "bg-indigo-400 animate-pulse";
  }
  if (section === "done") {
    return "bg-green-400";
  }
  return "bg-zinc-500";
}

function statusLabel(section: "queue" | "active" | "done") {
  if (section === "active") {
    return "Building";
  }
  if (section === "done") {
    return "Done";
  }
  return "Queued";
}

function projectName(filename: string) {
  return filename
    .replace(/\.spec\.md$/, "")
    .replace(/\.md$/, "")
    .replace(/-\d{8,}$/, "")
    .replace(/-/g, " ");
}

function timeAgo(mtime: number) {
  const diff = Date.now() - mtime;
  if (diff < 60000) {
    return "just now";
  }
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}m ago`;
  }
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}h ago`;
  }
  return `${Math.floor(diff / 86400000)}d ago`;
}

function BuildCard({ file, section }: { file: BuildFile; section: "queue" | "active" | "done" }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={`rounded-lg border p-4 cursor-pointer transition-all ${statusColor(section)}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(section)}`} />
        <div className="flex-1 min-w-0">
          <p className="font-medium capitalize truncate">{projectName(file.name)}</p>
          <p className="text-xs opacity-60 mt-0.5">{timeAgo(file.mtime)}</p>
        </div>
        <span className="text-xs font-medium opacity-80 flex-shrink-0">{statusLabel(section)}</span>
      </div>
      {expanded && (
        <pre className="mt-3 text-xs font-mono whitespace-pre-wrap opacity-70 border-t border-current/20 pt-3">
          {file.content}
          {file.content.length >= 500 ? "\n…" : ""}
        </pre>
      )}
    </div>
  );
}

function Section({
  title,
  files,
  section,
  empty,
}: {
  title: string;
  files: BuildFile[];
  section: "queue" | "active" | "done";
  empty: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">{title}</h2>
        {files.length > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">
            {files.length}
          </span>
        )}
      </div>
      {files.length === 0 ? (
        <p className="text-sm text-zinc-600 italic">{empty}</p>
      ) : (
        <div className="space-y-2">
          {files.map((f) => (
            <BuildCard key={f.name} file={f} section={section} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function BuildsPage() {
  const [data, setData] = useState<BuildsData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    fetch("/api/builds")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-screen">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Builds</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Builder agent queue on Mac Mini</p>
        </div>
        <button
          onClick={refresh}
          className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="space-y-8">
        <Section
          title="Active"
          files={data?.active ?? []}
          section="active"
          empty="Nothing building right now."
        />
        <Section
          title="Queue"
          files={data?.queue ?? []}
          section="queue"
          empty="Queue is empty. Send /build to Tulsbot."
        />
        <Section
          title="Completed"
          files={data?.done ?? []}
          section="done"
          empty="No completed builds yet."
        />
      </div>
    </div>
  );
}
