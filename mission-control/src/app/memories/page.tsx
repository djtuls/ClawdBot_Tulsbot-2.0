"use client";

import { useEffect, useState } from "react";

interface MemoryEntry {
  type: "daily" | "handoff" | "learnings";
  filename: string;
  content: string;
  date?: string;
  size: number;
}

const TYPE_STYLES: Record<string, { badge: string; icon: string }> = {
  handoff: { badge: "bg-indigo-500/20 text-indigo-400", icon: "→" },
  learnings: { badge: "bg-amber-500/20 text-amber-400", icon: "💡" },
  daily: { badge: "bg-zinc-500/20 text-zinc-400", icon: "📝" },
};

export default function Memories() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/memories")
      .then((r) => r.json())
      .then(setEntries);
  }, []);

  const filtered = search
    ? entries.filter(
        (e) =>
          e.filename.toLowerCase().includes(search.toLowerCase()) ||
          e.content.toLowerCase().includes(search.toLowerCase()),
      )
    : entries;

  function formatSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-bold text-white">Memories</h1>
      </div>
      <p className="text-sm text-zinc-500 mb-6">Daily journals, session handoffs, and learnings</p>

      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search memories..."
        className="w-full bg-[#141416] border border-[#2A2A2E] rounded-lg px-4 py-3 text-white text-sm outline-none focus:border-indigo-500 placeholder:text-zinc-600 mb-6"
      />

      {/* Entries */}
      <div className="space-y-3">
        {filtered.map((entry) => {
          const style = TYPE_STYLES[entry.type] || TYPE_STYLES.daily;
          const isOpen = expanded === entry.filename;
          const preview = entry.content
            .split("\n")
            .filter(Boolean)
            .slice(0, 3)
            .join(" ")
            .slice(0, 200);

          return (
            <div
              key={entry.filename}
              className="bg-[#141416] border border-[#2A2A2E] rounded-xl overflow-hidden"
            >
              <button
                onClick={() => setExpanded(isOpen ? null : entry.filename)}
                className="w-full px-5 py-4 flex items-center gap-4 text-left hover:bg-[#1A1A1D] transition-colors"
              >
                <span className="text-lg">{style.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-sm font-medium text-white truncate">{entry.filename}</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${style.badge}`}>
                      {entry.type}
                    </span>
                  </div>
                  {!isOpen && <p className="text-xs text-zinc-500 truncate">{preview}</p>}
                </div>
                <span className="text-xs text-zinc-600 shrink-0">{formatSize(entry.size)}</span>
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
                  <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed mt-4 max-h-96 overflow-y-auto">
                    {entry.content}
                  </pre>
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <p className="text-zinc-600 text-sm text-center py-12">
            {search ? "No memories match your search." : "No memories found."}
          </p>
        )}
      </div>
    </div>
  );
}
