export type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  condition: string;
  action: string;
  projectContext: string;
  confidence: number;
};

export type ProjectContext = {
  id: string;
  project: string;
  keywords: string;
  destination: string;
  owner: string;
  enabled: boolean;
};

export type CaptureInboxConfig = {
  version: number;
  updatedAt?: string;
  sources: {
    email: boolean;
    whatsapp: boolean;
    notionRequests: boolean;
    notes: boolean;
    plaud: boolean;
  };
  flow: {
    autoArchive: boolean;
    hitlThreshold: number;
  };
  routing: {
    hubspot: boolean;
    notionTasks: boolean;
    notes: boolean;
    plaud: boolean;
    meetingBriefs: boolean;
  };
  rules: Rule[];
  contexts: ProjectContext[];
};

export const DEFAULT_CAPTURE_INBOX_CONFIG: CaptureInboxConfig = {
  version: 1,
  sources: {
    email: true,
    whatsapp: true,
    notionRequests: true,
    notes: true,
    plaud: true,
  },
  flow: {
    autoArchive: true,
    hitlThreshold: 0.7,
  },
  routing: {
    hubspot: true,
    notionTasks: true,
    notes: true,
    plaud: true,
    meetingBriefs: true,
  },
  rules: [
    {
      id: "r-subscriptions",
      name: "Subscriptions / newsletters",
      enabled: true,
      condition: "sender in subscriptions OR category:promotions",
      action: "label:Subscriptions + archive",
      projectContext: "none",
      confidence: 0.9,
    },
    {
      id: "r-receipts",
      name: "Receipts / invoices",
      enabled: true,
      condition: "keywords: receipt|invoice|payment confirmed",
      action: "label:Finance/Receipts + archive",
      projectContext: "finance",
      confidence: 0.92,
    },
    {
      id: "r-important",
      name: "Important / work-in-progress",
      enabled: true,
      condition: "VIP sender OR active project keyword match",
      action: "keep in inbox + label:WIP + route to Capture queue",
      projectContext: "auto",
      confidence: 0.75,
    },
    {
      id: "r-starred-email",
      name: "Starred emails always reviewed",
      enabled: true,
      condition: "email.starred = true",
      action: "force HITL review + keep in inbox",
      projectContext: "auto",
      confidence: 0.99,
    },
    {
      id: "r-action-promises",
      name: "Requests/promises of action",
      enabled: true,
      condition: "received or sent message includes request/task/promise language",
      action: "force HITL review + create action follow-up",
      projectContext: "auto",
      confidence: 0.95,
    },
    {
      id: "r-hitl",
      name: "Low confidence triage",
      enabled: true,
      condition: "classifier confidence below threshold",
      action: "send to HITL queue",
      projectContext: "unknown",
      confidence: 0.55,
    },
  ],
  contexts: [
    {
      id: "p-le",
      project: "Live Engine",
      keywords: "live engine, event production, stage, crew, showcall",
      destination: "HubSpot pipeline: Live Engine + Notion tasks",
      owner: "Tulio",
      enabled: true,
    },
    {
      id: "p-cta",
      project: "Creative Tools Agency",
      keywords: "creative tools, automation, ai ops, consulting",
      destination: "HubSpot pipeline: CTA + Notion tasks",
      owner: "Tulio",
      enabled: true,
    },
    {
      id: "p-inf-2603",
      project: "INF-2603",
      keywords: "inf-2603, production plan, deliverables, budget",
      destination: "Project board: INF-2603",
      owner: "Tulio",
      enabled: true,
    },
    {
      id: "p-inf-concacaf",
      project: "INF-Concacaf-2026",
      keywords: "concacaf, 2026, fan fest, activation",
      destination: "Project board: INF-Concacaf-2026",
      owner: "Tulio",
      enabled: true,
    },
    {
      id: "p-inf-finalissima",
      project: "INF-Finalissima",
      keywords: "finalissima, run of show, talent, logistics",
      destination: "Project board: INF-Finalissima",
      owner: "Tulio",
      enabled: true,
    },
  ],
};
