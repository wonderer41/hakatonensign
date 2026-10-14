import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "@/lib/api/http";
import { mergeMeta } from "@/lib/dashboard/json";
import { formatMetaLine } from "@/lib/dashboard/meta-line";
import type { LiveEvent } from "@/types/dashboard-contracts";
import {
  type CardMetaStore,
  type CardToSync,
  formatCardMetaResult,
  type GithubCardMeta,
  runGithubCardMetaJob,
  syncGithubCardMeta,
} from "./card-meta";
import { fetchRepoActivity, parseRepoFullName } from "./repo-activity";

const TOKEN = "github_pat_TEST_TOKEN_123456";
const NOW = new Date("2026-10-14T18:00:00.000Z");
const SINCE = "2026-10-07T18:00:00.000Z";

// ---------- a fake GitHub behind an injected fetch ----------

interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}
interface Call {
  path: string;
  params: URLSearchParams;
  headers: Headers;
}

function commit(date: string, sha = date) {
  return { sha, commit: { author: { date: "2020-01-01T00:00:00Z" }, committer: { date } } };
}

function fakeGithub(handler: (url: URL, calls: Call[]) => Reply | Error) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, params: url.searchParams, headers: new Headers(init?.headers) });
    const reply = handler(url, calls);
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200, headers: reply.headers });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** Repos by "owner/repo": the default branch and the commits (newest first) the fake serves. */
function reposServer(repos: Record<string, { branch?: string; commits: ReturnType<typeof commit>[] } | "missing" | "empty">) {
  return fakeGithub((url) => {
    const [, , owner, repo, tail] = url.pathname.split("/");
    const entry = repos[`${owner}/${repo}`];
    if (!entry || entry === "missing") return { status: 404, body: { message: "Not Found" } };
    if (!tail) return { body: { default_branch: entry === "empty" ? "main" : (entry.branch ?? "main") } };
    if (entry === "empty") return { status: 409, body: { message: "Git Repository is empty." } };
    const since = url.searchParams.get("since");
    const visible = since ? entry.commits.filter((c) => Date.parse(c.commit.committer.date) >= Date.parse(since)) : entry.commits;
    return { body: visible.slice(0, Number(url.searchParams.get("per_page"))) };
  });
}

// ---------- in-memory store with the same contract as the SQL one ----------

interface StoredCard extends CardToSync {
  meta: Record<string, unknown>;
  lastActivityAt: string | null;
  version: number;
  updatedAt: Date;
}

function memoryStore(cards: Array<{ id: string; repoFullName: string; meta?: Record<string, unknown> }>) {
  const rows = new Map<string, StoredCard>(
    cards.map((card) => [card.id, { ...card, meta: card.meta ?? {}, lastActivityAt: null, version: 1, updatedAt: new Date(0) }]),
  );
  const store: CardMetaStore = {
    listCards: async () => [...rows.values()].map(({ id, repoFullName, meta }) => ({ id, repoFullName, meta })),
    saveGithubMeta: async (cardId, github: GithubCardMeta, changed, now) => {
      const row = rows.get(cardId);
      assert.ok(row, "unknown card");
      row.meta = mergeMeta(row.meta, { github });
      row.lastActivityAt = github.lastCommitAt;
      if (changed) row.updatedAt = now;
    },
  };
  return { store, rows };
}

const fakeEnv = { GITHUB_TOKEN: TOKEN } as unknown as NodeJS.ProcessEnv;

function collectEvents() {
  const events: LiveEvent[] = [];
  return { events, publish: async (event: LiveEvent) => void events.push(event) };
}

// ---------- fetchRepoActivity ----------

test("repo names must be owner/repo and can't climb the URL path", () => {
  assert.deepEqual(parseRepoFullName(" wonderer41/homelab-dashboard "), { owner: "wonderer41", repo: "homelab-dashboard" });
  for (const bad of ["homelab", "a/b/c", "a/..", "../b", "https://github.com/a/b", "a/b c", ""]) {
    assert.equal(parseRepoFullName(bad), null, bad);
  }
});

