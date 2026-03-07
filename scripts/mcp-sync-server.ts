#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { HandshakeManager, SessionRegistry } from "../src/mcp/openclaw-sync-auth.js";

type EventPushInput = {
  idempotencyKey: string;
  source?: string;
  target: string;
  op: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  schemaVersion: number;
  traceId?: string;
};

type EventRow = {
  event_id: string;
  idempotency_key: string;
  source: string;
  target: string;
  op: string;
  entity_type: string;
  entity_id: string;
  payload_json: Record<string, unknown>;
  schema_version: number;
  trace_id?: string | null;
  created_at: string;
};

type DeviceRow = {
  device_id: string;
  public_key: string;
};

const SUPABASE_URL = mustEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

const handshake = new HandshakeManager();
const sessions = new SessionRegistry();
const server = new McpServer({
  name: "openclaw-sync-mcp",
  version: "0.1.0",
});

function mustEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function postgrestHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
    ...extra,
  };
}

async function postgrest<T>(
  path: string,
  init: RequestInit & { body?: unknown } = {},
): Promise<{ data: T; status: number }> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: postgrestHeaders((init.headers as Record<string, string>) ?? {}),
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const raw = await response.text();
  const data = raw ? (JSON.parse(raw) as T) : (undefined as T);
  if (!response.ok) {
    throw new Error(
      `supabase request failed (${response.status} ${response.statusText}) path=${path} body=${raw}`,
    );
  }
  return { data, status: response.status };
}

function textResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

async function writeIncident(params: {
  severity: "info" | "warn" | "error";
  component: string;
  code: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await postgrest("incident_log", {
      method: "POST",
      body: {
        severity: params.severity,
        component: params.component,
        code: params.code,
        message: params.message,
        metadata: params.metadata ?? null,
      },
    });
  } catch {
    // Best-effort incident path; avoid crashing RPC.
  }
}

async function getDevice(deviceId: string): Promise<DeviceRow | null> {
  const { data } = await postgrest<DeviceRow[]>(
    `devices?select=device_id,public_key&device_id=eq.${encodeURIComponent(deviceId)}&limit=1`,
    { method: "GET" },
  );
  return data[0] ?? null;
}

server.registerTool(
  "handshake_init",
  {
    title: "Initialize device handshake identity",
    description: "Registers or updates OpenClaw device metadata in Supabase.",
    inputSchema: z.object({
      deviceId: z.string(),
      name: z.string().optional(),
      kind: z.string().default("openclaw-daemon"),
      publicKey: z.string(),
      capabilities: z.array(z.string()).default([]),
    }),
  },
  async ({ deviceId, name, kind, publicKey, capabilities }) => {
    await postgrest("devices?on_conflict=device_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: [
        {
          device_id: deviceId,
          name: name ?? `device-${deviceId}`,
          kind,
          public_key: publicKey,
          last_seen_at: new Date().toISOString(),
        },
      ],
    });
    return textResult({
      ok: true,
      deviceId,
      capabilities,
      protocolVersion: 1,
    });
  },
);

server.registerTool(
  "handshake_challenge",
  {
    title: "Issue nonce challenge",
    description: "Creates a one-time nonce challenge for device signature proof.",
    inputSchema: z.object({
      deviceId: z.string(),
      ttlMs: z.number().int().positive().max(600_000).default(120_000),
    }),
  },
  async ({ deviceId, ttlMs }) => {
    const device = await getDevice(deviceId);
    if (!device) {
      await writeIncident({
        severity: "warn",
        component: "openclaw-mcp",
        code: "MCP_UNKNOWN_DEVICE",
        message: "challenge requested for unknown device",
        metadata: { deviceId },
      });
      throw new Error(`unknown deviceId: ${deviceId}`);
    }
    const challenge = handshake.issueChallenge(deviceId, Date.now(), ttlMs);
    return textResult({
      nonce: challenge.nonce,
      expiresAt: new Date(challenge.expiresAtMs).toISOString(),
    });
  },
);

server.registerTool(
  "handshake_prove",
  {
    title: "Verify challenge proof and start session",
    description:
      "Validates signed challenge nonce and returns a short-lived MCP session token for sync operations.",
    inputSchema: z.object({
      deviceId: z.string(),
      nonce: z.string(),
      signedAtMs: z.number().int().positive(),
      signature: z.string(),
    }),
  },
  async ({ deviceId, nonce, signedAtMs, signature }) => {
    const device = await getDevice(deviceId);
    if (!device) {
      throw new Error(`unknown deviceId: ${deviceId}`);
    }
    const verified = handshake.verifyProof({
      deviceId,
      nonce,
      signedAtMs,
      signatureBase64: signature,
      publicKeyBase64: device.public_key,
    });
    if (!verified.ok) {
      await writeIncident({
        severity: "warn",
        component: "openclaw-mcp",
        code: `MCP_HANDSHAKE_${verified.reason.toUpperCase()}`,
        message: "handshake prove rejected",
        metadata: { deviceId, reason: verified.reason },
      });
      return textResult({ ok: false, reason: verified.reason });
    }
    const session = sessions.startSession(deviceId);
    await postgrest(`devices?device_id=eq.${encodeURIComponent(deviceId)}`, {
      method: "PATCH",
      body: { last_seen_at: new Date().toISOString() },
    });
    return textResult({
      ok: true,
      sessionToken: session.sessionToken,
      sessionExpiresAt: new Date(session.expiresAtMs).toISOString(),
    });
  },
);

