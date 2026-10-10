import type { WorkEvent } from "@/types/contracts";
import type { TelegramClient } from "./client";

const MAX_TELEGRAM_MESSAGE_LENGTH = 4_096;
const IMPORTANT_ACTIONS = new Set(["pr_opened", "pr_merged", "issue_closed"]);

export interface TelegramNotifier {
  sendMessage(chatId: number, text: string): Promise<void>;
}

function eventLine(event: WorkEvent): string {
  return `• ${event.summary}`;
}

export function formatNewGitHubActivity(projectName: string, events: WorkEvent[]): string | null {
  const selected = events.filter((event) => IMPORTANT_ACTIONS.has(event.action));
  if (selected.length === 0) return null;

  const header = `Continuum — New activity\nProject: ${projectName}\n\n`;
  const lines: string[] = [];
  for (const event of selected) {
    const line = eventLine(event);
    if (`${header}${[...lines, line].join("\n")}`.length > MAX_TELEGRAM_MESSAGE_LENGTH - 80) break;
    lines.push(line);
  }
  if (lines.length === 0) lines.push("• New GitHub activity was recorded.");
  const suffix = selected.length > lines.length ? `\n…and ${selected.length - lines.length} more.` : "";
  return `${header}${lines.join("\n")}${suffix}`.slice(0, MAX_TELEGRAM_MESSAGE_LENGTH);
}

export async function notifyNewGitHubEvents(
  client: TelegramNotifier | TelegramClient,
  allowedChatIds: Set<string>,
  projectName: string,
  events: WorkEvent[],
  log: (message: string) => void = console.error,
): Promise<void> {
  const message = formatNewGitHubActivity(projectName, events);
  if (!message) return;

  for (const chatId of allowedChatIds) {
    try {
      await client.sendMessage(Number(chatId), message);
    } catch (error) {
      log(error instanceof Error ? `Telegram notification failed: ${error.message}` : "Telegram notification failed");
    }
  }
}
