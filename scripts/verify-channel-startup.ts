#!/usr/bin/env node
/**
 * Channel Startup Verification Tool
 *
 * Verifies that the OpenClaw gateway can successfully start and that
 * all configured channels reach an operational state. This tool spawns
 * an isolated gateway process to validate the complete startup sequence.
 *
 * Usage:
 *   pnpm tsx scripts/verify-channel-startup.ts [options]
 *
 * Options:
 *   --timeout=<ms>        Max startup time (default: 30000)
 *   --port=<port>         Gateway port (default: auto-select)
 *   --skip-channels       Skip channel startup verification
 *   --verbose             Show detailed startup logs
 */

import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../src/config/config-loader.ts";
import { callGateway } from "../src/gateway/call.ts";
import { resolveGatewayPort } from "../src/gateway/resolve-port.ts";
import { listChannelPlugins } from "../src/plugins/list-channel-plugins.ts";

// Terminal colors
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
} as const;

interface StartupVerificationResult {
  success: boolean;
  gatewayStarted: boolean;
  channelsVerified: boolean;
  startupTimeMs: number;
  errors: string[];
  warnings: string[];
  channelResults: ChannelStartupResult[];
}

interface ChannelStartupResult {
  channel: string;
  accountId: string;
  success: boolean;
  running?: boolean;
  connected?: boolean;
  error?: string;
}

interface VerificationOptions {
  timeoutMs: number;
  port?: number;
  skipChannels: boolean;
  verbose: boolean;
}

async function main() {
  const args = process.argv.slice(2);
  const opts: VerificationOptions = {
    timeoutMs: parseArgNumber(args, "--timeout", 30000),
    port: parseArgNumber(args, "--port"),
    skipChannels: args.includes("--skip-channels"),
    verbose: args.includes("--verbose"),
  };

  console.log(`${colors.cyan}🚀 OpenClaw Channel Startup Verification${colors.reset}\n`);

  const result = await verifyChannelStartup(opts);

  // Print results
  printResults(result);

  process.exit(result.success ? 0 : 1);
}

