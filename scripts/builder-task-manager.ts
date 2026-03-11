#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";

const WORKSPACE =
  process.env.WORKSPACE_DIR ||
  path.join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const STATE_DIR = path.join(WORKSPACE, "state");
const DB = path.join(STATE_DIR, "background-tasks.json");

type TaskStatus = "running" | "done" | "failed" | "cancelled" | "blocked";
interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  owner: string;
  workerSession?: string;
  notes?: string;
}
interface TaskDb {
  updatedAt: string;
  tasks: Task[];
}

function ensureDb(): TaskDb {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB)) {
    const fresh: TaskDb = { updatedAt: new Date().toISOString(), tasks: [] };
    fs.writeFileSync(DB, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  try {
    return JSON.parse(fs.readFileSync(DB, "utf8")) as TaskDb;
  } catch {
    return { updatedAt: new Date().toISOString(), tasks: [] };
  }
}

function save(db: TaskDb) {
  db.updatedAt = new Date().toISOString();
  fs.writeFileSync(DB, `${JSON.stringify(db, null, 2)}\n`);
}

function usage() {
  console.log(`Usage:
  npx tsx scripts/builder-task-manager.ts start "<title>" [--owner main] [--worker <session>]
  npx tsx scripts/builder-task-manager.ts status [--all]
  npx tsx scripts/builder-task-manager.ts update <id> --status running|done|failed|cancelled|blocked [--notes "..."]
  npx tsx scripts/builder-task-manager.ts cancel <id> [--notes "..."]
`);
}

function flag(name: string, args: string[]) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function genId() {
  return `bg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd) {
    return usage();
  }

  const db = ensureDb();

  if (cmd === "start") {
    const title = args[1];
    if (!title) {
      return usage();
    }
    const owner = flag("--owner", args) || "main";
    const worker = flag("--worker", args);
    const now = new Date().toISOString();
    const task: Task = {
      id: genId(),
      title,
      status: "running",
      createdAt: now,
      updatedAt: now,
      owner,
      workerSession: worker,
    };
    db.tasks.unshift(task);
    save(db);
    console.log(JSON.stringify(task, null, 2));
    return;
  }

  if (cmd === "status") {
    const showAll = args.includes("--all");
    const rows = showAll
      ? db.tasks
      : db.tasks.filter((t) => t.status === "running" || t.status === "blocked");
    console.log(
      JSON.stringify(
        { updatedAt: db.updatedAt, count: rows.length, tasks: rows.slice(0, 30) },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === "update") {
    const id = args[1];
    const status = flag("--status", args) as TaskStatus | undefined;
    const notes = flag("--notes", args);
    if (!id || !status) {
      return usage();
    }
    const t = db.tasks.find((x) => x.id === id);
    if (!t) {
      console.error(`Task not found: ${id}`);
      process.exit(1);
    }
    t.status = status;
    t.updatedAt = new Date().toISOString();
    if (notes) {
      t.notes = notes;
    }
    save(db);
    console.log(JSON.stringify(t, null, 2));
    return;
  }

  if (cmd === "cancel") {
    const id = args[1];
    const notes = flag("--notes", args);
    if (!id) {
      return usage();
    }
    const t = db.tasks.find((x) => x.id === id);
    if (!t) {
      console.error(`Task not found: ${id}`);
      process.exit(1);
    }
    t.status = "cancelled";
    t.updatedAt = new Date().toISOString();
    if (notes) {
      t.notes = notes;
    }
    save(db);
    console.log(JSON.stringify(t, null, 2));
    return;
  }

  usage();
}

main();