test("week with commits: count, newest committer date, and the request GitHub sees", async () => {
  const { fetchImpl, calls } = reposServer({
    "me/app": {
      branch: "trunk",
      commits: [commit("2026-10-14T16:31:05Z"), commit("2026-10-13T09:00:00Z"), commit("2026-10-09T09:00:00Z"), commit("2026-10-01T09:00:00Z")],
    },
  });
  const activity = await fetchRepoActivity("me/app", TOKEN, NOW, fetchImpl);
  assert.deepEqual(activity, { defaultBranch: "trunk", lastCommitAt: "2026-10-14T16:31:05.000Z", weeklyCommits: 3 });

  assert.deepEqual(calls.map((call) => call.path), ["/repos/me/app", "/repos/me/app/commits"]);
  const list = calls[1].params;
  assert.equal(list.get("sha"), "trunk");
  assert.equal(list.get("since"), SINCE);
  assert.equal(list.get("per_page"), "100");
  for (const call of calls) {
    assert.equal(call.headers.get("authorization"), `Bearer ${TOKEN}`);
    assert.equal(call.headers.get("accept"), "application/vnd.github+json");
    assert.equal(call.headers.get("x-github-api-version"), "2022-11-28");
  }
});

test("the newest committer date wins even if GitHub lists commits out of order", async () => {
  const { fetchImpl } = reposServer({ "me/app": { commits: [commit("2026-10-12T00:00:00Z"), commit("2026-10-13T00:00:00Z")] } });
  assert.equal((await fetchRepoActivity("me/app", TOKEN, NOW, fetchImpl)).lastCommitAt, "2026-10-13T00:00:00.000Z");
});

test("nothing this week: the latest commit ever comes from a second query without since", async () => {
  const { fetchImpl, calls } = reposServer({ "me/app": { commits: [commit("2026-09-20T12:00:00Z"), commit("2026-09-01T12:00:00Z")] } });
  const activity = await fetchRepoActivity("me/app", TOKEN, NOW, fetchImpl);
  assert.deepEqual(activity, { defaultBranch: "main", lastCommitAt: "2026-09-20T12:00:00.000Z", weeklyCommits: 0 });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].params.has("since"), false);
  assert.equal(calls[2].params.get("per_page"), "1");
  assert.equal(calls[2].params.get("sha"), "main");
});

test("an empty repository (409) means no commits, not an error", async () => {
  const { fetchImpl } = reposServer({ "me/new": "empty" });
  assert.deepEqual(await fetchRepoActivity("me/new", TOKEN, NOW, fetchImpl), { defaultBranch: "main", lastCommitAt: null, weeklyCommits: 0 });
});

test("follows Link rel=next for at most 3 pages of 100", async () => {
  const page = Array.from({ length: 100 }, (_, i) => commit(`2026-10-14T10:${String(i % 60).padStart(2, "0")}:00Z`, `sha${i}`));
  const { fetchImpl, calls } = fakeGithub((url) => {
    if (!url.pathname.endsWith("/commits")) return { body: { default_branch: "main" } };
    const next = new URL(url);
    next.searchParams.set("page", String(Number(url.searchParams.get("page") ?? "1") + 1));
    return { body: page, headers: { link: `<${next.toString()}>; rel="next", <${next.toString()}>; rel="last"` } };
  });
  const activity = await fetchRepoActivity("me/busy", TOKEN, NOW, fetchImpl);
  assert.equal(activity.weeklyCommits, 300);
  assert.deepEqual(calls.filter((call) => call.path.endsWith("/commits")).map((call) => call.params.get("page")), [null, "2", "3"]);
});

test("a Link to another host is never followed (the token stays on api.github.com)", async () => {
  const { fetchImpl, calls } = fakeGithub((url) =>
    url.pathname.endsWith("/commits")
      ? { body: [commit("2026-10-14T10:00:00Z")], headers: { link: '<https://evil.example/steal?page=2>; rel="next"' } }
      : { body: { default_branch: "main" } },
  );
  const activity = await fetchRepoActivity("me/app", TOKEN, NOW, fetchImpl);
  assert.equal(activity.weeklyCommits, 1);
  assert.equal(calls.length, 2);
});