async function verifyChannelStartup(opts: VerificationOptions): Promise<StartupVerificationResult> {
  const startTime = Date.now();
  const result: StartupVerificationResult = {
    success: false,
    gatewayStarted: false,
    channelsVerified: false,
    startupTimeMs: 0,
    errors: [],
    warnings: [],
    channelResults: [],
  };

  let gatewayProcess: ChildProcess | undefined;

  try {
    // Load configuration
    const cfg = loadConfig();
    const port = opts.port ?? resolveGatewayPort(cfg);

    console.log(`${colors.blue}📋 Configuration${colors.reset}`);
    console.log(`   Port: ${port}`);
    console.log(`   Timeout: ${opts.timeoutMs}ms`);
    console.log(`   Skip Channels: ${opts.skipChannels}\n`);

    // Step 1: Start isolated gateway process
    console.log(`${colors.blue}🔧 Starting gateway process...${colors.reset}`);
    gatewayProcess = await startIsolatedGateway(port, opts);

    // Step 2: Wait for gateway to be ready
    console.log(`${colors.blue}⏳ Waiting for gateway ready...${colors.reset}`);
    const gatewayReady = await waitForGatewayReady(port, opts.timeoutMs);

    if (!gatewayReady) {
      result.errors.push("Gateway failed to start within timeout");
      return result;
    }

    result.gatewayStarted = true;
    console.log(`${colors.green}✓ Gateway started successfully${colors.reset}\n`);

    // Step 3: Verify channel startup (if not skipped)
    if (!opts.skipChannels) {
      console.log(`${colors.blue}🔌 Verifying channel startup...${colors.reset}`);
      const channelResults = await verifyChannelStatus();
      result.channelResults = channelResults;

      const channelFailures = channelResults.filter((r) => !r.success);
      if (channelFailures.length > 0) {
        result.errors.push(`${channelFailures.length} channel(s) failed to start`);
      } else {
        result.channelsVerified = true;
        console.log(`${colors.green}✓ All configured channels verified${colors.reset}\n`);
      }
    } else {
      result.channelsVerified = true;
      result.warnings.push("Channel verification skipped");
    }

    result.success = result.gatewayStarted && result.channelsVerified;
  } catch (err) {
    result.errors.push(`Verification failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    // Cleanup: Stop gateway process
    if (gatewayProcess && !gatewayProcess.killed) {
      console.log(`${colors.blue}🛑 Stopping gateway process...${colors.reset}`);
      gatewayProcess.kill("SIGTERM");

      // Wait for graceful shutdown
      await delay(2000);

      if (!gatewayProcess.killed) {
        gatewayProcess.kill("SIGKILL");
      }
    }

    result.startupTimeMs = Date.now() - startTime;
  }

  return result;
}

async function startIsolatedGateway(
  port: number,
  opts: VerificationOptions,
): Promise<ChildProcess> {
  const env = {
    ...process.env,
    OPENCLAW_GATEWAY_PORT: String(port),
    OPENCLAW_GATEWAY_BIND: "loopback",
    OPENCLAW_SKIP_CHANNELS: opts.skipChannels ? "1" : "0",
  };

  const args = ["scripts/run-node.mjs", "gateway", "--force"];

  const proc = spawn("node", args, {
    env,
    stdio: opts.verbose ? "inherit" : "ignore",
    detached: false,
  });

  proc.on("error", (err) => {
    console.error(`${colors.red}Gateway process error: ${err.message}${colors.reset}`);
  });

  return proc;
}

async function waitForGatewayReady(port: number, timeoutMs: number): Promise<boolean> {
  const startTime = Date.now();
  const pollIntervalMs = 500;

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Attempt to call gateway status endpoint
      await callGateway({
        method: "gateway.ping",
        params: {},
        timeoutMs: 2000,
      });

      return true;
    } catch {
      // Gateway not ready yet, continue polling
      await delay(pollIntervalMs);
    }
  }

  return false;
}

async function verifyChannelStatus(): Promise<ChannelStartupResult[]> {
  const results: ChannelStartupResult[] = [];

  try {
    // Get gateway channel status
    const gatewayStatus = await callGateway({
      method: "gateway.getStatus",
      params: {},
      timeoutMs: 5000,
    });

    const channelsStatus = (gatewayStatus.channels as Record<string, unknown>) ?? {};

    // Get configured channels
    const cfg = loadConfig();
    const channelPlugins = listChannelPlugins();

    for (const plugin of channelPlugins) {
      const accountIds = cfg.channels?.[plugin.id]?.accounts
        ? Object.keys(cfg.channels[plugin.id].accounts)
        : [];

      for (const accountId of accountIds) {
        const accountCfg = cfg.channels?.[plugin.id]?.accounts?.[accountId];
        const enabled = accountCfg?.enabled ?? false;

        if (!enabled) {
          // Skip disabled accounts
          continue;
        }

        const statusKey = `${plugin.id}:${accountId}`;
        const channelStatus = channelsStatus[statusKey] as Record<string, unknown> | undefined;

        const running = typeof channelStatus?.running === "boolean" ? channelStatus.running : false;
        const connected =
          typeof channelStatus?.connected === "boolean" ? channelStatus.connected : false;

        const success = running && connected;

        results.push({
          channel: plugin.id,
          accountId,
          success,
          running,
          connected,
          error: success ? undefined : "Channel not running or not connected",
        });

        const statusIcon = success ? colors.green + "✓" : colors.red + "✗";
        const statusText = success ? "operational" : "failed";
        console.log(`   ${statusIcon} ${plugin.id}:${accountId} - ${statusText}${colors.reset}`);
      }
    }
  } catch (err) {
    console.error(
      `${colors.red}Failed to verify channel status: ${err instanceof Error ? err.message : String(err)}${colors.reset}`,
    );
  }

  return results;
}

function printResults(result: StartupVerificationResult) {
  console.log(`\n${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.cyan}📊 Verification Results${colors.reset}`);
  console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  const statusIcon = result.success ? colors.green + "✓" : colors.red + "✗";
  const statusText = result.success ? "PASSED" : "FAILED";
  console.log(`${statusIcon} Overall Status: ${statusText}${colors.reset}`);
  console.log(
    `   Gateway Started: ${result.gatewayStarted ? colors.green + "Yes" : colors.red + "No"}${colors.reset}`,
  );
  console.log(
    `   Channels Verified: ${result.channelsVerified ? colors.green + "Yes" : colors.red + "No"}${colors.reset}`,
  );
  console.log(`   Startup Time: ${result.startupTimeMs}ms\n`);

  if (result.channelResults.length > 0) {
    console.log(`${colors.blue}📡 Channel Results:${colors.reset}`);
    for (const channel of result.channelResults) {
      const icon = channel.success ? colors.green + "✓" : colors.red + "✗";
      console.log(`   ${icon} ${channel.channel}:${channel.accountId}${colors.reset}`);
      if (channel.error) {
        console.log(`      Error: ${channel.error}`);
      }
    }
    console.log();
  }

  if (result.warnings.length > 0) {
    console.log(`${colors.yellow}⚠️  Warnings:${colors.reset}`);
    for (const warning of result.warnings) {
      console.log(`   • ${warning}`);
    }
    console.log();
  }

  if (result.errors.length > 0) {
    console.log(`${colors.red}❌ Errors:${colors.reset}`);
    for (const error of result.errors) {
      console.log(`   • ${error}`);
    }
    console.log();
  }

  if (!result.success) {
    console.log(`${colors.yellow}💡 Recommendations:${colors.reset}`);
    if (!result.gatewayStarted) {
      console.log(`   • Check gateway logs: openclaw gateway --verbose`);
      console.log(`   • Verify port availability: lsof -ti:8181`);
      console.log(`   • Check auth configuration: openclaw doctor`);
    }
    if (!result.channelsVerified) {
      console.log(`   • Run channel health check: pnpm tsx scripts/check-channel-health.ts`);
      console.log(`   • Run config audit: pnpm tsx scripts/audit-channel-config.ts`);
      console.log(`   • Check individual channel: openclaw doctor --channel=<channel-id>`);
    }
    console.log();
  }
}

function parseArgNumber(args: string[], flag: string, defaultValue?: number): number | undefined {
  const arg = args.find((a) => a.startsWith(flag));
  if (!arg) {
    return defaultValue;
  }

  const value = arg.split("=")[1];
  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : defaultValue;
}

main().catch((err) => {
  console.error(
    `${colors.red}Fatal error: ${err instanceof Error ? err.message : String(err)}${colors.reset}`,
  );
  process.exit(1);
});
