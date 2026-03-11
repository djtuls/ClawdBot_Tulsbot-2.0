import { execFileSync } from "node:child_process";

export interface CalendarEventLite {
  account: string;
  id: string;
  summary: string;
  start: string;
  end?: string;
}

function runGog(account: string, days = 2): CalendarEventLite[] {
  const raw = execFileSync(
    "gog",
    [
      "calendar",
      "list",
      "--account",
      account,
      "--days",
      String(days),
      "--max",
      "20",
      "--json",
      "--results-only",
      "--no-input",
    ],
    { encoding: "utf8", timeout: 20_000 },
  ).trim();

  if (!raw || raw === "null" || raw === "[]") {
    return [];
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr
    .map((e) => ({
      account,
      id: String(e.id || ""),
      summary: String(e.summary || "(No title)"),
      start: String(e.start?.dateTime || e.start?.date || ""),
      end: String(e.end?.dateTime || e.end?.date || ""),
    }))
    .filter((e) => e.id && e.start);
}

export function loadCalendarAccounts(): string[] {
  const list = [
    process.env.GOG_ACCOUNT,
    process.env.GOG_ACCOUNT_SECONDARY,
    process.env.GOG_ACCOUNT_PERSONAL,
  ]
    .filter(Boolean)
    .map((s) => String(s).trim());
  return [...new Set(list)];
}

export function fetchUpcomingEvents(days = 2): CalendarEventLite[] {
  const accounts = loadCalendarAccounts();
  const out: CalendarEventLite[] = [];
  for (const acc of accounts) {
    try {
      out.push(...runGog(acc, days));
    } catch {
      // Keep brief resilient even if one account fails
    }
  }
  return out.toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
