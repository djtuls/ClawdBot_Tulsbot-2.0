"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CaptureInboxConfig,
  DEFAULT_CAPTURE_INBOX_CONFIG,
  ProjectContext,
  Rule,
} from "@/lib/captureInboxSchema";

export default function CaptureInboxPage() {
  const [config, setConfig] = useState<CaptureInboxConfig>(DEFAULT_CAPTURE_INBOX_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/capture-inbox/config", { cache: "no-store" });
        const json = await res.json();
        setConfig({ ...DEFAULT_CAPTURE_INBOX_CONFIG, ...json });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const enabledRules = useMemo(() => config.rules.filter((r) => r.enabled).length, [config.rules]);
  const enabledContexts = useMemo(
    () => config.contexts.filter((c) => c.enabled).length,
    [config.contexts],
  );

  async function saveConfig() {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch("/api/capture-inbox/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const json = await res.json();
      setConfig(json);
      setSaveMsg("Saved");
    } catch {
      setSaveMsg("Save failed");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 1800);
    }
  }

  if (loading) {
    return <div className="p-8 text-zinc-400">Loading Capture Inbox config…</div>;
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white mb-2">Capture Inbox OS</h1>
          <p className="text-sm text-zinc-500">
            Command center for inbox automation, HITL triage, and context routing into HubSpot /
            Notion / notes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={saveConfig}
            disabled={saving}
            className="px-3 py-2 rounded-lg text-sm bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save config"}
          </button>
          {saveMsg ? <span className="text-xs text-zinc-400">{saveMsg}</span> : null}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <StatCard label="Enabled rules" value={String(enabledRules)} />
        <StatCard label="Project contexts" value={String(enabledContexts)} />
        <StatCard
          label="HITL threshold"
          value={`${Math.round(config.flow.hitlThreshold * 100)}%`}
        />
        <StatCard label="Auto-archive" value={config.flow.autoArchive ? "ON" : "OFF"} />
        <StatCard
          label="Routing targets"
          value={`${Object.values(config.routing).filter(Boolean).length}/5`}
        />
      </div>

      <section className="bg-[#141416] border border-[#2A2A2E] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Source Connectors</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ToggleRow
            label="Email inboxes"
            value={config.sources.email}
            onChange={(v) => setConfig((c) => ({ ...c, sources: { ...c.sources, email: v } }))}
          />
          <ToggleRow
            label="WhatsApp (wacli)"
            value={config.sources.whatsapp}
            onChange={(v) => setConfig((c) => ({ ...c, sources: { ...c.sources, whatsapp: v } }))}
          />
          <ToggleRow
            label="Notion requests"
            value={config.sources.notionRequests}
            onChange={(v) =>
              setConfig((c) => ({ ...c, sources: { ...c.sources, notionRequests: v } }))
            }
          />
          <ToggleRow
            label="Notes / requests capture"
            value={config.sources.notes}
            onChange={(v) => setConfig((c) => ({ ...c, sources: { ...c.sources, notes: v } }))}
          />
          <ToggleRow
            label="PLAUD pipeline"
            value={config.sources.plaud}
            onChange={(v) => setConfig((c) => ({ ...c, sources: { ...c.sources, plaud: v } }))}
          />
        </div>
      </section>

      <section className="bg-[#141416] border border-[#2A2A2E] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Flow Controls</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ToggleRow
            label="Auto-archive low-value items"
            value={config.flow.autoArchive}
            onChange={(v) => setConfig((c) => ({ ...c, flow: { ...c.flow, autoArchive: v } }))}
          />
          <div>
            <label className="text-xs text-zinc-500 block mb-2">HITL confidence threshold</label>
            <input
              type="range"
              min={0.5}
              max={0.95}
              step={0.01}
              value={config.flow.hitlThreshold}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  flow: { ...c.flow, hitlThreshold: Number(e.target.value) },
                }))
              }
              className="w-full"
            />
            <p className="text-xs text-zinc-400 mt-1">
              Items below this confidence go to human triage queue.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-[#141416] border border-[#2A2A2E] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Routing Targets</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ToggleRow
            label="Route to HubSpot (CRM source of truth)"
            value={config.routing.hubspot}
            onChange={(v) => setConfig((c) => ({ ...c, routing: { ...c.routing, hubspot: v } }))}
          />
          <ToggleRow
            label="Route to Notion Tasks"
            value={config.routing.notionTasks}
            onChange={(v) =>
              setConfig((c) => ({ ...c, routing: { ...c.routing, notionTasks: v } }))
            }
          />
          <ToggleRow
            label="Route to Notes / Requests"
            value={config.routing.notes}
            onChange={(v) => setConfig((c) => ({ ...c, routing: { ...c.routing, notes: v } }))}
          />
          <ToggleRow
            label="Route to PLAUD pipeline"
            value={config.routing.plaud}
            onChange={(v) => setConfig((c) => ({ ...c, routing: { ...c.routing, plaud: v } }))}
          />
          <ToggleRow
            label="Generate meeting briefs"
            value={config.routing.meetingBriefs}
            onChange={(v) =>
              setConfig((c) => ({ ...c, routing: { ...c.routing, meetingBriefs: v } }))
            }
          />
        </div>
      </section>

      <RuleTable rules={config.rules} setRules={(rules) => setConfig((c) => ({ ...c, rules }))} />
      <ContextTable
        contexts={config.contexts}
        setContexts={(contexts) => setConfig((c) => ({ ...c, contexts }))}
      />

      <p className="text-xs text-zinc-600">
        Persisted config path: memory/capture-inbox-config.json. Next step: wiring workers to these
        saved controls.
      </p>
    </div>
  );
}

