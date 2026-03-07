import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { wsPath } from "@/lib/workspace";

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: "backlog" | "in_progress" | "review" | "done";
  priority: "low" | "medium" | "high" | "urgent";
  assignee: "tulio" | "tulsbot";
  project?: string;
  created: string;
  updatedAt?: string;
  comments?: TaskComment[];
}

export interface TaskComment {
  id: string;
  author: "tulio" | "tulsbot";
  text: string;
  ts: string;
  type?: "comment" | "command" | "ai_summary";
}

function getTasksPath() {
  return wsPath("tasks", "backlog.json");
}

function readTasks(): Task[] {
  const dir = wsPath("tasks");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const p = getTasksPath();
  if (!existsSync(p)) {
    writeFileSync(p, JSON.stringify({ version: 1, tasks: [] }, null, 2));
    return [];
  }

  try {
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    if (Array.isArray(raw)) {
      return raw;
    }
    if (raw && Array.isArray(raw.tasks)) {
      return raw.tasks;
    }
    return [];
  } catch {
    return [];
  }
}

function writeTasks(tasks: Task[]) {
  const p = getTasksPath();
  let version = 1;
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    if (raw && raw.version) {
      version = raw.version;
    }
  } catch {
    /* ignore */
  }
  writeFileSync(p, JSON.stringify({ version, tasks }, null, 2));
}

export async function GET() {
  return NextResponse.json(readTasks());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const tasks = readTasks();

  const task: Task = {
    id: body.id || `task-${Date.now()}`,
    title: body.title || "Untitled",
    description: body.description || "",
    status: body.status || "backlog",
    priority: body.priority || "medium",
    assignee: body.assignee || "tulio",
    project: body.project || undefined,
    created: new Date().toISOString().split("T")[0],
    comments: [],
  };

  tasks.push(task);
  writeTasks(tasks);
  return NextResponse.json(task, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const tasks = readTasks();
  const idx = tasks.findIndex((t) => t.id === body.id);
  if (idx === -1) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { id, created, ...updates } = body;
  tasks[idx] = { ...tasks[idx], ...updates, updatedAt: new Date().toISOString() };
  writeTasks(tasks);
  return NextResponse.json(tasks[idx]);
}
