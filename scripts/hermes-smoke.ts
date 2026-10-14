// End-to-end check of the Hermes write API (/api/hermes/*) against a running dev server.
// Usage: npm run dev   (in another terminal), then: npm run hermes:smoke
// Base URL: NEXT_PUBLIC_APP_URL. Token: HERMES_DASHBOARD_TOKEN. Both read from .env.
//
// Writes test rows with "smoke-" keys into the server's database: run it against a dev DB.
// Each run uses fresh keys; the card is archived at the end, the alert resolved, the sprint
// stays "planned" (never active, so a real active sprint is never closed), and the stocks
// snapshot is dated 2000-01-01 so it never becomes the newest one on the page.
// It also sets the stocks watchlist to the 12 default symbols (D9); when that changed the list
// and FINNHUB_API_KEY is set on the server, the stocks banner is refreshed.
// The script sends 52 /api/hermes/* requests (the API allows 60 per minute, so wait a minute
// between runs) plus a few same-origin browser requests (confirm/dismiss push notes).
import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import type {
  AlertDto,
  ChecklistItemDto,
  HermesBannerResult,
  HermesConflictDetails,
  HermesStateResponse,
  HermesWatchlist,
  HermesWatchlistResult,
  HermesWriteResult,
  ItemProgressDto,
  SprintDto,
  WorkCardDto,
} from "@/types/dashboard-contracts";
import { addDays, dashboardTimeZone, localDateString } from "@/lib/time/zone";

const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
const token = process.env.HERMES_DASHBOARD_TOKEN?.trim() ?? "";

interface Reply<T> {
  status: number;
  body: T;
}

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** bearer null = a browser request (same origin, no Authorization header). */
async function call<T>(method: string, path: string, body?: unknown, bearer: string | null = token): Promise<Reply<T>> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(bearer === null ? {} : { Authorization: `Bearer ${bearer}` }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // keep the raw text for the failure message
  }
  return { status: response.status, body: parsed as T };
}

const enc = encodeURIComponent;
let failures = 0;

/** D9 starting watchlist. */
const DEFAULT_WATCHLIST = ["NVDA", "AMD", "MU", "TSLA", "AMZN", "XOM", "CVX", "COP", "CEG", "VST", "NEE", "TSM"];

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectStatus(reply: Reply<unknown>, status: number): void {
  check(reply.status === status, `expected HTTP ${status}, got ${reply.status}: ${JSON.stringify(reply.body).slice(0, 300)}`);
}