test("failures become short messages that never contain the token", async () => {
  const cases: Array<[Reply | Error, RegExp, string]> = [
    [{ status: 404 }, /me\/app was not found, or GITHUB_TOKEN can't read it/, "NOT_FOUND"],
    [{ status: 401 }, /rejected GITHUB_TOKEN/, "UPSTREAM_ERROR"],
    [{ status: 403, headers: { "x-ratelimit-remaining": "0" } }, /rate limit exceeded/, "RATE_LIMITED"],
    [{ status: 429 }, /rate limit exceeded/, "RATE_LIMITED"],
    [{ status: 403 }, /denied access to me\/app \(403\)/, "UPSTREAM_ERROR"],
    [{ status: 500 }, /HTTP 500/, "UPSTREAM_ERROR"],
    [{ body: { name: "no default branch" } }, /no default branch/, "UPSTREAM_ERROR"],
    [new TypeError(`fetch failed: Bearer ${TOKEN}`), /could not be reached/, "UPSTREAM_ERROR"],
    [Object.assign(new Error("aborted"), { name: "TimeoutError" }), /did not answer within 10 s/, "UPSTREAM_ERROR"],
  ];
  for (const [reply, message, code] of cases) {
    const { fetchImpl } = fakeGithub(() => reply);
    await assert.rejects(fetchRepoActivity("me/app", TOKEN, NOW, fetchImpl), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.code, code);
      assert.match(error.message, message);
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    });
  }
  await assert.rejects(fetchRepoActivity("nope", TOKEN, NOW, fakeGithub(() => ({})).fetchImpl), (error: unknown) => error instanceof HttpError && error.code === "VALIDATION_ERROR");
});

// ---------- syncGithubCardMeta ----------

test("writes meta.github and lastActivityAt, keeps other keys, publishes for changed cards only", async () => {
  const github = reposServer({ "me/app": { commits: [commit("2026-10-14T16:31:05Z"), commit("2026-10-13T09:00:00Z")] } });
  const { store, rows } = memoryStore([{ id: "c1", repoFullName: "me/app", meta: { note: "design phase" } }]);
  const { events, publish } = collectEvents();

  const result = await syncGithubCardMeta(NOW, { store, fetch: github.fetchImpl, env: fakeEnv, publish });

  assert.deepEqual(result.updated.map((entry) => entry.cardId), ["c1"]);
  assert.equal(result.unchanged.length + result.failed.length, 0);
  const row = rows.get("c1");
  assert.ok(row);
  assert.deepEqual(row.meta, {
    note: "design phase",
    github: { defaultBranch: "main", lastCommitAt: "2026-10-14T16:31:05.000Z", weeklyCommits: 2, syncedAt: NOW.toISOString() },
  });
  assert.equal(row.lastActivityAt, "2026-10-14T16:31:05.000Z");
  assert.equal(row.version, 1);
  assert.deepEqual(events, [{ type: "card.upserted", cardId: "c1" }]);
  // The result carries the meta the page will format.
  assert.equal(formatMetaLine({ repoFullName: "me/app", meta: result.updated[0].meta }, NOW, "America/Denver"), "last commit 10:31 · 2 this week · design phase");
});

test("a second run with the same data is unchanged: syncedAt moves, nothing is published, updatedAt stays", async () => {
  const github = reposServer({ "me/app": { commits: [commit("2026-10-14T16:31:05Z")] } });
  const { store, rows } = memoryStore([{ id: "c1", repoFullName: "me/app" }]);
  const { events, publish } = collectEvents();
  await syncGithubCardMeta(NOW, { store, fetch: github.fetchImpl, env: fakeEnv, publish });
  const updatedAt = rows.get("c1")?.updatedAt;

  const later = new Date(NOW.getTime() + 5 * 60_000);
  const result = await syncGithubCardMeta(later, { store, fetch: github.fetchImpl, env: fakeEnv, publish });

  assert.deepEqual(result.unchanged.map((entry) => entry.cardId), ["c1"]);
  assert.equal(result.updated.length, 0);
  assert.equal(events.length, 1);
  assert.equal((rows.get("c1")?.meta.github as GithubCardMeta).syncedAt, later.toISOString());
  assert.equal(rows.get("c1")?.updatedAt, updatedAt);
});

test("a commit aging out of the 7-day window counts as a change", async () => {
  const commits = [commit("2026-10-14T16:31:05Z"), commit("2026-10-08T09:00:00Z")];
  const github = reposServer({ "me/app": { commits } });
  const { store } = memoryStore([{ id: "c1", repoFullName: "me/app" }]);
  const { events, publish } = collectEvents();
  await syncGithubCardMeta(NOW, { store, fetch: github.fetchImpl, env: fakeEnv, publish });

  // Two days later the Oct 8 commit is outside the 7-day window.
  const result = await syncGithubCardMeta(new Date("2026-10-16T18:00:00Z"), { store, fetch: github.fetchImpl, env: fakeEnv, publish });
  assert.equal(result.updated.length, 1);
  assert.equal((result.updated[0].meta.github as GithubCardMeta).weeklyCommits, 1);
  assert.equal(events.length, 2);
});

