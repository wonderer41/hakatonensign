CREATE TABLE "TelegramCatchupCheckpoint" (
    "id" UUID NOT NULL,
    "telegramChatId" VARCHAR(32) NOT NULL,
    "telegramUserId" VARCHAR(32) NOT NULL,
    "projectId" UUID NOT NULL,
    "checkpointAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramCatchupCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_catchup_scope_key"
ON "TelegramCatchupCheckpoint"("telegramChatId", "telegramUserId", "projectId");

ALTER TABLE "TelegramCatchupCheckpoint"
ADD CONSTRAINT "TelegramCatchupCheckpoint_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
