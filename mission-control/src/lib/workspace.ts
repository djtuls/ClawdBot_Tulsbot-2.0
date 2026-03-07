import { join } from "path";

export const WORKSPACE =
  process.env.OPENCLAW_WORKSPACE ||
  join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");

export function wsPath(...segments: string[]): string {
  return join(WORKSPACE, ...segments);
}
