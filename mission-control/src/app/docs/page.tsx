"use client";

import { useEffect, useState } from "react";

interface DocEntry {
  filename: string;
  size: number;
  modifiedAt: string;
  content?: string;
}

const DOC_ICONS: Record<string, string> = {
  "RUNBOOK.md": "📋",
  "SOUL.md": "🧠",
  "STATE.md": "📡",
  "TODO.md": "✅",
  "ROADMAP.md": "🗺️",
  "COMMANDS.md": "⌨️",
  "AGENTS.md": "🤖",
  "IDENTITY.md": "🪪",
  "USER.md": "👤",
};

const DOC_DESCRIPTIONS: Record<string, string> = {
  "RUNBOOK.md": "Operating procedures, boot sequence, cron schedule",
  "SOUL.md": "Identity, mission, persona, behavioral modes",
  "STATE.md": "Current operational state snapshot",
  "TODO.md": "Active task list and priorities",
  "ROADMAP.md": "Vision, phases, and strategic backlog",
  "COMMANDS.md": "Telegram command handlers reference",
  "AGENTS.md": "Boot instructions and agent configuration",
  "IDENTITY.md": "Core identity and self-awareness",
  "USER.md": "Operator context and preferences",
};

export default function Docs() {
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loadedContent, setLoadedContent] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/docs")
      .then((r) => r.json())
      .then(setDocs);
  }, []);

  const toggleDoc = async (filename: string) => {
    if (expanded === filename) {
      setExpanded(null);
      return;
    }
    setExpanded(filename);
    if (!loadedContent[filename]) {
      const res = await fetch(`/api/docs?file=${filename}`);
      const data = await res.json();
      setLoadedContent((prev) => ({ ...prev, [filename]: data.content || "" }));
    }
  };

  function formatSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) {
      return `${mins}m ago`;
    }
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) {
      return `${hrs}h ago`;
    }
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  const filtered = search
    ? docs.filter(
        (d) =>
          d.filename.toLowerCase().includes(search.toLowerCase()) ||
          (DOC_DESCRIPTIONS[d.filename] || "").toLowerCase().includes(search.toLowerCase()),
      )
    : docs;

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-xl font-bold text-white mb-2">Docs</h1>
      <p className="text-sm text-zinc-500 mb-6">Core operating system documents</p>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search documents..."
        className="w-full bg-[#141416] border border-[#2A2A2E] rounded-lg px-4 py-3 text-white text-sm outline-none focus:border-indigo-500 placeholder:text-zinc-600 mb-6"
      />

      <div className="space-y-3">
        {filtered.map((doc) => {
          const isOpen = expanded === doc.filename;
          return (
            <div
              key={doc.filename}
              className="bg-[#141416] border border-[#2A2A2E] rounded-xl overflow-hidden"
            >
              <button
                onClick={() => toggleDoc(doc.filename)}
                className="w-full px-5 py-4 flex items-center gap-4 text-left hover:bg-[#1A1A1D] transition-colors"
              >
                <span className="text-lg">{DOC_ICONS[doc.filename] || "📄"}</span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-white">{doc.filename}</h3>
                  <p className="text-xs text-zinc-500">{DOC_DESCRIPTIONS[doc.filename] || ""}</p>
                </div>
                <div className="flex items-center gap-4 text-xs text-zinc-600 shrink-0">
                  <span>{formatSize(doc.size)}</span>
                  <span>{timeAgo(doc.modifiedAt)}</span>
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
              </button>
              {isOpen && (
                <div className="px-5 pb-5 border-t border-[#2A2A2E]">
                  <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed mt-4 max-h-[500px] overflow-y-auto">
                    {loadedContent[doc.filename] || "Loading..."}
                  </pre>
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <p className="text-zinc-600 text-sm text-center py-12">
            {search ? "No docs match your search." : "No documents found."}
          </p>
        )}
      </div>
    </div>
  );
}
