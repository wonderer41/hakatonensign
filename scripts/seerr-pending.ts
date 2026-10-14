// Dry run: prints Seerr's pending requests as the dashboard's DTOs, plus the library each one would land in
// for Temp and for Permanent. Read-only: nothing is approved, declined or edited.
// Usage: npm run seerr:pending
import "dotenv/config";
import { loadSeerrConfig, loadSeerrLibraryMapping, type SeerrLibraryMapping } from "@/lib/integrations/seerr/config";
import { chooseLibrary, isAnime, type SeerrLibraryChoice } from "@/lib/integrations/seerr/mapping";
import { toSeerrRequestDto } from "@/lib/integrations/seerr/normalize";
import { fetchPendingEntries } from "@/lib/integrations/seerr/pending";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const config = loadSeerrConfig();
  let mapping: SeerrLibraryMapping | null = null;
  try {
    mapping = loadSeerrLibraryMapping();
  } catch (error) {
    console.log(`Library mapping incomplete (${message(error)}); showing requests only.\n`);
  }

  const { total, entries } = await fetchPendingEntries(config);
  const shown = total > entries.length ? ` (showing the newest ${entries.length})` : "";
  console.log(`Seerr pending · ${total} request(s)${shown}`);

  for (const { request, details } of entries) {
    console.log("");
    console.log(JSON.stringify(toSeerrRequestDto(request, details), null, 2));
    if (!details) {
      console.log("  library     unknown: Seerr could not load the title details");
      continue;
    }
    if (details.keywordIds === null) {
      console.log("  library     unknown: Seerr sent no keywords, so anime can't be detected (approve would refuse)");
      continue;
    }
    const anime = isAnime(details.keywordIds);
    console.log(`  anime       ${anime ? "yes (TMDB keyword 210024)" : "no"}${request.is4k ? " · requested as 4K" : ""}`);
    if (!mapping) continue;
    const arr = request.mediaType === "movie" ? "radarr" : "sonarr";
    for (const choice of ["temp", "permanent"] as SeerrLibraryChoice[]) {
      const target = chooseLibrary(mapping, request.mediaType, anime, choice);
      const label = choice === "temp" ? "Temp" : "Permanent";
      console.log(`  ${label.padEnd(10)}  → ${target.kind} · ${arr} ${target.serverId} · ${target.rootFolder} · profile ${target.profileId}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(message(error));
  process.exitCode = 1;
});
