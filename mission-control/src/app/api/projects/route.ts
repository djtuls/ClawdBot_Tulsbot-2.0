import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { NextResponse } from "next/server";
import { wsPath } from "@/lib/workspace";

export interface Project {
  id: string;
  title: string;
  name?: string;
  description: string;
  status: "not_started" | "in_progress" | "completed";
  progress: number;
  created?: string;
  tasks?: string[];
}

function readProjects(): Project[] {
  const dir = wsPath("tasks");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const p = wsPath("tasks", "projects.json");
  if (!existsSync(p)) {
    const defaults: Project[] = [
      {
        id: "proj-ios-rebuild",
        title: "IOS Rebuild",
        description: "Rebuild Tulsbot operating system — local-first, clean cron, Mission Control",
        status: "in_progress",
        progress: 75,
        tasks: [],
      },
    ];
    writeFileSync(p, JSON.stringify({ version: 1, projects: defaults }, null, 2));
    return defaults;
  }

  try {
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    let projects: Project[];
    if (Array.isArray(raw)) {
      projects = raw;
    } else if (raw?.projects) {
      projects = raw.projects;
    } else {
      return [];
    }

    return projects.map((p) => ({
      ...p,
      title: p.title || p.name || "Untitled",
      tasks: p.tasks || [],
    }));
  } catch {
    return [];
  }
}

function readTasks(): Array<{ id: string; project?: string; status: string }> {
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

export async function GET() {
  const projects = readProjects();
  const tasks = readTasks();

  const enriched = projects.map((proj) => {
    const linkedTasks = tasks.filter((t) => t.project === proj.id);
    const doneTasks = linkedTasks.filter((t) => t.status === "done");
    return {
      ...proj,
      linkedTaskCount: linkedTasks.length,
      doneTaskCount: doneTasks.length,
    };
  });

  return NextResponse.json(enriched);
}