test("one repo failing does not stop the others, and its old meta is left alone", async () => {
  const github = reposServer({ "me/good": { commits: [commit("2026-10-14T16:31:05Z")] }, "me/gone": "missing" });
  const oldGithub = { defaultBranch: "main", lastCommitAt: "2026-10-01T00:00:00.000Z", weeklyCommits: 0, syncedAt: "2026-10-01T00:05:00.000Z" };
  const { store, rows } = memoryStore([
    { id: "c1", repoFullName: "me/gone", meta: { github: oldGithub } },
    { id: "c2", repoFullName: "me/good" },
    { id: "c3", repoFullName: "bad name" },
  ]);
  const { events, publish } = collectEvents();

  const result = await syncGithubCardMeta(NOW, { store, fetch: github.fetchImpl, env: fakeEnv, publish });

  assert.deepEqual(result.updated.map((entry) => entry.cardId), ["c2"]);
  assert.deepEqual(result.failed.map((entry) => [entry.cardId, entry.message]), [
    ["c1", "me/gone was not found, or GITHUB_TOKEN can't read it"],
    ["c3", '"bad name" is not an owner/repo name'],
  ]);
  assert.deepEqual(rows.get("c1")?.meta, { github: oldGithub });
  assert.deepEqual(result.failed[0].meta, { github: oldGithub });
  assert.deepEqual(events, [{ type: "card.upserted", cardId: "c2" }]);
});

test("cards on the same repo share one set of GitHub calls", async () => {
  const github = reposServer({ "me/app": { commits: [commit("2026-10-14T16:31:05Z")] } });
  const { store } = memoryStore([
    { id: "c1", repoFullName: "me/app" },
    { id: "c2", repoFullName: "ME/App" },
  ]);
  const result = await syncGithubCardMeta(NOW, { store, fetch: github.fetchImpl, env: fakeEnv, publish: async () => {} });
  assert.equal(result.updated.length, 2);
  assert.equal(github.calls.length, 2);
});

test("no cards with repos: GitHub is never called and a missing token is not an error", async () => {
  const github = reposServer({});
  const { store } = memoryStore([]);
  const result = await syncGithubCardMeta(NOW, { store, fetch: github.fetchImpl, env: {} as NodeJS.ProcessEnv, publish: async () => {} });
  assert.deepEqual(result, { updated: [], unchanged: [], failed: [] });
  assert.equal(github.calls.length, 0);
  assert.equal(formatCardMetaResult(result), "no cards with repos");
  assert.equal(await runGithubCardMetaJob(NOW, { store, fetch: github.fetchImpl, env: {} as NodeJS.ProcessEnv }), "no cards with repos");
});

test("a missing GITHUB_TOKEN with cards to sync throws a clear error", async () => {
  const github = reposServer({});
  const { store } = memoryStore([{ id: "c1", repoFullName: "me/app" }]);
  for (const env of [{}, { GITHUB_TOKEN: "  " }]) {
    await assert.rejects(
      syncGithubCardMeta(NOW, { store, fetch: github.fetchImpl, env: env as unknown as NodeJS.ProcessEnv }),
      (error: unknown) => error instanceof HttpError && error.code === "UPSTREAM_ERROR" && error.message === "GITHUB_TOKEN is not configured",
    );
  }
  assert.equal(github.calls.length, 0);
});

test("the worker summary: counts, reasons on failure, and a thrown error only when every card failed", async () => {
  const github = reposServer({ "me/good": { commits: [commit("2026-10-14T16:31:05Z")] }, "me/gone": "missing" });
  const mixed = memoryStore([
    { id: "c1", repoFullName: "me/good" },
    { id: "c2", repoFullName: "me/gone" },
  ]);
  const summary = await runGithubCardMetaJob(NOW, { store: mixed.store, fetch: github.fetchImpl, env: fakeEnv, publish: async () => {} });
  assert.equal(summary, "updated 1 · unchanged 0 · failed 1 (me/gone: me/gone was not found, or GITHUB_TOKEN can't read it)");

  const allGone = memoryStore([{ id: "c3", repoFullName: "me/gone" }]);
  await assert.rejects(
    runGithubCardMetaJob(NOW, { store: allGone.store, fetch: github.fetchImpl, env: fakeEnv, publish: async () => {} }),
    /updated 0 · unchanged 0 · failed 1/,
  );

  const again = await runGithubCardMetaJob(NOW, { store: mixed.store, fetch: github.fetchImpl, env: fakeEnv, publish: async () => {} });
  assert.match(again, /^updated 0 · unchanged 1 · failed 1 /);
});
