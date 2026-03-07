import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { CaptureInboxConfig, DEFAULT_CAPTURE_INBOX_CONFIG } from "@/lib/captureInboxSchema";
import { wsPath } from "@/lib/workspace";

function configPath() {
  return wsPath("memory", "capture-inbox-config.json");
}

export function readCaptureInboxConfig(): CaptureInboxConfig {
  const path = configPath();
  const dir = wsPath("memory");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (!existsSync(path)) {
    writeFileSync(
      path,
      JSON.stringify(
        { ...DEFAULT_CAPTURE_INBOX_CONFIG, updatedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
    return { ...DEFAULT_CAPTURE_INBOX_CONFIG };
  }

  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return {
      ...DEFAULT_CAPTURE_INBOX_CONFIG,
      ...raw,
      sources: { ...DEFAULT_CAPTURE_INBOX_CONFIG.sources, ...raw.sources },
      flow: { ...DEFAULT_CAPTURE_INBOX_CONFIG.flow, ...raw.flow },
      routing: { ...DEFAULT_CAPTURE_INBOX_CONFIG.routing, ...raw.routing },
      rules: Array.isArray(raw.rules) ? raw.rules : DEFAULT_CAPTURE_INBOX_CONFIG.rules,
      contexts: Array.isArray(raw.contexts) ? raw.contexts : DEFAULT_CAPTURE_INBOX_CONFIG.contexts,
    } as CaptureInboxConfig;
  } catch {
    return { ...DEFAULT_CAPTURE_INBOX_CONFIG };
  }
}

export function writeCaptureInboxConfig(config: CaptureInboxConfig): CaptureInboxConfig {
  const merged: CaptureInboxConfig = {
    ...DEFAULT_CAPTURE_INBOX_CONFIG,
    ...config,
    sources: { ...DEFAULT_CAPTURE_INBOX_CONFIG.sources, ...config.sources },
    flow: { ...DEFAULT_CAPTURE_INBOX_CONFIG.flow, ...config.flow },
    routing: { ...DEFAULT_CAPTURE_INBOX_CONFIG.routing, ...config.routing },
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(configPath(), JSON.stringify(merged, null, 2));
  return merged;
}
