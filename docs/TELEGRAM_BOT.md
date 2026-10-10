# Telegram bot local setup

The bot runs as a separate process and uses long polling. It does not start with Next.js.

Set these values in the local `.env` file:

```dotenv
TELEGRAM_BOT_TOKEN=your-bot-token
CONTINUUM_DEMO_PROJECT_ID=your-project-uuid
TELEGRAM_ALLOWED_CHAT_IDS=
GITHUB_SYNC_OWNER=
GITHUB_SYNC_REPO=
GITHUB_SYNC_INTERVAL_MS=60000
```

The bot requires `TELEGRAM_BOT_TOKEN` and `CONTINUUM_DEMO_PROJECT_ID` at startup. Keep the token server-side and never paste it into a chat or commit it.

To find a chat ID safely:

1. Leave `TELEGRAM_ALLOWED_CHAT_IDS` empty and run `npm run bot:dev`.
2. Send `/start` to the bot. The bot ignores the command and logs only the numeric chat ID.
3. Stop the bot, add that ID to `TELEGRAM_ALLOWED_CHAT_IDS`, and restart it. For multiple chats, use comma-separated IDs.

An empty allowlist denies all commands. This makes chat ID discovery safe without disabling authorization for normal commands.

Run the bot with:

```bash
npm run bot:dev
```

Supported commands are `/start`, `/help`, `/status`, and `/resume`. Only one polling process may use a bot token at a time, and no Telegram webhook should be configured while polling.

If `GITHUB_SYNC_OWNER` and `GITHUB_SYNC_REPO` are set, the same process also runs GitHub auto-sync. It performs an initial baseline sync without notifications, then checks for new events at `GITHUB_SYNC_INTERVAL_MS` (60 seconds by default). It notifies the configured chats for newly inserted PR opened, PR merged, and issue closed events. Commit-only syncs remain silent.
