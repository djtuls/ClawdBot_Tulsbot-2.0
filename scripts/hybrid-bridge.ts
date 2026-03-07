import { execFile } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { hostname, uptime } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Load .env file from the repo root so spawned openclaw inherits all API keys.
// This runs before any constants are read — critical for launchd environments.
function loadDotEnv() {
  const envPath = join("/Users/tulioferro/.openclaw", ".env");
  try {
    const lines = readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) {
        continue;
      }
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env missing is non-fatal; rely on environment variables already set
  }
}
loadDotEnv();

// Config
const BRIDGE_SECRET = process.env.BRIDGE_SECRET ?? "";
const PORT = Number(process.env.HYBRID_BRIDGE_PORT ?? 8090);
const HOST = process.env.HYBRID_BRIDGE_HOST ?? "0.0.0.0";
const AGENT_TIMEOUT_MS = Number(process.env.BRIDGE_AGENT_TIMEOUT_MS ?? 50_000);
const OPENCLAW_BIN = process.env.OPENCLAW_BIN ?? "openclaw";
const BRIDGE_ALLOW_EXEC = process.env.BRIDGE_ALLOW_EXEC === "true";
const ALLOWED_PATH_PREFIX = "/Users/tulioferro/";
const BRIDGE_VERSION = "2.0";

if (!BRIDGE_SECRET) {
  console.error(
    JSON.stringify({
      type: "fatal",
      error: "BRIDGE_SECRET env var is required",
      ts: new Date().toISOString(),
    }),
  );
  process.exit(1);
}

class AgentTimeoutError extends Error {
  constructor() {
    super("agent timed out");
    this.name = "AgentTimeoutError";
  }
}

function logJson(obj: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function checkAuth(req: IncomingMessage): boolean {
  const auth = req.headers["authorization"] ?? "";
  return auth === `Bearer ${BRIDGE_SECRET}`;
}

async function runAgent(
  sessionId: string,
  message: string,
): Promise<{ reply: string; elapsed_ms: number }> {
  const started = Date.now();

  const args = [
    "agent",
    "--agent",
    "main",
    "--session-id",
    sessionId,
    "--json",
    "--message",
    message,
  ];

  // Use Promise.race for reliable timeout regardless of platform behaviour
  const agentPromise = execFileAsync(OPENCLAW_BIN, args, {
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env },
  });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new AgentTimeoutError()), AGENT_TIMEOUT_MS).unref(),
  );

  let stdout: string;
  try {
    const result = await Promise.race([agentPromise, timeoutPromise]);
    stdout = result.stdout;
  } catch (err) {
    // Re-throw as-is (AgentTimeoutError or exec error)
    throw err;
  }

  const elapsed_ms = Date.now() - started;

  // openclaw sometimes emits warning lines to stdout before the JSON
  // (e.g. "Gateway agent failed; falling back to embedded: ...")
  // Robustly extract the JSON object starting at the first '{'
  let parsed: unknown;
  try {
    const jsonStart = stdout.indexOf("{");
    if (jsonStart === -1) {
      throw new Error("no JSON object in stdout");
    }
    parsed = JSON.parse(stdout.slice(jsonStart));
  } catch {
    throw new Error(`Failed to parse openclaw JSON output: ${stdout.slice(0, 300)}`);
  }

  // Handle both shapes: { result: { payloads } } and { payloads } (embedded fallback)
  const payloads =
    (
      parsed as {
        result?: { payloads?: Array<{ text?: string }> };
        payloads?: Array<{ text?: string }>;
      }
    )?.result?.payloads ?? (parsed as { payloads?: Array<{ text?: string }> })?.payloads;

  const text = payloads?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`Unexpected openclaw response shape: ${JSON.stringify(parsed).slice(0, 300)}`);
  }

  return { reply: text, elapsed_ms };
}

// ── Local tool implementations ──────────────────────────────────────────────

function isAllowedPath(p: string): boolean {
  const resolved = resolve(p);
  return resolved.startsWith(ALLOWED_PATH_PREFIX);
}

async function toolExecCommand(args: Record<string, unknown>): Promise<string> {
  if (!BRIDGE_ALLOW_EXEC) {
    throw Object.assign(new Error("exec_command disabled: set BRIDGE_ALLOW_EXEC=true"), {
      status: 403,
    });
  }
  const command = String(args.command ?? "");
  if (!command) {
    throw new Error("command is required");
  }
  const timeoutMs = Math.min(Number(args.timeout_ms ?? 10_000), 30_000);

  logJson({ type: "exec", command, ts: new Date().toISOString() });

  // execFileAsync with /bin/zsh -c is intentional: shell features required for exec_command.
  // BRIDGE_ALLOW_EXEC gate + BRIDGE_SECRET auth provide the security boundary.
  let stdout = "";
  let exit_code = 0;
  try {
    const result = await execFileAsync("/bin/zsh", ["-c", command], {
      cwd: "/Users/tulioferro/.openclaw",
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env },
    });
    stdout = result.stdout;
  } catch (err: unknown) {
    const e = err as { stdout?: string; code?: number; killed?: boolean };
    stdout = e.stdout ?? "";
    exit_code = e.code ?? 1;
    if (e.killed) {
      stdout += "\n[process killed: timeout]";
    }
  }
  return JSON.stringify({ stdout: stdout.slice(0, 2000), exit_code });
}

async function toolReadFile(args: Record<string, unknown>): Promise<string> {
  const p = String(args.path ?? "");
  if (!p) {
    throw new Error("path is required");
  }
  if (!isAllowedPath(p)) {
    throw Object.assign(new Error(`path not allowed: ${p}`), { status: 403 });
  }
  const content = readFileSync(resolve(p), "utf8");
  return content.slice(0, 10_000);
}

