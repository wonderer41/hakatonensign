import "dotenv/config";
import { loadGitHubAutoSyncConfig } from "@/lib/integrations/github/config";
import { GitHubAutoSync } from "@/lib/integrations/github/polling";
import { TelegramClient } from "@/lib/integrations/telegram/client";
import { continuumReader } from "@/lib/integrations/telegram/commands";
import { loadTelegramConfig } from "@/lib/integrations/telegram/config";
import { notifyNewGitHubEvents } from "@/lib/integrations/telegram/notifications";
import { pollTelegram } from "@/lib/integrations/telegram/polling";

async function main(): Promise<void> {
  const config = loadTelegramConfig();
  const client = new TelegramClient(config.token);
  const bot = await client.getMe();
  const botName = bot.username ? `@${bot.username}` : "Telegram bot";

  if (config.allowedChatIds.size === 0) {
    console.warn("TELEGRAM_ALLOWED_CHAT_IDS is empty; commands will be ignored until a chat ID is allowlisted.");
  }
  console.log(`Starting ${botName} with long polling`);

  let autoSync: GitHubAutoSync | null = null;
  try {
    const githubConfig = loadGitHubAutoSyncConfig(process.env, config.projectId);
    if (githubConfig) {
      autoSync = new GitHubAutoSync({
        config: githubConfig,
        onNewEvents: async (events) => {
          const project = await continuumReader.getProject(config.projectId);
          if (!project) {
            console.error("GitHub auto-sync found events, but the configured project was not found");
            return;
          }
          await notifyNewGitHubEvents(client, config.allowedChatIds, project.name, events);
        },
        log: (message) => console.error(`GitHub auto-sync: ${message}`),
      });
      console.log(`GitHub auto-sync enabled for ${githubConfig.owner}/${githubConfig.repo} every ${githubConfig.intervalMs}ms`);
    } else {
      console.log("GitHub auto-sync disabled: GITHUB_SYNC_OWNER and GITHUB_SYNC_REPO are not configured");
    }
  } catch (error) {
    console.error(error instanceof Error ? `GitHub auto-sync disabled: ${error.message}` : "GitHub auto-sync disabled");
  }

  const controller = new AbortController();
  const shutdown = () => {
    if (!controller.signal.aborted) {
      console.log("Stopping Telegram polling");
      controller.abort();
    }
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    autoSync?.start();
    await pollTelegram({ client, config }, controller.signal);
  } finally {
    await autoSync?.stop();
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Telegram bot failed to start");
  process.exitCode = 1;
});
