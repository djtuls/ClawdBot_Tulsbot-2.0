#!/usr/bin/env node
/**
 * OpenClaw Channel Configuration Audit Tool
 *
 * Verifies that all necessary credentials and configuration are properly set
 * for each channel before attempting startup. Reports missing or invalid
 * credentials with actionable CLI commands to fix issues.
 *
 * Usage:
 *   pnpm tsx scripts/audit-channel-config.ts              # Human-readable output
 *   pnpm tsx scripts/audit-channel-config.ts --json       # JSON output
 *   pnpm tsx scripts/audit-channel-config.ts --channel=telegram  # Audit specific channel
 *
 * Exit codes:
 *   0 - All configured channels pass audit
 *   1 - Configuration issues detected
 *   2 - Script execution failure
 */

import { listChannelPlugins } from "../src/channels/plugins/index.js";
import { readConfigFileSnapshot, requireConfig } from "../src/config/config.js";

type ConfigStatus = "valid" | "missing" | "invalid" | "unconfigured";

interface CredentialAudit {
  field: string;
  status: ConfigStatus;
  value?: string;
  issue?: string;
  recommendation?: string;
}

interface ChannelAccountAudit {
  channel: string;
  accountId: string;
  name?: string;
  enabled: boolean;
  overallStatus: ConfigStatus;
  credentials: CredentialAudit[];
  issues: string[];
  recommendations: string[];
}

interface AuditReport {
  timestamp: number;
  configPath?: string;
  totalAccounts: number;
  validAccounts: number;
  invalidAccounts: number;
  unconfiguredAccounts: number;
  accounts: ChannelAccountAudit[];
}

const CREDENTIAL_FIELDS = [
  "tokenSource",
  "botTokenSource",
  "appTokenSource",
  "credentialSource",
] as const;

/**
 * Check if a credential field value is properly configured
 */
function validateCredentialValue(value: unknown): ConfigStatus {
  if (value === undefined || value === null) {
    return "missing";
  }

  if (typeof value !== "string") {
    return "invalid";
  }

  const trimmed = value.trim();

  if (trimmed === "" || trimmed === "none") {
    return "unconfigured";
  }

  return "valid";
}

/**
 * Audit credentials for a single channel account
 */
function auditChannelAccount(
  plugin: ReturnType<typeof listChannelPlugins>[number],
  accountId: string,
  cfg: unknown,
): ChannelAccountAudit {
  const configObj = (cfg ?? {}) as { channels?: Record<string, unknown> };
  const channelConfig = (configObj.channels?.[plugin.id] ?? {}) as {
    accounts?: Record<string, unknown>;
    enabled?: boolean;
    name?: string;
    [key: string]: unknown;
  };
  const accountConfig = channelConfig?.accounts?.[accountId] ?? channelConfig;

  const enabled = accountConfig?.enabled !== false;
  const name = accountConfig?.name?.trim() || undefined;

  const credentials: CredentialAudit[] = [];
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check each credential field that might be used by this channel
  for (const field of CREDENTIAL_FIELDS) {
    const value = accountConfig?.[field];
    const status = validateCredentialValue(value);

    const audit: CredentialAudit = {
      field,
      status,
      value: typeof value === "string" ? value : undefined,
    };

    if (status === "missing") {
      audit.issue = `${field} not configured`;
      audit.recommendation = `Set via: openclaw channels update ${plugin.id} ${accountId} --${field}=<value>`;
    } else if (status === "invalid") {
      audit.issue = `${field} has invalid type (expected string)`;
      audit.recommendation = `Fix config file manually or reconfigure channel`;
    } else if (status === "unconfigured") {
      audit.issue = `${field} is explicitly unconfigured (value: "${value}")`;
      audit.recommendation = `Set via: openclaw channels update ${plugin.id} ${accountId} --${field}=<value>`;
    }

    credentials.push(audit);

    if (status !== "valid" && enabled) {
      issues.push(audit.issue!);
      recommendations.push(audit.recommendation!);
    }
  }

  // Determine overall account status
  let overallStatus: ConfigStatus = "valid";

  if (!enabled) {
    overallStatus = "unconfigured";
    issues.push("Channel account is disabled");
    recommendations.push(`Enable: openclaw channels update ${plugin.id} ${accountId} --enable`);
  } else {
    const hasAnyValid = credentials.some((c) => c.status === "valid");
    const hasAnyInvalid = credentials.some((c) => c.status === "invalid");
    const hasAnyUnconfigured = credentials.some((c) => c.status === "unconfigured");
    const hasAnyMissing = credentials.some((c) => c.status === "missing");

    if (!hasAnyValid && (hasAnyMissing || hasAnyUnconfigured)) {
      overallStatus = "unconfigured";
      if (!issues.length) {
        issues.push("No valid credentials configured");
        recommendations.push(`Configure: openclaw channels add ${plugin.id}`);
      }
    } else if (hasAnyInvalid) {
      overallStatus = "invalid";
    }
  }

  return {
    channel: plugin.id,
    accountId,
    name,
    enabled,
    overallStatus,
    credentials,
    issues,
    recommendations,
  };
}