async function toolListFiles(args: Record<string, unknown>): Promise<string> {
  const p = String(args.path ?? "");
  if (!p) {
    throw new Error("path is required");
  }
  if (!isAllowedPath(p)) {
    throw Object.assign(new Error(`path not allowed: ${p}`), { status: 403 });
  }
  const pattern = args.pattern ? String(args.pattern) : undefined;
  const entries = readdirSync(resolve(p));
  const filtered = pattern ? entries.filter((e) => e.includes(pattern)) : entries;
  const results = filtered.map((name) => {
    try {
      const st = statSync(join(resolve(p), name));
      return st.isDirectory() ? `${name}/` : name;
    } catch {
      return name;
    }
  });
  return JSON.stringify(results);
}

async function toolGetNodeInfo(_args: Record<string, unknown>): Promise<string> {
  let tailscale_ip = "";
  try {
    const r = await execFileAsync("tailscale", ["ip", "-4"], { timeout: 3000 });
    tailscale_ip = r.stdout.trim();
  } catch {
    tailscale_ip = "unavailable";
  }
  return JSON.stringify({
    tailscale_ip,
    hostname: hostname(),
    uptime_seconds: Math.floor(uptime()),
    bridge_version: BRIDGE_VERSION,
  });
}

type ToolFn = (args: Record<string, unknown>) => Promise<string>;

const LOCAL_TOOLS: Record<string, ToolFn> = {
  exec_command: toolExecCommand,
  read_file: toolReadFile,
  list_files: toolListFiles,
  get_node_info: toolGetNodeInfo,
};

// ── HTTP server ──────────────────────────────────────────────────────────────

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const started = Date.now();
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  // Health check — no auth required
  if (method === "GET" && url === "/health") {
    sendJson(res, 200, { ok: true, node: "openclaw-local", ts: new Date().toISOString() });
    return;
  }

  // All other routes require auth
  if (!checkAuth(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    logJson({
      type: "req",
      ts: new Date().toISOString(),
      method,
      url,
      status: 401,
      elapsed_ms: Date.now() - started,
    });
    return;
  }

  if (method === "POST" && url === "/agent") {
    let body: string;
    try {
      body = await parseBody(req);
    } catch (err) {
      sendJson(res, 400, { error: "bad_request", detail: "Failed to read body" });
      return;
    }

    let payload: { session_id?: string; message?: string };
    try {
      payload = JSON.parse(body);
    } catch {
      sendJson(res, 400, { error: "bad_request", detail: "Invalid JSON body" });
      return;
    }

    const { session_id, message } = payload;
    if (!session_id || !message) {
      sendJson(res, 400, { error: "bad_request", detail: "session_id and message are required" });
      return;
    }

    try {
      const { reply, elapsed_ms } = await runAgent(session_id, message);
      sendJson(res, 200, { reply, elapsed_ms });
      logJson({
        type: "req",
        ts: new Date().toISOString(),
        method,
        url,
        status: 200,
        session_id,
        elapsed_ms,
      });
    } catch (err: unknown) {
      const elapsed_ms = Date.now() - started;
      const isTimeout = err instanceof AgentTimeoutError;

      if (isTimeout) {
        sendJson(res, 504, { error: "timeout" });
        logJson({
          type: "req",
          ts: new Date().toISOString(),
          method,
          url,
          status: 504,
          session_id,
          elapsed_ms,
          error: "timeout",
        });
      } else {
        const detail = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: "agent_error", detail });
        logJson({
          type: "req",
          ts: new Date().toISOString(),
          method,
          url,
          status: 500,
          session_id,
          elapsed_ms,
          error: detail,
        });
      }
    }
    return;
  }

  if (method === "POST" && url.startsWith("/tools/")) {
    const toolName = url.slice("/tools/".length);
    let body: string;
    try {
      body = await parseBody(req);
    } catch {
      sendJson(res, 400, { error: "bad_request", detail: "Failed to read body" });
      return;
    }

    let payload: { args?: Record<string, unknown> };
    try {
      payload = JSON.parse(body);
    } catch {
      sendJson(res, 400, { error: "bad_request", detail: "Invalid JSON body" });
      return;
    }

    const toolFn = LOCAL_TOOLS[toolName];
    if (!toolFn) {
      sendJson(res, 404, { error: "unknown_tool", tool: toolName });
      return;
    }

    const toolStarted = Date.now();
    try {
      const result = await toolFn(payload.args ?? {});
      const elapsed_ms = Date.now() - toolStarted;
      sendJson(res, 200, { result, elapsed_ms });
      logJson({ type: "tool", tool: toolName, ts: new Date().toISOString(), elapsed_ms });
    } catch (err: unknown) {
      const elapsed_ms = Date.now() - toolStarted;
      const status = (err as { status?: number })?.status ?? 500;
      const detail = err instanceof Error ? err.message : String(err);
      sendJson(res, status, { error: "tool_error", detail });
      logJson({
        type: "tool",
        tool: toolName,
        ts: new Date().toISOString(),
        elapsed_ms,
        error: detail,
      });
    }
    return;
  }

  sendJson(res, 404, { error: "not_found" });
});

server.listen(PORT, HOST, () => {
  logJson({ type: "start", port: PORT, host: HOST, ts: new Date().toISOString() });
});

function shutdown(signal: string) {
  logJson({ type: "shutdown", signal, ts: new Date().toISOString() });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
