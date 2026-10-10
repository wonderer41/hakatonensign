import { buildResumeMessage, buildStatusMessage, HELP_MESSAGE, START_MESSAGE, continuumReader, type ContinuumReader } from "./commands";
import { TelegramApiError, TelegramClient, type TelegramUpdate } from "./client";
import type { TelegramBotConfig } from "./config";

const RETRY_DELAY_MS = 2_000;
const LONG_POLL_SECONDS = 25;

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function commandName(text: string): string {
  const firstWord = text.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  return firstWord.split("@", 1)[0];
}

export interface PollingOptions {
  client: TelegramClient;
  config: TelegramBotConfig;
  reader?: ContinuumReader;
  log?: (message: string) => void;
}

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  options: PollingOptions,
): Promise<void> {
  const message = update.message;
  if (!message?.text) return;

  const chatId = String(message.chat.id);
  if (!options.config.allowedChatIds.has(chatId)) {
    options.log?.(`Ignoring unauthorized Telegram chat ${chatId}`);
    return;
  }

  const reader = options.reader ?? continuumReader;
  try {
    switch (commandName(message.text)) {
      case "/start":
        await options.client.sendMessage(message.chat.id, START_MESSAGE);
        break;
      case "/help":
        await options.client.sendMessage(message.chat.id, HELP_MESSAGE);
        break;
      case "/status":
        await options.client.sendMessage(message.chat.id, await buildStatusMessage(reader, options.config.projectId));
        break;
      case "/resume":
        await options.client.sendMessage(message.chat.id, await buildResumeMessage(reader, options.config.projectId));
        break;
      default:
        await options.client.sendMessage(message.chat.id, HELP_MESSAGE);
    }
  } catch (error) {
    options.log?.(error instanceof Error ? error.message : "Telegram command failed");
    await options.client.sendMessage(message.chat.id, "Continuum could not load that right now. Please try again.");
  }
}

export async function pollTelegram(options: PollingOptions, signal: AbortSignal): Promise<void> {
  let offset: number | null = null;
  while (!signal.aborted) {
    try {
      const updates = await options.client.getUpdates(offset, LONG_POLL_SECONDS, signal);
      for (const update of updates) {
        try {
          await handleTelegramUpdate(update, options);
        } finally {
          offset = update.update_id + 1;
        }
      }
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) break;
      if (error instanceof TelegramApiError && error.status === 409) {
        throw new Error("Telegram polling conflict: another polling process or webhook is active");
      }
      options.log?.(error instanceof Error ? error.message : "Telegram polling failed");
      await sleep(RETRY_DELAY_MS);
    }
  }
}