server.registerTool(
  "sync_pull",
  {
    title: "Pull remote events after cursor",
    description: "Returns event journal entries after cursor for the authenticated device session.",
    inputSchema: z.object({
      deviceId: z.string(),
      sessionToken: z.string(),
      cursor: z.string().optional(),
      target: z.string().optional(),
      limit: z.number().int().positive().max(500).default(100),
    }),
  },
  async ({ deviceId, sessionToken, cursor, target, limit }) => {
    if (!sessions.validate({ deviceId, sessionToken })) {
      throw new Error("invalid or expired session");
    }

    let createdAfter: string | null = null;
    if (cursor) {
      const cursorQuery = `event_journal?select=event_id,created_at&event_id=eq.${encodeURIComponent(cursor)}&limit=1`;
      const { data: cursorRows } = await postgrest<Array<{ event_id: string; created_at: string }>>(
        cursorQuery,
        { method: "GET" },
      );
      createdAfter = cursorRows[0]?.created_at ?? null;
    }

    const filters: string[] = ["select=*", `order=created_at.asc`, `limit=${limit}`];
    if (target) {
      filters.push(`target=eq.${encodeURIComponent(target)}`);
    }
    if (createdAfter) {
      filters.push(`created_at=gt.${encodeURIComponent(createdAfter)}`);
    }
    const query = `event_journal?${filters.join("&")}`;
    const { data: rows } = await postgrest<EventRow[]>(query, { method: "GET" });

    const events = rows.map((row) => ({
      eventId: row.event_id,
      idempotencyKey: row.idempotency_key,
      source: row.source,
      target: row.target,
      op: row.op,
      entityType: row.entity_type,
      entityId: row.entity_id,
      payload: row.payload_json,
      schemaVersion: row.schema_version,
      traceId: row.trace_id ?? undefined,
      createdAt: row.created_at,
    }));
    const nextCursor = events.length > 0 ? events.at(-1)?.eventId : (cursor ?? null);
    return textResult({ events, nextCursor });
  },
);

server.registerTool(
  "sync_push",
  {
    title: "Push local events to canonical event journal",
    description:
      "Writes OpenClaw local events into Supabase event_journal and seeds reconcile_state.",
    inputSchema: z.object({
      deviceId: z.string(),
      sessionToken: z.string(),
      events: z.array(
        z.object({
          idempotencyKey: z.string(),
          source: z.string().optional(),
          target: z.string(),
          op: z.string(),
          entityType: z.string(),
          entityId: z.string(),
          payload: z.record(z.string(), z.unknown()),
          schemaVersion: z.number().int().positive(),
          traceId: z.string().optional(),
        }),
      ),
    }),
  },
  async ({ deviceId, sessionToken, events }) => {
    if (!sessions.validate({ deviceId, sessionToken })) {
      throw new Error("invalid or expired session");
    }
    const results: Array<{
      idempotencyKey: string;
      ok: boolean;
      eventId?: string;
      error?: string;
    }> = [];

    for (const event of events as EventPushInput[]) {
      try {
        const { data: inserted } = await postgrest<Array<{ event_id: string }>>(
          "event_journal?on_conflict=idempotency_key",
          {
            method: "POST",
            headers: { Prefer: "resolution=merge-duplicates,return=representation" },
            body: [
              {
                idempotency_key: event.idempotencyKey,
                source: event.source ?? "openclaw",
                device_id: deviceId,
                target: event.target,
                op: event.op,
                entity_type: event.entityType,
                entity_id: event.entityId,
                payload_json: event.payload,
                schema_version: event.schemaVersion,
                trace_id: event.traceId ?? null,
              },
            ],
          },
        );
        const eventId = inserted[0]?.event_id;
        if (!eventId) {
          throw new Error("event insert returned no event_id");
        }
        await postgrest("reconcile_state?on_conflict=event_id,target", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: [
            {
              event_id: eventId,
              target: event.target,
              status: "pending",
              attempt_count: 0,
            },
          ],
        });
        results.push({ idempotencyKey: event.idempotencyKey, ok: true, eventId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await writeIncident({
          severity: "error",
          component: "openclaw-mcp",
          code: "MCP_SYNC_PUSH_FAILED",
          message: "sync.push failed for event",
          metadata: {
            deviceId,
            idempotencyKey: event.idempotencyKey,
            target: event.target,
            error: message,
          },
        });
        results.push({ idempotencyKey: event.idempotencyKey, ok: false, error: message });
      }
    }
    const okCount = results.filter((r) => r.ok).length;
    return textResult({
      ok: okCount === results.length,
      accepted: okCount,
      failed: results.length - okCount,
      results,
    });
  },
);

server.registerTool(
  "incident_log",
  {
    title: "Write operational incident",
    description:
      "Writes an incident row to Supabase incident_log for dashboards and CLI inspection.",
    inputSchema: z.object({
      severity: z.enum(["info", "warn", "error"]),
      component: z.string(),
      code: z.string(),
      message: z.string(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
  },
  async ({ severity, component, code, message, metadata }) => {
    await writeIncident({ severity, component, code, message, metadata });
    return textResult({ ok: true });
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[mcp-sync] fatal", err);
  process.exit(1);
});