async function step(name: string, run: () => Promise<string | void>): Promise<void> {
  try {
    const note = await run();
    console.log(`PASS  ${name}${note ? `  (${note})` : ""}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}  — ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  if (!token) throw new Error("HERMES_DASHBOARD_TOKEN is not set");

  const run = Date.now().toString(36);
  const today = localDateString(new Date(), dashboardTimeZone());
  const sprintKey = `hermes:sprint:smoke-${run}`;
  const cardKey = `hermes:card:smoke-${run}`;
  // The third key has "/" and "#", to prove URL-encoded keys survive the router.
  const itemKeys = [`hermes:item:smoke-${run}:step-1`, `hermes:item:smoke-${run}:step-2`, `github:issue:smoke-owner/smoke-${run}#3`];
  const alertKey = `smoke:run-${run}`;
  const capturedAt = new Date(Date.UTC(2000, 0, 1) + (Date.now() % 86_400_000)).toISOString();

  const sprintBody = { name: `Smoke sprint ${run}`, goal: "Prove the Hermes API", startsOn: today, endsOn: addDays(today, 6), status: "planned" };
  const cardBody = { title: `Smoke card ${run}`, sprintKey, hermesSuggestion: "Block 30 min for step 1?", meta: { source: "smoke" } };
  const itemBodies = [{ title: "Step one" }, { title: "Step two" }, { title: "Step three", issueNumber: 3 }];
  const stocksBody = {
    asOf: capturedAt,
    rows: [
      { symbol: "NVDA", price: 181.2, currency: "USD", dayChangePct: 1.4, sixMonthChangePct: 22.5 },
      { symbol: "XOM", price: 112.05, currency: "USD", dayChangePct: -0.3, sixMonthChangePct: -4.1 },
    ],
    capturedAt,
  };
  const alertBody = { source: "smoke", title: `Smoke alert ${run}`, detail: "Opened by npm run hermes:smoke", severity: "warning" };

  const cardPath = `/api/hermes/cards/${enc(cardKey)}`;
  const itemPath = (index: number) => `${cardPath}/items/${enc(itemKeys[index])}`;
  const idPath = (id: string) => enc(`id:${id}`);
  const shaA = randomBytes(20).toString("hex");
  const shaB = randomBytes(20).toString("hex");
  const pushRepo = `smoke-owner/smoke-${run}`;
  const alertPath = `/api/hermes/alerts/${enc(alertKey)}`;

  console.log(`Hermes smoke · ${base} · run ${run}\n`);

  let sprint: SprintDto | undefined;
  let card: WorkCardDto | undefined;
  const items: ChecklistItemDto[] = [];
  let alert: AlertDto | undefined;

  const state = async () => {
    const reply = await call<HermesStateResponse>("GET", "/api/hermes/state");
    expectStatus(reply, 200);
    return reply.body;
  };
  const stateCard = async () => {
    const found = (await state()).cards.find((c) => c.key === cardKey);
    check(found, "card missing from state");
    return found;
  };

  await step("GET state", async () => {
    const body = await state();
    check(Array.isArray(body.cards) && Array.isArray(body.alerts), "state has no cards/alerts arrays");
    return `${body.cards.length} cards, ${body.alerts.length} open alerts, date ${body.date}`;
  });

  await step("create sprint", async () => {
    const reply = await call<HermesWriteResult<SprintDto>>("PUT", `/api/hermes/sprints/${enc(sprintKey)}`, sprintBody);
    expectStatus(reply, 201);
    check(reply.body.created === true, "created should be true");
    sprint = reply.body.data;
    return `version ${sprint.version}`;
  });

  await step("create card linked to the sprint", async () => {
    const reply = await call<HermesWriteResult<WorkCardDto>>("PUT", cardPath, cardBody);
    expectStatus(reply, 201);
    check(reply.body.created === true, "created should be true");
    card = reply.body.data;
    check(card.sprintId === sprint?.id, "card.sprintId does not match the sprint");
    check(card.createdBy === "hermes", "createdBy should be hermes");
    return `position ${card.position}`;
  });

  for (const [index, body] of itemBodies.entries()) {
    await step(`create item ${index + 1}`, async () => {
      const reply = await call<HermesWriteResult<ChecklistItemDto>>("PUT", itemPath(index), body);
      expectStatus(reply, 201);
      check(reply.body.created === true, "created should be true");
      items[index] = reply.body.data;
      if (index > 0) check(items[index].position === items[index - 1].position + 1000, "positions should step by 1000");
      return `key ${reply.body.data.externalKey}, position ${reply.body.data.position}`;
    });
  }

  await step("mark item 2 current", async () => {
    const reply = await call<HermesWriteResult<ChecklistItemDto>>("PUT", itemPath(1), { ...itemBodies[1], isCurrent: true, version: items[1].version });
    expectStatus(reply, 200);
    check(reply.body.data.isCurrent && reply.body.data.version === items[1].version + 1, "item 2 should be current with version +1");
    items[1] = reply.body.data;
    const found = await stateCard();
    check(found.items.filter((i) => i.isCurrent).length === 1, "exactly one current item expected");
    check(found.current?.itemKey === itemKeys[1] && found.current.label === "now", "state.current should be item 2 (now)");
  });

  await step("mark item 3 current clears item 2", async () => {
    const reply = await call<HermesWriteResult<ChecklistItemDto>>("PUT", itemPath(2), { ...itemBodies[2], isCurrent: true, version: items[2].version });
    expectStatus(reply, 200);
    items[2] = reply.body.data;
    const found = await stateCard();
    const two = found.items.find((i) => i.key === itemKeys[1]);
    check(two && !two.isCurrent && two.version === items[1].version + 1, "item 2 should be cleared with a version bump");
    check(found.items.filter((i) => i.isCurrent).length === 1, "exactly one current item expected");
    items[1] = { ...items[1], isCurrent: false, version: two.version };
  });

  await step("push stocks banner", async () => {
    const reply = await call<HermesWriteResult<HermesBannerResult>>("PUT", "/api/hermes/banner/stocks", stocksBody);
    expectStatus(reply, 201);
    check(reply.body.created === true, "created should be true");
  });

  await step("open alert, repeat changes nothing", async () => {
    const first = await call<HermesWriteResult<AlertDto>>("PUT", alertPath, alertBody);
    expectStatus(first, 201);
    alert = first.body.data;
    const again = await call<HermesWriteResult<AlertDto>>("PUT", alertPath, alertBody);
    expectStatus(again, 200);
    check(again.body.created === false && JSON.stringify(again.body.data) === JSON.stringify(alert), "repeat should be a no-op");
  });

  await step("resolve alert, resolve again changes nothing", async () => {
    const first = await call<HermesWriteResult<AlertDto>>("POST", `${alertPath}/resolve`);
    expectStatus(first, 200);
    check(first.body.data.resolvedAt !== null, "resolvedAt should be set");
    const again = await call<HermesWriteResult<AlertDto>>("POST", `${alertPath}/resolve`);
    expectStatus(again, 200);
    check(again.body.data.resolvedAt === first.body.data.resolvedAt, "second resolve should not move resolvedAt");
    check(!(await state()).alerts.some((a) => a.dedupeKey === alertKey), "resolved alert still listed as open");
  });

  // Every upsert again, exactly as before: nothing may change.
  await step("repeat sprint → created:false, same version", async () => {
    const reply = await call<HermesWriteResult<SprintDto>>("PUT", `/api/hermes/sprints/${enc(sprintKey)}`, sprintBody);
    expectStatus(reply, 200);
    check(reply.body.created === false && reply.body.data.version === sprint?.version, "sprint changed on repeat");
  });
  await step("repeat card → created:false, same version", async () => {
    const reply = await call<HermesWriteResult<WorkCardDto>>("PUT", cardPath, cardBody);
    expectStatus(reply, 200);
    check(reply.body.created === false && reply.body.data.version === card?.version, "card changed on repeat");
  });
  for (const [index, body] of itemBodies.entries()) {
    await step(`repeat item ${index + 1} → created:false, same version`, async () => {
      const repeatBody = index === 2 ? { ...body, isCurrent: true } : body;
      const reply = await call<HermesWriteResult<ChecklistItemDto>>("PUT", itemPath(index), repeatBody);
      expectStatus(reply, 200);
      check(reply.body.created === false && reply.body.data.version === items[index].version, "item changed on repeat");
    });
  }
  await step("repeat stocks banner → created:false", async () => {
    const reply = await call<HermesWriteResult<HermesBannerResult>>("PUT", "/api/hermes/banner/stocks", stocksBody);
    expectStatus(reply, 200);
    check(reply.body.created === false, "banner inserted again on repeat");
  });

  await step("change card with the current version", async () => {
    const reply = await call<HermesWriteResult<WorkCardDto>>("PUT", cardPath, { ...cardBody, hermesSuggestion: null, version: card?.version });
    expectStatus(reply, 200);
    check(reply.body.data.version === (card?.version ?? 0) + 1 && reply.body.data.hermesSuggestion === null, "version should bump");
    card = reply.body.data;
  });

  await step("stale version → 409 CONFLICT", async () => {
    const reply = await call<ErrorBody>("PUT", cardPath, { ...cardBody, hermesSuggestion: null, title: "Renamed", version: (card?.version ?? 2) - 1 });
    expectStatus(reply, 409);
    const details = reply.body.error.details as HermesConflictDetails<WorkCardDto>;
    check(reply.body.error.code === "CONFLICT", "code should be CONFLICT");
    check(details.reason === "stale_version" && details.currentVersion === card?.version && details.data.title === cardBody.title, "details should carry the current card");
    return details.reason;
  });

  await step("change without version → 409 CONFLICT", async () => {
    const reply = await call<ErrorBody>("PUT", cardPath, { ...cardBody, hermesSuggestion: null, title: "Renamed" });
    expectStatus(reply, 409);
    return (reply.body.error.details as HermesConflictDetails<unknown>).reason;
  });

  await step("done without force → 409, with force → 200", async () => {
    const refused = await call<ErrorBody>("PUT", itemPath(0), { ...itemBodies[0], done: true, version: items[0].version });
    expectStatus(refused, 409);
    check((refused.body.error.details as HermesConflictDetails<unknown>).reason === "done_is_user_owned", "reason should be done_is_user_owned");
    const forced = await call<HermesWriteResult<ChecklistItemDto>>("PUT", itemPath(0), { ...itemBodies[0], done: true, force: true });
    expectStatus(forced, 200);
    check(forced.body.data.done && forced.body.data.doneAt !== null, "item should be done");
  });

  // ---- Addressing by id:<uuid> (cards, items and sprints created on the page have no key) ----
  await step("state lists ids for the sprint, card and items", async () => {
    const body = await state();
    const found = body.cards.find((c) => c.key === cardKey);
    check(found && found.id === card?.id, "state card.id should match the card");
    check(found.sprintId === sprint?.id && found.sprintKey === sprintKey, "state card should carry sprintId and sprintKey");
    check(body.sprints.some((s) => s.id === sprint?.id && s.key === sprintKey), "state sprint should carry its id");
    check(found.items.every((item, index) => item.id === items[index].id && Array.isArray(item.progress)), "state items should carry ids and progress");
    check(found.current?.itemId === items[2].id, "state current should carry itemId");
    check(Array.isArray(body.watchlist), "state should list the watchlist");
  });

  await step("repeat card via id:<uuid> (sprintKey by id too) → created:false, same version", async () => {
    const reply = await call<HermesWriteResult<WorkCardDto>>("PUT", `/api/hermes/cards/${idPath(card?.id ?? "")}`, {
      ...cardBody,
      sprintKey: `id:${sprint?.id}`,
      hermesSuggestion: null,
    });
    expectStatus(reply, 200);
    check(reply.body.created === false && reply.body.data.version === card?.version, "card changed on repeat by id");
  });

  await step("change card via id:<uuid> with the current version", async () => {
    const reply = await call<HermesWriteResult<WorkCardDto>>("PUT", `/api/hermes/cards/${idPath(card?.id ?? "")}`, {
      ...cardBody,
      hermesSuggestion: null,
      meta: { note: "smoke via id" },
      version: card?.version,
    });
    expectStatus(reply, 200);
    check(reply.body.data.id === card?.id && reply.body.data.externalKey === cardKey, "should update the same card");
    check(reply.body.data.version === (card?.version ?? 0) + 1, "version should bump");
    card = reply.body.data;
  });

  await step("repeat item via id:<uuid> under the card's id → created:false", async () => {
    const reply = await call<HermesWriteResult<ChecklistItemDto>>(
      "PUT",
      `/api/hermes/cards/${idPath(card?.id ?? "")}/items/${idPath(items[1].id)}`,
      itemBodies[1],
    );
    expectStatus(reply, 200);
    check(reply.body.created === false && reply.body.data.version === items[1].version, "item changed on repeat by id");
  });

  await step("unknown id → 404, malformed id → 400", async () => {
    const missing = await call<ErrorBody>("PUT", `/api/hermes/cards/${idPath(randomUUID())}`, cardBody);
    expectStatus(missing, 404);
    check(missing.body.error.code === "NOT_FOUND", "code should be NOT_FOUND");
    const malformed = await call<ErrorBody>("PUT", `/api/hermes/cards/${enc("id:not-a-uuid")}`, cardBody);
    expectStatus(malformed, 400);
    check(JSON.stringify(malformed.body.error.details) === JSON.stringify({ field: "key" }), "details.field should be key");
  });

  // ---- D7 push notes ----
  let noteA: ItemProgressDto | undefined;
  let noteB: ItemProgressDto | undefined;
  const noteBody = { repoFullName: pushRepo, kind: "looks_done", note: "Step two looks finished in this push", pushedAt: new Date().toISOString() };

  await step("push note looks_done → 201 pending (sha lowercased)", async () => {
    const reply = await call<HermesWriteResult<ItemProgressDto>>("PUT", `${itemPath(1)}/progress/${shaA.toUpperCase()}`, noteBody);
    expectStatus(reply, 201);
    noteA = reply.body.data;
    check(reply.body.created === true && noteA.status === "pending" && noteA.commitSha === shaA, "note should be pending with the lowercased sha");
    check(noteA.commitUrl === `https://github.com/${pushRepo}/commit/${shaA}`, "commitUrl should link the commit");
  });

  await step("repeat push note → 200 created:false", async () => {
    const reply = await call<HermesWriteResult<ItemProgressDto>>("PUT", `${itemPath(1)}/progress/${shaA}`, noteBody);
    expectStatus(reply, 200);
    check(reply.body.created === false && reply.body.data.id === noteA?.id, "repeat should hit the same note");
  });

  await step("state and the item DTO show the pending note", async () => {
    const found = (await stateCard()).items.find((item) => item.id === items[1].id);
    check(found?.progress.some((p) => p.kind === "looks_done" && p.commitSha === shaA), "state item should list the pending note");
    const reply = await call<HermesWriteResult<ChecklistItemDto>>("PUT", itemPath(1), itemBodies[1]);
    expectStatus(reply, 200);
    check(reply.body.data.progress.length === 1 && reply.body.data.progress[0].id === noteA?.id, "item DTO should carry the pending note");
  });

  await step("confirm looks_done (browser route) → item done, version +1", async () => {
    const reply = await call<ChecklistItemDto>("POST", `/api/items/${items[1].id}/progress/${noteA?.id}/confirm`, undefined, null);
    expectStatus(reply, 200);
    check(reply.body.done && reply.body.doneAt !== null, "item should be done");
    check(reply.body.version === items[1].version + 1, `version should be ${items[1].version + 1}, got ${reply.body.version}`);
    check(reply.body.progress.length === 0, "no pending notes should remain");
    const again = await call<ChecklistItemDto>("POST", `/api/items/${items[1].id}/progress/${noteA?.id}/confirm`, undefined, null);
    expectStatus(again, 200);
    check(again.body.version === reply.body.version && again.body.doneAt === reply.body.doneAt, "second confirm should change nothing");
    items[1] = reply.body;
  });

  await step("partial note, dismiss (browser route) → hidden, item untouched", async () => {
    const put = await call<HermesWriteResult<ItemProgressDto>>("PUT", `${itemPath(2)}/progress/${shaB}`, {
      ...noteBody,
      kind: "partial",
      note: "Started step three; tests still missing",
    });
    expectStatus(put, 201);
    noteB = put.body.data;
    const reply = await call<ChecklistItemDto>("POST", `/api/items/${items[2].id}/progress/${noteB.id}/dismiss`, {}, null);
    expectStatus(reply, 200);
    check(!reply.body.done && reply.body.version === items[2].version && reply.body.progress.length === 0, "dismiss should only hide the note");
    const again = await call<ChecklistItemDto>("POST", `/api/items/${items[2].id}/progress/${noteB.id}/dismiss`, undefined, null);
    expectStatus(again, 200);
  });

  await step("dismissed note re-sent with a new kind → pending again", async () => {
    const reply = await call<HermesWriteResult<ItemProgressDto>>("PUT", `${itemPath(2)}/progress/${shaB}`, { ...noteBody, note: "Step three done" });
    expectStatus(reply, 200);
    check(reply.body.created === false && reply.body.data.kind === "looks_done" && reply.body.data.status === "pending", "note should be pending again");
  });

  await step("note on the wrong item → 404, bad sha → 400", async () => {
    const wrong = await call<ErrorBody>("POST", `/api/items/${items[0].id}/progress/${noteB?.id}/confirm`, undefined, null);
    expectStatus(wrong, 404);
    const bad = await call<ErrorBody>("PUT", `${itemPath(2)}/progress/not-a-sha`, noteBody);
    expectStatus(bad, 400);
    check(JSON.stringify(bad.body.error.details) === JSON.stringify({ field: "sha" }), "details.field should be sha");
  });

  // ---- D9 watchlist ----
  await step("PUT watchlist (12 defaults)", async () => {
    const reply = await call<HermesWatchlistResult>("PUT", "/api/hermes/watchlist", { symbols: DEFAULT_WATCHLIST });
    expectStatus(reply, 200);
    check(JSON.stringify(reply.body.data.symbols) === JSON.stringify(DEFAULT_WATCHLIST), "symbols should be the defaults in order");
    check(typeof reply.body.changed === "boolean" && typeof reply.body.synced === "boolean", "changed and synced should be booleans");
    if (reply.body.changed && !reply.body.synced) check(typeof reply.body.syncError === "string", "syncError should explain why");
    return `changed ${reply.body.changed}, synced ${reply.body.synced}${reply.body.syncError ? `, syncError: ${reply.body.syncError}` : ""}`;
  });

  await step("PUT watchlist again, lowercase + duplicate → changed:false", async () => {
    const reply = await call<HermesWatchlistResult>("PUT", "/api/hermes/watchlist", { symbols: ["nvda", "NVDA", ...DEFAULT_WATCHLIST.slice(1)] });
    expectStatus(reply, 200);
    check(JSON.stringify(reply.body.data.symbols) === JSON.stringify(DEFAULT_WATCHLIST), "symbols should be normalized");
    check(reply.body.changed === false && reply.body.synced === false, "nothing should change or sync");
  });

  await step("GET watchlist and state.watchlist match", async () => {
    const reply = await call<{ data: HermesWatchlist }>("GET", "/api/hermes/watchlist");
    expectStatus(reply, 200);
    check(JSON.stringify(reply.body.data.symbols) === JSON.stringify(DEFAULT_WATCHLIST), "GET should return the defaults");
    check(JSON.stringify((await state()).watchlist) === JSON.stringify(DEFAULT_WATCHLIST), "state.watchlist should match");
  });

  await step("invalid symbol → 400 with details", async () => {
    const reply = await call<ErrorBody>("PUT", "/api/hermes/watchlist", { symbols: ["1BAD"] });
    expectStatus(reply, 400);
    check(JSON.stringify(reply.body.error.details) === JSON.stringify({ field: "symbols[0]" }), "details.field should be symbols[0]");
  });

  await step("malformed stocks banner → 400 with details", async () => {
    const bad = { ...stocksBody, rows: [{ ...stocksBody.rows[0], price: "abc" }] };
    const reply = await call<ErrorBody>("PUT", "/api/hermes/banner/stocks", bad);
    expectStatus(reply, 400);
    check(JSON.stringify(reply.body.error.details) === JSON.stringify({ field: "rows[0].price" }), "details.field should be rows[0].price");
    return reply.body.error.message;
  });

  await step("gmail payment with an amount → 400 with details", async () => {
    const gmail = { since: capturedAt, needsReply: [], packages: [], payments: [{ merchant: "Shop", at: capturedAt, amount: 12 }], deletedCount: 0, capturedAt };
    const reply = await call<ErrorBody>("PUT", "/api/hermes/banner/gmail", gmail);
    expectStatus(reply, 400);
    check(JSON.stringify(reply.body.error.details) === JSON.stringify({ field: "payments[0].amount" }), "details.field should be payments[0].amount");
    return reply.body.error.message;
  });

  await step("unknown card field → 400 with details", async () => {
    const reply = await call<ErrorBody>("PUT", cardPath, { ...cardBody, colour: "red" });
    expectStatus(reply, 400);
    check(JSON.stringify(reply.body.error.details) === JSON.stringify({ field: "colour" }), "details.field should be colour");
  });

  await step("bad token → 401", async () => {
    const reply = await call<ErrorBody>("GET", "/api/hermes/state", undefined, "not-the-token");
    expectStatus(reply, 401);
    check(reply.body.error.code === "UNAUTHORIZED", "code should be UNAUTHORIZED");
  });

  await step("archive card, archive again changes nothing", async () => {
    const first = await call<HermesWriteResult<WorkCardDto>>("POST", `${cardPath}/archive`);
    expectStatus(first, 200);
    check(first.body.data.status === "archived", "status should be archived");
    const again = await call<HermesWriteResult<WorkCardDto>>("POST", `${cardPath}/archive`);
    expectStatus(again, 200);
    check(again.body.data.version === first.body.data.version, "second archive should not bump the version");
    check(!(await state()).cards.some((c) => c.key === cardKey), "archived card still listed in state");
  });

  console.log(failures === 0 ? "\nAll smoke steps passed." : `\n${failures} smoke step(s) failed.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
