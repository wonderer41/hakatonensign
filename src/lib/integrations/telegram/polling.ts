import { buildAiRecoveryMessage, buildCatchupMessage, buildResumeMessage, buildStatusMessage, HELP_MESSAGE, START_MESSAGE, continuumReader, type AiRecoveryServices, type ContinuumReader } from "./commands";
import { catchupCheckpointStore, type CatchupCheckpointStore } from "./catchup-checkpoints";
import { TelegramApiError, TelegramClient, type TelegramUpdate } from "./client";
import type { TelegramBotConfig } from "./config";
import { HttpError } from "@/lib/api/http";

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
  aiRecovery?: AiRecoveryServices;
  checkpoints?: CatchupCheckpointStore;
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
  const command = commandName(message.text);
  try {
    switch (command) {
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
      case "/catchup":
        if (!message.from) {
          await options.client.sendMessage(message.chat.id, "I could not identify your Telegram user for this catchup. Please try again in a direct message.");
          break;
        }
        {
          const chatId = String(message.chat.id);
          const userId = String(message.from.id);
          const checkpoints = options.checkpoints ?? catchupCheckpointStore;
          const prepared = await buildCatchupMessage(options.config.projectId, chatId, userId, options.aiRecovery, checkpoints);
          await options.client.sendMessage(message.chat.id, prepared.text);
          await checkpoints.save(chatId, userId, options.config.projectId, prepared.checkpointAt);
        }
        break;
      case "/next":
        await options.client.sendMessage(message.chat.id, await buildAiRecoveryMessage(options.config.projectId, "next_action", options.aiRecovery));
        break;
      case "/meeting":
        await options.client.sendMessage(message.chat.id, await buildAiRecoveryMessage(options.config.projectId, "meeting_prep", options.aiRecovery));
        break;
      default:
        await options.client.sendMessage(message.chat.id, HELP_MESSAGE);
    }
  } catch (error) {
    if (["/catchup", "/next", "/meeting"].includes(command)) {
      options.log?.("Telegram AI context command failed");
      const code = error instanceof HttpError ? error.code : "";
      const messageText = code === "AI_NOT_CONFIGURED"
        ? "AI context recovery is not configured yet. Try /status or /resume instead."
        : code === "NOT_FOUND"
          ? "The configured Continuum project could not be found. Please ask an admin to check project selection."
          : code === "AI_CONTEXT_EMPTY"
            ? "There is not enough project activity to recover context yet."
            : "AI context recovery is unavailable right now. Please try again.";
      await options.client.sendMessage(message.chat.id, messageText);
      return;
    }
    options.log?.(error instanceof Error ? error.message : "Telegram command failed");
    const reply = error instanceof Error && error.message.startsWith("Configured Continuum project ")
      ? "The configured Continuum project could not be found. Please ask an admin to check project selection."
      : "Continuum could not load that right now. Please try again.";
    await options.client.sendMessage(message.chat.id, reply);
  }
}

export async function pollTelegram(options: PollingOptions, signal: AbortSignal): Promise<void> {
  let offset: number | null = null;
  while (!signal.aborted) {
    try {
      const updates = await options.client.getUpdates(offset, LONG_POLL_SECONDS, signal);
      for (const update of updates) {
        if (offset !== null && update.update_id < offset) continue;
        await handleTelegramUpdate(update, options);
        offset = update.update_id + 1;
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
