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

// Placeholder until we capture exact transcript endpoint from Network.
export async function getTranscriptRaw(_recordingId: string): Promise<string | null> {
  return null;
}
