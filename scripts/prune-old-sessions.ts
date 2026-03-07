#!/usr/bin/env bun
import { $ } from "bun";

console.log("Pruning old sessions...");

// Enforce cleanup across all agents.
// The rules (e.g., max age, max count) are defined in openclaw.json
// This script just ensures the cleanup runs and enforces the rules.
const result = await $`openclaw sessions cleanup --enforce --all-agents`.quiet();

if (result.exitCode === 0) {
  console.log("Session cleanup successful.");
  const output = await result.text();
  if (output.trim()) {
    console.log(output);
  } else {
    console.log("No sessions required pruning.");
  }
} else {
  console.error("Session cleanup failed.");
  const errorOutput = await result.text();
  console.error(errorOutput);
}
