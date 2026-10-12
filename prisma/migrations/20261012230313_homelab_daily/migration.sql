/*
  Warnings:

  - You are about to drop the `TelegramCatchupCheckpoint` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "Actor" AS ENUM ('user', 'hermes', 'github', 'system');

-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('planned', 'active', 'closed');

-- CreateEnum
CREATE TYPE "CardStatus" AS ENUM ('active', 'paused', 'done', 'archived');

-- CreateEnum
CREATE TYPE "CalendarEventKind" AS ENUM ('calendar', 'work_block');

-- CreateEnum
CREATE TYPE "CalendarEventStatus" AS ENUM ('confirmed', 'tentative', 'cancelled');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('checking', 'conflict', 'booked', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "BannerKind" AS ENUM ('gmail', 'orphans', 'scan', 'stocks');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('warning', 'critical');

-- CreateEnum
CREATE TYPE "ProgressKind" AS ENUM ('looks_done', 'partial');

-- CreateEnum
CREATE TYPE "ProgressStatus" AS ENUM ('pending', 'confirmed', 'dismissed');

-- DropForeignKey
ALTER TABLE "TelegramCatchupCheckpoint" DROP CONSTRAINT "TelegramCatchupCheckpoint_projectId_fkey";

-- DropTable
DROP TABLE "TelegramCatchupCheckpoint";

-- CreateTable
CREATE TABLE "Sprint" (
    "id" UUID NOT NULL,
    "externalKey" VARCHAR(200),
    "name" VARCHAR(120) NOT NULL,
    "goal" VARCHAR(500),
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" "SprintStatus" NOT NULL DEFAULT 'planned',
    "createdBy" "Actor" NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkCard" (
    "id" UUID NOT NULL,
    "externalKey" VARCHAR(200),
    "title" VARCHAR(160) NOT NULL,
    "repoFullName" VARCHAR(200),
    "milestoneTitle" VARCHAR(160),
    "sprintId" UUID,
    "projectId" UUID,
    "status" "CardStatus" NOT NULL DEFAULT 'active',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdBy" "Actor" NOT NULL DEFAULT 'user',
    "hermesSuggestion" VARCHAR(300),
    "lastActivityAt" TIMESTAMP(3),
    "meta" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "externalKey" VARCHAR(200),
    "title" VARCHAR(200) NOT NULL,
    "issueNumber" INTEGER,
    "sourceUrl" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdBy" "Actor" NOT NULL DEFAULT 'user',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" UUID NOT NULL,
    "calendarId" VARCHAR(200) NOT NULL,
    "externalId" VARCHAR(1024) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "kind" "CalendarEventKind" NOT NULL DEFAULT 'calendar',
    "status" "CalendarEventStatus" NOT NULL DEFAULT 'confirmed',
    "checklistItemId" UUID,
    "alertId" UUID,
    "etag" VARCHAR(200),
    "htmlLink" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarSyncState" (
    "calendarId" VARCHAR(200) NOT NULL,
    "syncToken" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarSyncState_pkey" PRIMARY KEY ("calendarId")
);

-- CreateTable
CREATE TABLE "ScheduleRequest" (
    "id" UUID NOT NULL,
    "checklistItemId" UUID,
    "alertId" UUID,
    "requestedStart" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'checking',
    "conflictEventId" UUID,
    "suggestedStart" TIMESTAMP(3),
    "calendarEventId" UUID,
    "hermesRunId" VARCHAR(200),
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMessage" (
    "date" DATE NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "author" "Actor" NOT NULL DEFAULT 'user',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyMessage_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "BannerSnapshot" (
    "id" UUID NOT NULL,
    "kind" "BannerKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "pushedBy" "Actor" NOT NULL DEFAULT 'hermes',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BannerSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" UUID NOT NULL,
    "dedupeKey" VARCHAR(200) NOT NULL,
    "source" VARCHAR(100) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "detail" VARCHAR(500),
    "severity" "AlertSeverity" NOT NULL DEFAULT 'warning',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "meta" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemProgress" (
    "id" UUID NOT NULL,
    "checklistItemId" UUID NOT NULL,
    "repoFullName" VARCHAR(200) NOT NULL,
    "commitSha" VARCHAR(64) NOT NULL,
    "kind" "ProgressKind" NOT NULL,
    "note" VARCHAR(500) NOT NULL,
    "status" "ProgressStatus" NOT NULL DEFAULT 'pending',
    "pushedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" "Actor" NOT NULL DEFAULT 'hermes',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistSymbol" (
    "symbol" VARCHAR(16) NOT NULL,
    "position" INTEGER NOT NULL,
    "addedBy" "Actor" NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchlistSymbol_pkey" PRIMARY KEY ("symbol")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sprint_externalKey_key" ON "Sprint"("externalKey");

-- CreateIndex
CREATE INDEX "Sprint_status_startsOn_idx" ON "Sprint"("status", "startsOn");

-- CreateIndex
CREATE UNIQUE INDEX "WorkCard_externalKey_key" ON "WorkCard"("externalKey");

-- CreateIndex
CREATE INDEX "WorkCard_status_position_idx" ON "WorkCard"("status", "position");

-- CreateIndex
CREATE INDEX "WorkCard_sprintId_idx" ON "WorkCard"("sprintId");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistItem_externalKey_key" ON "ChecklistItem"("externalKey");

-- CreateIndex
CREATE INDEX "ChecklistItem_cardId_position_idx" ON "ChecklistItem"("cardId", "position");

-- CreateIndex
CREATE INDEX "CalendarEvent_startsAt_idx" ON "CalendarEvent"("startsAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_endsAt_idx" ON "CalendarEvent"("endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_calendarId_externalId_key" ON "CalendarEvent"("calendarId", "externalId");

-- CreateIndex
CREATE INDEX "ScheduleRequest_checklistItemId_createdAt_idx" ON "ScheduleRequest"("checklistItemId", "createdAt");

-- CreateIndex
CREATE INDEX "BannerSnapshot_kind_capturedAt_idx" ON "BannerSnapshot"("kind", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_dedupeKey_key" ON "Alert"("dedupeKey");

-- CreateIndex
CREATE INDEX "Alert_resolvedAt_openedAt_idx" ON "Alert"("resolvedAt", "openedAt");

-- CreateIndex
CREATE INDEX "ItemProgress_checklistItemId_createdAt_idx" ON "ItemProgress"("checklistItemId", "createdAt");

-- CreateIndex
CREATE INDEX "ItemProgress_status_idx" ON "ItemProgress"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ItemProgress_checklistItemId_commitSha_key" ON "ItemProgress"("checklistItemId", "commitSha");

-- CreateIndex
CREATE INDEX "WatchlistSymbol_position_idx" ON "WatchlistSymbol"("position");

-- AddForeignKey
ALTER TABLE "WorkCard" ADD CONSTRAINT "WorkCard_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCard" ADD CONSTRAINT "WorkCard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "WorkCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "ChecklistItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRequest" ADD CONSTRAINT "ScheduleRequest_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "ChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRequest" ADD CONSTRAINT "ScheduleRequest_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemProgress" ADD CONSTRAINT "ItemProgress_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "ChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
