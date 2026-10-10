import { prisma } from "@/lib/db/prisma";

export interface CatchupCheckpointStore {
  get(telegramChatId: string, telegramUserId: string, projectId: string): Promise<Date | null>;
  save(telegramChatId: string, telegramUserId: string, projectId: string, checkpointAt: Date): Promise<void>;
}

export const catchupCheckpointStore: CatchupCheckpointStore = {
  async get(telegramChatId, telegramUserId, projectId) {
    const row = await prisma.telegramCatchupCheckpoint.findUnique({
      where: { telegramChatId_telegramUserId_projectId: { telegramChatId, telegramUserId, projectId } },
      select: { checkpointAt: true },
    });
    return row?.checkpointAt ?? null;
  },
  async save(telegramChatId, telegramUserId, projectId, checkpointAt) {
    await prisma.telegramCatchupCheckpoint.upsert({
      where: { telegramChatId_telegramUserId_projectId: { telegramChatId, telegramUserId, projectId } },
      create: { telegramChatId, telegramUserId, projectId, checkpointAt },
      update: { checkpointAt },
    });
  },
};
