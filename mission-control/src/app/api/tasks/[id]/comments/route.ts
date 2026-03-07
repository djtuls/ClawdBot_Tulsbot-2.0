import { readFileSync, writeFileSync, existsSync } from "fs";
import { NextRequest, NextResponse } from "next/server";
import { wsPath } from "@/lib/workspace";

interface Task {
  id: string;
  comments?: Array<{ id: string; author: string; text: string; ts: string; type?: string }>;
  [key: string]: unknown;
}

function readTasks(): Task[] {
  const p = wsPath("tasks", "backlog.json");
  if (!existsSync(p)) {
    return [];
  }
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    if (Array.isArray(raw)) {
      return raw;
    }
    if (raw?.tasks) {
      return raw.tasks;
    }
    return [];
  } catch {
    return [];
  }
}

function writeTasks(tasks: Task[]) {
  const p = wsPath("tasks", "backlog.json");
  let version = 1;
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    if (raw?.version) {
      version = raw.version;
    }
  } catch {
    /* ignore */
  }
  writeFileSync(p, JSON.stringify({ version, tasks }, null, 2));
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { text, author, type } = await req.json();
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const tasks = readTasks();
  const task = tasks.find((t) => t.id === params.id);
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  if (!task.comments) {
    task.comments = [];
  }

  const comment = {
    id: `cmt-${Date.now()}`,
    author: author || "tulio",
    text,
    ts: new Date().toISOString(),
    type: type || "comment",
  };

  task.comments.push(comment);
  writeTasks(tasks);
  return NextResponse.json(comment, { status: 201 });
}
