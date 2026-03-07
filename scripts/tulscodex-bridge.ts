import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";

type Role = "codex" | "captain";

type BridgeHello = {
  type: "hello";
  role: Role;
  clientId: string;
};

type BridgeMsg =
  | BridgeHello
  | {
      type: "msg";
      from?: string;
      to?: string;
      thread?: string;
      text: string;
      ts?: string;
    }
  | {
      type: "ping";
    }
  | { type: "pong" };

const PORT = Number(process.env.TULSCODEX_BRIDGE_PORT || 18910);
const LOG_PATH =
  process.env.TULSCODEX_BRIDGE_LOG || path.join(process.cwd(), "reports", "tulscodex-bridge.jsonl");

fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });

function logJson(obj: unknown) {
  fs.appendFileSync(LOG_PATH, `${JSON.stringify(obj)}\n`);
}

function safeParse(text: string): BridgeMsg | null {
  try {
    return JSON.parse(text) as BridgeMsg;
  } catch {
    return null;
  }
}

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, port: PORT }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ server: httpServer });

const clients = new Map<WebSocket, { role: Role; clientId: string }>();

function broadcast(payload: BridgeMsg, opts?: { toRole?: Role }) {
  const raw = JSON.stringify(payload);
  for (const [ws, meta] of clients.entries()) {
    if (opts?.toRole && meta.role !== opts.toRole) {
      continue;
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(raw);
    }
  }
}

wss.on("connection", (ws, req) => {
  const remote = req.socket.remoteAddress;
  let authed = false;

  ws.on("message", (buf) => {
    const raw =
      typeof buf === "string"
        ? buf
        : Buffer.isBuffer(buf)
          ? buf.toString("utf8")
          : Array.isArray(buf)
            ? Buffer.concat(buf).toString("utf8")
            : "";
    const msg = safeParse(raw);
    if (!msg) {
      return;
    }

    if (msg.type === "hello") {
      authed = true;
      clients.set(ws, { role: msg.role, clientId: msg.clientId });
      logJson({
        type: "hello",
        ts: new Date().toISOString(),
        role: msg.role,
        clientId: msg.clientId,
        remote,
      });
      ws.send(JSON.stringify({ type: "pong" } satisfies BridgeMsg));
      return;
    }

    if (!authed) {
      ws.send(
        JSON.stringify({
          type: "msg",
          text: "Bridge requires hello first: {type:'hello',role:'codex'|'captain',clientId:'...'}",
        } satisfies BridgeMsg),
      );
      return;
    }

    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" } satisfies BridgeMsg));
      return;
    }

    if (msg.type === "msg") {
      const meta = clients.get(ws);
      const ts = msg.ts || new Date().toISOString();
      const enriched = {
        ...msg,
        ts,
        from: msg.from || meta?.clientId,
      } satisfies BridgeMsg;

      logJson({ ...enriched, role: meta?.role });

      // Route: if sender is codex -> broadcast to captain; if captain -> broadcast to codex.
      const toRole: Role = meta?.role === "codex" ? "captain" : "codex";
      broadcast(enriched, { toRole });
      return;
    }
  });

  ws.on("close", () => {
    const meta = clients.get(ws);
    clients.delete(ws);
    logJson({
      type: "disconnect",
      ts: new Date().toISOString(),
      role: meta?.role,
      clientId: meta?.clientId,
      remote,
    });
  });
});

httpServer.listen(PORT, "127.0.0.1", () => {
  logJson({ type: "start", ts: new Date().toISOString(), port: PORT, logPath: LOG_PATH });
  // eslint-disable-next-line no-console
  console.log(`[tulscodex-bridge] listening on http://127.0.0.1:${PORT} (ws + /health)`);
  // eslint-disable-next-line no-console
  console.log(`[tulscodex-bridge] log: ${LOG_PATH}`);
});
