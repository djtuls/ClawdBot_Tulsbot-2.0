import { readFileSync, existsSync, statSync } from "fs";
import { NextResponse } from "next/server";
import { wsPath } from "@/lib/workspace";

interface ServiceStatus {
  name: string;
  status: "ok" | "warn" | "error" | "unknown";
  detail?: string;
}

async function checkUrl(url: string, timeout = 3000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

export async function GET() {
  const services: ServiceStatus[] = [];

  // Gateway
  const gwOk = await checkUrl("http://localhost:18891/health");
  services.push({
    name: "gateway",
    status: gwOk ? "ok" : "error",
    detail: gwOk ? "Responding" : "Unreachable",
  });

  // Ollama
  const ollamaOk = await checkUrl("http://localhost:11434/api/tags");
  services.push({
    name: "ollama",
    status: ollamaOk ? "ok" : "warn",
    detail: ollamaOk ? "Running" : "Offline",
  });

  // Heartbeat (last event-log entry)
  const logPath = wsPath("memory", "event-log.jsonl");
  if (existsSync(logPath)) {
    const raw = readFileSync(logPath, "utf-8").trim();
    const lines = raw.split("\n").filter(Boolean);
    const last = lines.length > 0 ? JSON.parse(lines[lines.length - 1]) : null;
    if (last) {
      const age = Date.now() - new Date(last.ts).getTime();
      const hourMs = 60 * 60 * 1000;
      services.push({
        name: "heartbeat",
        status: age < 2 * hourMs ? "ok" : age < 4 * hourMs ? "warn" : "error",
        detail: `Last event ${Math.round(age / 60000)}m ago`,
      });
    } else {
      services.push({ name: "heartbeat", status: "unknown", detail: "No events" });
    }
  } else {
    services.push({ name: "heartbeat", status: "unknown", detail: "No log file" });
  }

  // Tunnel (check if cloudflared running)
  const tunnelOk = await checkUrl("http://localhost:3000/login");
  services.push({
    name: "tunnel",
    status: tunnelOk ? "ok" : "warn",
    detail: tunnelOk ? "Reachable" : "May be down",
  });

  return NextResponse.json(services);
}
