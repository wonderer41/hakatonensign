// Runs one GitHub card-meta sync (the worker's github-sync job) and prints a line per card.
// Usage: npm run sync:github
import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { formatMetaLine } from "@/lib/dashboard/meta-line";
import { type CardMetaOutcome, syncGithubCardMeta } from "@/lib/integrations/github/card-meta";
import { dashboardTimeZone } from "@/lib/time/zone";

async function main(): Promise<void> {
  const timeZone = dashboardTimeZone();
  const now = new Date();
  const { updated, unchanged, failed } = await syncGithubCardMeta(now);

  const rows = [
    ...updated.map((entry) => ({ entry, status: "updated" })),
    ...unchanged.map((entry) => ({ entry, status: "unchanged" })),
    ...failed.map((entry) => ({ entry, status: `failed: ${entry.message}` })),
  ];
  if (rows.length === 0) {
    console.log("no cards with repos");
    return;
  }

  const metaLine = ({ repoFullName, meta }: CardMetaOutcome) => formatMetaLine({ repoFullName, meta }, now, timeZone) ?? "-";
  const lines = rows.map(({ entry, status }) => ({ repo: entry.repoFullName, line: metaLine(entry), status }));
  const repoWidth = Math.max(...lines.map(({ repo }) => repo.length));
  const lineWidth = Math.max(...lines.map(({ line }) => line.length));
  for (const { repo, line, status } of lines) console.log(`${repo.padEnd(repoWidth)}  ${line.padEnd(lineWidth)}  (${status})`);
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
