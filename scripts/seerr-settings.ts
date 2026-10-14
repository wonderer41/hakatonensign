// Prints Seerr's Radarr/Sonarr servers with their root folders and quality profiles, then checks the
// SEERR_* library mapping in .env against them. Read-only: nothing in Seerr is changed.
// Usage: npm run seerr:settings
import "dotenv/config";
import { getArrOptions, getArrServers, type SeerrArrKind, type SeerrArrOptions, type SeerrArrServer } from "@/lib/integrations/seerr/client";
import { loadSeerrConfig, loadSeerrLibraryMapping, type SeerrLibraryTarget } from "@/lib/integrations/seerr/config";

const LABEL: Record<SeerrArrKind, string> = { radarr: "Radarr (movies)", sonarr: "Sonarr (shows)" };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function gigabytes(bytes: number | null): string {
  return bytes === null ? "" : `  (${Math.round(bytes / 1024 ** 3)} GB free)`;
}

function samePath(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

function printServer(kind: SeerrArrKind, server: SeerrArrServer, options: SeerrArrOptions | string): void {
  const flags = [server.isDefault ? "default" : null, server.is4k ? "4K server" : "non-4K server"].filter(Boolean).join(", ");
  console.log(`  serverId ${server.id} · ${server.name} (${flags})`);
  console.log(`    default root folder     ${server.activeDirectory ?? "—"}`);
  console.log(`    default profile         ${server.activeProfileId ?? "—"} ${server.activeProfileName ?? ""}`.trimEnd());
  if (kind === "sonarr") {
    console.log(`    anime root folder       ${server.activeAnimeDirectory ?? "—"}`);
    console.log(`    anime profile           ${server.activeAnimeProfileId ?? "—"} ${server.activeAnimeProfileName ?? ""}`.trimEnd());
  }
  if (typeof options === "string") {
    console.log(`    (root folders and profiles unavailable: ${options})`);
    return;
  }
  console.log("    root folders");
  for (const folder of options.rootFolders) console.log(`      ${folder.path}${gigabytes(folder.freeSpace)}`);
  if (options.rootFolders.length === 0) console.log("      (none)");
  console.log("    quality profiles");
  for (const profile of options.profiles) console.log(`      ${String(profile.id).padStart(3)}  ${profile.name}`);
  if (options.profiles.length === 0) console.log("      (none)");
}

function checkTarget(
  label: string,
  kind: SeerrArrKind,
  target: SeerrLibraryTarget,
  servers: Map<string, { server: SeerrArrServer; options: SeerrArrOptions | string }>,
): boolean {
  const found = servers.get(`${kind}:${target.serverId}`);
  const problems: string[] = [];
  let profileName = "";
  if (!found) {
    problems.push(`no ${kind} server ${target.serverId}`);
  } else if (typeof found.options === "string") {
    problems.push("could not read its root folders/profiles");
  } else {
    if (!found.options.rootFolders.some((folder) => samePath(folder.path, target.rootFolder))) problems.push("root folder not found");
    const profile = found.options.profiles.find((candidate) => candidate.id === target.profileId);
    if (profile) profileName = ` (${profile.name})`;
    else problems.push("profile not found");
  }
  const line = `  ${label.padEnd(17)} ${kind} ${target.serverId} · ${target.rootFolder} · profile ${target.profileId}${profileName}`;
  console.log(problems.length ? `${line}  ✗ ${problems.join("; ")}` : `${line}  ✓`);
  return problems.length === 0;
}

async function main(): Promise<void> {
  const config = loadSeerrConfig();
  console.log(`Seerr · ${config.baseUrl}`);

  const servers = new Map<string, { server: SeerrArrServer; options: SeerrArrOptions | string }>();
  for (const kind of ["radarr", "sonarr"] as const) {
    const list = await getArrServers(config, kind);
    console.log(`\n${LABEL[kind]} · ${list.length} server(s)`);
    for (const server of list) {
      const options = await getArrOptions(config, kind, server.id).catch((error: unknown) => message(error));
      servers.set(`${kind}:${server.id}`, { server, options });
      printServer(kind, server, options);
    }
  }

  console.log("\nLibrary mapping in .env");
  let mapping;
  try {
    mapping = loadSeerrLibraryMapping();
  } catch (error) {
    console.log(`  incomplete: ${message(error)}`);
    process.exitCode = 1;
    return;
  }
  const results = [
    checkTarget("movie · temp", "radarr", mapping.movie.temp, servers),
    checkTarget("movie · permanent", "radarr", mapping.movie.permanent, servers),
    checkTarget("movie · anime", "radarr", mapping.movie.anime, servers),
    checkTarget("show · temp", "sonarr", mapping.tv.temp, servers),
    checkTarget("show · permanent", "sonarr", mapping.tv.permanent, servers),
    checkTarget("show · anime", "sonarr", mapping.tv.anime, servers),
  ];
  // Seerr ignores is4k on PUT /request/{id}, so the dashboard doesn't send it; a 4K server in the mapping is still worth a note.
  for (const [kind, serverId] of [["radarr", mapping.movie.temp.serverId], ["sonarr", mapping.tv.temp.serverId]] as const) {
    const found = servers.get(`${kind}:${serverId}`);
    if (found?.server.is4k) {
      console.log(`  note              ${kind} ${serverId} is marked as a 4K server in Seerr; requests moved there keep the is4k they were created with`);
    }
  }
  if (results.includes(false)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(message(error));
  process.exitCode = 1;
});
