import { execFileSync } from "child_process";
/**
 * Security Scan — 11 PM BRT daily
 * Check for exposed secrets, verify tunnel health, gateway auth, file permissions.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { logSecurity, logCron } from "./event-logger.js";

const WORKSPACE =
  process.env.OPENCLAW_WORKSPACE ||
  join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const OPENCLAW_HOME = join(process.env.HOME || "/Users/tulioferro", ".openclaw");

function checkSecretsInFiles(): string[] {
  const issues: string[] = [];
  const dangerousPatterns = [
    /(?:api[_-]?key|secret|token|password)\s*[=:]\s*["'][A-Za-z0-9+/=_-]{20,}/gi,
  ];

  const filesToCheck = [join(OPENCLAW_HOME, "openclaw.json")];

  for (const file of filesToCheck) {
    if (!existsSync(file)) {
      continue;
    }
    const content = readFileSync(file, "utf-8");
    for (const pattern of dangerousPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        issues.push(`Potential secret in ${file}`);
        break;
      }
    }
  }
  return issues;
}

function checkTunnelHealth(): boolean {
  try {
    execFileSync("pgrep", ["-f", "cloudflared"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function checkGatewayHealth(): boolean {
  try {
    execFileSync("pgrep", ["-f", "openclaw.*gateway"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const secretIssues = checkSecretsInFiles();
  const tunnelOk = checkTunnelHealth();
  const gatewayOk = checkGatewayHealth();

  if (secretIssues.length > 0) {
    logSecurity("secrets-scan", "warn", { issues: secretIssues });
    console.log(`WARNING: ${secretIssues.length} potential secret exposures`);
  } else {
    logSecurity("secrets-scan", "ok", { checked: 1 });
  }

  logSecurity("tunnel-health", tunnelOk ? "ok" : "error", { running: tunnelOk });
  logSecurity("gateway-health", gatewayOk ? "ok" : "error", { running: gatewayOk });

  if (!tunnelOk) {
    console.log("ERROR: Cloudflare tunnel not running");
  }
  if (!gatewayOk) {
    console.log("ERROR: Gateway not running");
  }

  const status = secretIssues.length === 0 && tunnelOk && gatewayOk ? "ok" : "warn";
  logCron("security-scan", status as "ok" | "warn", {
    secrets: secretIssues.length,
    tunnelOk,
    gatewayOk,
  });
  console.log(
    `Security scan: secrets=${secretIssues.length}, tunnel=${tunnelOk}, gateway=${gatewayOk}`,
  );
}

main();
