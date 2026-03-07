export type MasterIndexStatus = "current" | "deprecated" | "needs_context";

export type MasterIndexSourceType =
  | "tool"
  | "database"
  | "doc"
  | "memory"
  | "config"
  | "script"
  | "skill";

export interface IndexItem {
  /** Deterministic key: "{source_type}:{source_repo}:{path}" */
  item_key: string;
  name: string;
  source_type: MasterIndexSourceType;
  status: MasterIndexStatus;
  path: string;
  content_summary?: string;
  tags: string[];
  source_repo: string;
  metadata: Record<string, unknown>;
}

export interface ScanResult {
  scanner: string;
  items: IndexItem[];
  errors: string[];
}
