import { execFileSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const WORKSPACE =
  process.env.WORKSPACE_DIR || join(process.env.HOME || "/Users/tulioferro", ".openclaw/workspace");
const TOPICS_PATH = join(WORKSPACE, "data/telegram-topics.json");
const PRIMARY_DM_CHAT_ID =
  process.env.OPENCLAW_PRIMARY_DM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || "7026267103";
const ALERT_CHAT_ID = process.env.TELEGRAM_ALERT_CHAT_ID || PRIMARY_DM_CHAT_ID;

interface TopicConfig {
  groupId: string;
  topics: Record<string, { id: number; name: string }>;
}

let config: TopicConfig | null = null;

function getConfig(): TopicConfig | null {
  if (config) {
    return config;
  }
  if (!existsSync(TOPICS_PATH)) {
    return null;
  }
  try {
    config = JSON.parse(readFileSync(TOPICS_PATH, "utf-8"));
    return config;
  } catch {
    return null;
  }
}

function getBotToken(): string | null {
  try {
    const cfg = JSON.parse(
      readFileSync(
        join(process.env.HOME || "/Users/tulioferro", ".openclaw/openclaw.json"),
        "utf-8",
      ),
    );
    return cfg?.channels?.telegram?.botToken || null;
  } catch {
    return null;
  }
}

export type TopicKey =
  | "general"
  | "inbox_review"
  | "daily_briefs"
  | "crm_hubspot"
  | "inft_operations"
  | "finances"
  | "system_health"
  | "knowledge_base"
  | "inft_hub_management";

export function sendToTopic(
  topic: TopicKey,
  text: string,
  parseMode: "HTML" | "Markdown" = "HTML",
): boolean {
  const cfg = getConfig();
  const token = getBotToken();
  if (!token) {
    console.error("[telegram] Missing bot token");
    return false;
  }

  // DM-first policy: route all operational notifications to primary DM.
  // Optional dedicated alert channel can receive system_health.
  const chatId = topic === "system_health" ? ALERT_CHAT_ID : PRIMARY_DM_CHAT_ID;
  const useLegacyTopicRouting = process.env.TELEGRAM_USE_TOPIC_ROUTING === "1";

  try {
    let body: string;

    if (useLegacyTopicRouting && cfg) {
      const topicInfo = cfg.topics[topic];
      if (!topicInfo) {
        console.error(`[telegram] Unknown topic: ${topic}`);
        return false;
      }
      body = JSON.stringify({
        chat_id: cfg.groupId,
        message_thread_id: topicInfo.id,
        text,
        parse_mode: parseMode,
      });
    } else {
      body = JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      });
    }

    const result = execFileSync(
      "curl",
      [
        "-s",
        "-X",
        "POST",
        `https://api.telegram.org/bot${token}/sendMessage`,
        "-H",
        "Content-Type: application/json",
        "-d",
        body,
      ],
      { timeout: 10_000, encoding: "utf-8" },
    );

    const data = JSON.parse(result);
    return data.ok === true;
  } catch (err: any) {
    console.error(`[telegram] Failed to send (${topic}):`, err.message);
    return false;
  }
}

export function truncateForTelegram(text: string, maxLen = 4000): string {
  if (text.length <= maxLen) {
    return text;
  }
  return text.slice(0, maxLen - 20) + "\n\n[...truncated]";
}