function RuleTable({ rules, setRules }: { rules: Rule[]; setRules: (rules: Rule[]) => void }) {
  return (
    <section className="bg-[#141416] border border-[#2A2A2E] rounded-xl p-5">
      <h2 className="text-sm font-semibold text-white mb-4">Rule Matrix (Classification)</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500 border-b border-[#2A2A2E]">
              <th className="py-2 pr-3">Rule</th>
              <th className="py-2 pr-3">Condition</th>
              <th className="py-2 pr-3">Action</th>
              <th className="py-2 pr-3">Project Context</th>
              <th className="py-2 pr-3">Min Conf.</th>
              <th className="py-2">On/Off</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-b border-[#222227]">
                <td className="py-3 pr-3 text-white">{r.name}</td>
                <td className="py-3 pr-3 text-zinc-300">{r.condition}</td>
                <td className="py-3 pr-3 text-zinc-300">{r.action}</td>
                <td className="py-3 pr-3 text-indigo-300">{r.projectContext}</td>
                <td className="py-3 pr-3 text-zinc-300">{Math.round(r.confidence * 100)}%</td>
                <td className="py-3">
                  <button
                    onClick={() =>
                      setRules(
                        rules.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)),
                      )
                    }
                    className={`px-2 py-1 rounded text-xs ${r.enabled ? "bg-green-500/20 text-green-300" : "bg-zinc-700/40 text-zinc-400"}`}
                  >
                    {r.enabled ? "Enabled" : "Disabled"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ContextTable({
  contexts,
  setContexts,
}: {
  contexts: ProjectContext[];
  setContexts: (ctx: ProjectContext[]) => void;
}) {
  return (
    <section className="bg-[#141416] border border-[#2A2A2E] rounded-xl p-5">
      <h2 className="text-sm font-semibold text-white mb-4">Project Context Assignment</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500 border-b border-[#2A2A2E]">
              <th className="py-2 pr-3">Project</th>
              <th className="py-2 pr-3">Keyword set</th>
              <th className="py-2 pr-3">Destination flow</th>
              <th className="py-2 pr-3">Owner</th>
              <th className="py-2">On/Off</th>
            </tr>
          </thead>
          <tbody>
            {contexts.map((c) => (
              <tr key={c.id} className="border-b border-[#222227]">
                <td className="py-3 pr-3 text-white">{c.project}</td>
                <td className="py-3 pr-3 text-zinc-300">{c.keywords}</td>
                <td className="py-3 pr-3 text-indigo-300">{c.destination}</td>
                <td className="py-3 pr-3 text-zinc-300">{c.owner}</td>
                <td className="py-3">
                  <button
                    onClick={() =>
                      setContexts(
                        contexts.map((x) => (x.id === c.id ? { ...x, enabled: !x.enabled } : x)),
                      )
                    }
                    className={`px-2 py-1 rounded text-xs ${c.enabled ? "bg-green-500/20 text-green-300" : "bg-zinc-700/40 text-zinc-400"}`}
                  >
                    {c.enabled ? "Enabled" : "Disabled"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#141416] border border-[#2A2A2E] rounded-lg p-3">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className="text-lg text-white font-semibold">{value}</p>
    </div>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between bg-[#1A1A1D] border border-[#2A2A2E] rounded-lg px-3 py-2">
      <span className="text-sm text-zinc-300">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={`px-2 py-1 rounded text-xs ${value ? "bg-green-500/20 text-green-300" : "bg-zinc-700/40 text-zinc-400"}`}
      >
        {value ? "ON" : "OFF"}
      </button>
    </div>
  );
}
