import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type MonitorMode = "Monitor" | "Archive" | "Ignore";

export interface CaptureGovernance {
  defaults?: Partial<Record<string, MonitorMode>>;
  email?: {
    senders?: Record<string, MonitorMode>;
    domains?: Record<string, MonitorMode>;
  };
  whatsapp?: {
    groups?: Record<string, MonitorMode>;
  };
  plaud?: {
    flows?: Record<string, MonitorMode>;
  };
}

export interface GovernanceCandidate {
  source: string;
  from?: string;
  account?: string;
  threadId?: string;
  id?: string;
}

export interface GovernanceDecision {
  skip: boolean;
  mode: MonitorMode;
  matchedOn: string;
}

const DEFAULT_GOVERNANCE: CaptureGovernance = {
  defaults: {
    email: "Monitor",
    whatsapp: "Monitor",
    plaud: "Monitor",
    notes: "Monitor",
    notion: "Monitor",
  },
};

function normalizeMode(input: unknown): MonitorMode {
  const value = String(input ?? "Monitor")
    .trim()
    .toLowerCase();
  if (value === "archive") {
    return "Archive";
  }
  if (value === "ignore") {
    return "Ignore";
  }
  return "Monitor";
}

function readRecordModes(rec: Record<string, unknown> | undefined): Record<string, MonitorMode> {
  if (!rec) {
    return {};
  }
  const out: Record<string, MonitorMode> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k.toLowerCase()] = normalizeMode(v);
  }
  return out;
}

export function loadCaptureGovernance(workspace: string): CaptureGovernance {
  const configuredPath = process.env.CAPTURE_GOVERNANCE_PATH?.trim();
  const filePath = configuredPath || join(workspace, "context", "capture-governance.json");
  if (!existsSync(filePath)) {
    return DEFAULT_GOVERNANCE;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const defaults = readRecordModes(
      (parsed.defaults as Record<string, unknown> | undefined) ?? undefined,
    );
    const email = (parsed.email as Record<string, unknown> | undefined) ?? {};
    const whatsapp = (parsed.whatsapp as Record<string, unknown> | undefined) ?? {};
    const plaud = (parsed.plaud as Record<string, unknown> | undefined) ?? {};

    return {
      defaults: { ...DEFAULT_GOVERNANCE.defaults, ...defaults },
      email: {
        senders: readRecordModes(email.senders as Record<string, unknown> | undefined),
        domains: readRecordModes(email.domains as Record<string, unknown> | undefined),
      },
      whatsapp: {
        groups: readRecordModes(whatsapp.groups as Record<string, unknown> | undefined),
      },
      plaud: {
        flows: readRecordModes(plaud.flows as Record<string, unknown> | undefined),
      },
    };
  } catch {
    return DEFAULT_GOVERNANCE;
  }
}

function modeSkips(mode: MonitorMode): boolean {
  return mode === "Archive" || mode === "Ignore";
}

function normalized(value?: string): string {
  return (value || "").trim().toLowerCase();
}

export function decideGovernance(params: {
  item: GovernanceCandidate;
  governance: CaptureGovernance;
}): GovernanceDecision {
  const source = normalized(params.item.source);
  const defaults = params.governance.defaults ?? DEFAULT_GOVERNANCE.defaults ?? {};
  const defaultMode = normalizeMode(defaults[source] ?? "Monitor");

  if (source === "email") {
    const sender = normalized(params.item.from);
    const domain = sender.includes("@") ? (sender.split("@").pop() ?? "") : "";
    const senderMode = params.governance.email?.senders?.[sender];
    if (senderMode) {
      const mode = normalizeMode(senderMode);
      return { skip: modeSkips(mode), mode, matchedOn: `email.sender:${sender}` };
    }
    if (domain) {
      const domainMode = params.governance.email?.domains?.[domain];
      if (domainMode) {
        const mode = normalizeMode(domainMode);
        return { skip: modeSkips(mode), mode, matchedOn: `email.domain:${domain}` };
      }
    }
  }

  if (source === "whatsapp") {
    const groupKey = normalized(params.item.from || params.item.threadId || params.item.id);
    if (groupKey) {
      const mode = params.governance.whatsapp?.groups?.[groupKey];
      if (mode) {
        const normalizedMode = normalizeMode(mode);
        return {
          skip: modeSkips(normalizedMode),
          mode: normalizedMode,
          matchedOn: `whatsapp.group:${groupKey}`,
        };
      }
    }
  }

  if (source === "plaud") {
    const flowKey = normalized(params.item.account || "default");
    const mode =
      params.governance.plaud?.flows?.[flowKey] ?? params.governance.plaud?.flows?.default;
    if (mode) {
      const normalizedMode = normalizeMode(mode);
      return {
        skip: modeSkips(normalizedMode),
        mode: normalizedMode,
        matchedOn: `plaud.flow:${flowKey}`,
      };
    }
  }

  return { skip: modeSkips(defaultMode), mode: defaultMode, matchedOn: `default:${source}` };
}
