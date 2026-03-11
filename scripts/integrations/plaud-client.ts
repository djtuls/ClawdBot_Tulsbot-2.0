import { getSecret } from "../lib/secrets.js";

export interface PlaudRecording {
  id: string;
  filename: string;
  start_time: number;
  end_time: number;
  duration: number;
  is_trans: boolean;
  is_summary: boolean;
  wait_pull: number;
  scene?: number;
}

function authHeader(): string {
  const token = (getSecret("PLAUD_TOKEN") || "").trim();
  if (!token) {
    throw new Error("Missing PLAUD_TOKEN");
  }
  return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
}

function domain(): string {
  return (getSecret("PLAUD_API_DOMAIN") || "api.plaud.ai").trim();
}

async function apiGet(path: string): Promise<any> {
  const res = await fetch(`https://${domain()}${path}`, {
    headers: {
      authorization: authHeader(),
      "app-platform": "web",
      "edit-from": "web",
      accept: "application/json",
    },
  } as any);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : null;
}

export async function listRecentRecordings(limit = 20): Promise<PlaudRecording[]> {
  const data = await apiGet(
    `/file/simple/web?skip=0&limit=${Math.max(1, Math.min(limit, 100))}&is_trash=0&sort_by=start_time&is_desc=true`,
  );
  const list = Array.isArray(data?.data_file_list) ? data.data_file_list : [];
  return list.map((r: any) => ({
    id: String(r.id || ""),
    filename: String(r.filename || ""),
    start_time: Number(r.start_time || 0),
    end_time: Number(r.end_time || 0),
    duration: Number(r.duration || 0),
    is_trans: Boolean(r.is_trans),
    is_summary: Boolean(r.is_summary),
    wait_pull: Number(r.wait_pull || 0),
    scene: Number(r.scene || 0),
  }));
}

function formatTranscriptRows(rows: any[]): string {
  return rows
    .map((r) => {
      const s = Number(r?.start_time || 0);
      const mm = Math.floor(s / 60000);
      const ss = Math.floor((s % 60000) / 1000)
        .toString()
        .padStart(2, "0");
      const speaker = String(r?.speaker || r?.original_speaker || "Speaker");
      const content = String(r?.content || "").trim();
      return `[${mm}:${ss}] ${speaker}: ${content}`;
    })
    .filter((x) => x.length > 0)
    .join("\n");
}

export async function getTranscriptRaw(recordingId: string): Promise<string | null> {
  const res = await fetch(`https://${domain()}/ai/transsumm/${recordingId}`, {
    method: "POST",
    headers: {
      authorization: authHeader(),
      "app-platform": "web",
      "edit-from": "web",
      accept: "application/json, text/plain, */*",
      "content-type": "application/json;charset=UTF-8",
      "app-language": "en",
      timezone: "Australia/Sydney",
    } as any,
    body: JSON.stringify({}),
  } as any);

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const payload = text ? JSON.parse(text) : null;
  const rows = Array.isArray(payload?.data_result) ? payload.data_result : [];
  if (!rows.length) {
    return null;
  }
  return formatTranscriptRows(rows);
}
