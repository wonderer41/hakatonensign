const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TelegramBotConfig {
  token: string;
  projectId: string;
  allowedChatIds: Set<string>;
}

export function loadTelegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramBotConfig {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required to start the Telegram bot");
  }

  const projectId = env.CONTINUUM_DEMO_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error("CONTINUUM_DEMO_PROJECT_ID is required to start the Telegram bot");
  }
  if (!UUID_PATTERN.test(projectId)) {
    throw new Error("CONTINUUM_DEMO_PROJECT_ID must be a valid UUID");
  }

  const allowedChatIds = new Set(
    (env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const chatId of allowedChatIds) {
    if (!/^-?\d+$/.test(chatId)) {
      throw new Error("TELEGRAM_ALLOWED_CHAT_IDS must contain comma-separated numeric chat IDs");
    }
  }

  return { token, projectId, allowedChatIds };
}

