#!/usr/bin/env node
/**
 * Notification Queue — batches notifications by priority.
 * Critical: immediate. High: hourly. Medium: 3-hour. Low: daily digest.
 *
 * Uses a local JSONL file as queue. Supabase table can be added later.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const WORKSPACE =
  process.env.OPENCLAW_WORKSPACE ||
  join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const QUEUE_FILE = join(WORKSPACE, "memory/notification-queue.jsonl");
const DELIVERY_LOG = join(WORKSPACE, "memory/notification-delivery.jsonl");

export type NotificationPriority = "critical" | "high" | "medium" | "low";

interface QueuedNotification {
  id: string;
  priority: NotificationPriority;
  message: string;
  source: string;
  created_at: string;
  delivered_at?: string;
}

export function enqueue(priority: NotificationPriority, message: string, source: string): void {
  const dir = dirname(QUEUE_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const notification: QueuedNotification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    priority,
    message,
    source,
    created_at: new Date().toISOString(),
  };

  if (priority === "critical") {
    console.log(`[CRITICAL] ${source}: ${message}`);
    appendFileSync(
      DELIVERY_LOG,
      JSON.stringify({ ...notification, delivered_at: new Date().toISOString() }) + "\n",
    );
    return;
  }

  appendFileSync(QUEUE_FILE, JSON.stringify(notification) + "\n");
}

export function flush(maxPriority: NotificationPriority): string[] {
  if (!existsSync(QUEUE_FILE)) {
    return [];
  }

  const priorityOrder: Record<NotificationPriority, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  const maxLevel = priorityOrder[maxPriority];
  const lines = readFileSync(QUEUE_FILE, "utf-8").trim().split("\n").filter(Boolean);
  const toDeliver: QueuedNotification[] = [];
  const toKeep: string[] = [];

  for (const line of lines) {
    try {
      const notif: QueuedNotification = JSON.parse(line);
      if (priorityOrder[notif.priority] <= maxLevel) {
        toDeliver.push(notif);
      } else {
        toKeep.push(line);
      }
    } catch {
      toKeep.push(line);
    }
  }

  const messages: string[] = [];
  const now = new Date().toISOString();

  for (const notif of toDeliver) {
    messages.push(`[${notif.priority.toUpperCase()}] ${notif.source}: ${notif.message}`);
    appendFileSync(DELIVERY_LOG, JSON.stringify({ ...notif, delivered_at: now }) + "\n");
  }

  writeFileSync(QUEUE_FILE, toKeep.length > 0 ? toKeep.join("\n") + "\n" : "");

  return messages;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , command, ...args] = process.argv;

  if (command === "enqueue" && args.length >= 3) {
    enqueue(args[0] as NotificationPriority, args[1], args[2]);
    console.log("Enqueued notification");
  } else if (command === "flush" && args.length >= 1) {
    const messages = flush(args[0] as NotificationPriority);
    if (messages.length === 0) {
      console.log("No notifications to deliver");
    } else {
      console.log(`Delivering ${messages.length} notifications:`);
      for (const m of messages) {
        console.log(m);
      }
    }
  } else {
    console.log("Usage:");
    console.log("  notification-queue.ts enqueue <priority> <message> <source>");
    console.log("  notification-queue.ts flush <max-priority>");
  }
}