/**
 * Print human-readable audit report
 */
function printReport(report: AuditReport): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`OpenClaw Configuration Audit Report`);
  console.log(`Timestamp: ${new Date(report.timestamp).toISOString()}`);
  if (report.configPath) {
    console.log(`Config: ${report.configPath}`);
  }
  console.log(`${"=".repeat(60)}\n`);

  console.log(`Summary:`);
  console.log(`  Total Accounts:         ${report.totalAccounts}`);
  console.log(`  ✓ Valid:                ${report.validAccounts}`);
  console.log(`  ✗ Invalid:              ${report.invalidAccounts}`);
  console.log(`  ○ Unconfigured:         ${report.unconfiguredAccounts}`);
  console.log("");

  const statusSymbol = (status: ConfigStatus) => {
    switch (status) {
      case "valid":
        return "✓";
      case "invalid":
        return "✗";
      case "unconfigured":
        return "○";
      case "missing":
        return "?";
    }
  };

  for (const account of report.accounts) {
    const label = account.name
      ? `${account.channel}/${account.accountId} (${account.name})`
      : `${account.channel}/${account.accountId}`;

    console.log(`${statusSymbol(account.overallStatus)} ${label}: ${account.overallStatus}`);

    if (!account.enabled) {
      console.log(`    Status: disabled`);
    }

    // Show credential details for problematic accounts
    if (account.overallStatus !== "valid") {
      for (const cred of account.credentials) {
        if (cred.status !== "valid") {
          console.log(`    ${cred.field}: ${cred.status}${cred.value ? ` (${cred.value})` : ""}`);
        }
      }
    }

    if (account.issues.length > 0) {
      for (const issue of account.issues) {
        console.log(`    Issue: ${issue}`);
      }
    }

    if (account.recommendations.length > 0) {
      for (const rec of account.recommendations) {
        console.log(`    → ${rec}`);
      }
    }

    console.log("");
  }

  console.log(`${"=".repeat(60)}\n`);

  if (report.invalidAccounts > 0 || report.unconfiguredAccounts > 0) {
    console.log(`⚠️  Configuration issues detected. Run recommended commands to fix.`);
    console.log(`   For detailed help: openclaw doctor\n`);
  } else {
    console.log(`✅ All configured channels pass audit.\n`);
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    const args = process.argv.slice(2);
    const jsonOutput = args.includes("--json");
    const channelFilter = args.find((arg) => arg.startsWith("--channel="))?.split("=")[1];

    const cfg = await requireConfig();
    const snapshot = await readConfigFileSnapshot();
    const plugins = listChannelPlugins();

    const allAudits: ChannelAccountAudit[] = [];

    for (const plugin of plugins) {
      // Apply channel filter if specified
      if (channelFilter && plugin.id !== channelFilter) {
        continue;
      }

      const accountIds = plugin.config.listAccountIds(cfg);

      for (const accountId of accountIds) {
        const audit = auditChannelAccount(plugin, accountId, cfg);
        allAudits.push(audit);
      }
    }

    const report: AuditReport = {
      timestamp: Date.now(),
      configPath: snapshot.path,
      totalAccounts: allAudits.length,
      validAccounts: allAudits.filter((a) => a.overallStatus === "valid").length,
      invalidAccounts: allAudits.filter(
        (a) => a.overallStatus === "invalid" || a.overallStatus === "missing",
      ).length,
      unconfiguredAccounts: allAudits.filter((a) => a.overallStatus === "unconfigured").length,
      accounts: allAudits,
    };

    if (jsonOutput) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }

    // Exit with appropriate code
    const hasIssues = report.invalidAccounts > 0 || report.unconfiguredAccounts > 0;
    process.exit(hasIssues ? 1 : 0);
  } catch (err) {
    console.error(`Fatal error: ${String(err)}`);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(2);
  }
}

void main();
