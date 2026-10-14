// End-to-end check of the browser routes (/api/sprints, /api/cards, /api/items, /api/daily-message,
// /api/today) against a running dev server.
// Usage: npm run dev   (in another terminal), then: npm run browser:smoke
// Base URL: NEXT_PUBLIC_APP_URL (read from .env; an exported value wins).
//
// Writes "Smoke …" rows into the server's database: run it against a dev DB. At the end the two
// smoke cards are archived (the page has no DELETE), the two smoke sprints are left closed, and
// whichever sprint was active before the run is made active again. The card reorder rewrites the
// positions of every card on the list, so existing cards keep their order but get new positions.
// The daily message is written for 2000-01-01, so today's message is never touched.
import "dotenv/config";
import type { ChecklistItemDto, HermesConflictDetails, HermesDailyMessage, SprintDto, TodayResponse, WorkCardDto } from "@/types/dashboard-contracts";
import { addDays, dashboardTimeZone, localDateString } from "@/lib/time/zone";

const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");

interface Reply<T> {
  status: number;
  body: T;
}

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

interface List<T> {
  data: T[];
}

async function call<T>(method: string, path: string, body?: unknown): Promise<Reply<T>> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
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

let failures = 0;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectStatus(reply: Reply<unknown>, status: number): void {
  check(reply.status === status, `expected HTTP ${status}, got ${reply.status}: ${JSON.stringify(reply.body).slice(0, 300)}`);
}

function expectField(reply: Reply<ErrorBody>, status: number, field: string): void {
  expectStatus(reply, status);
  check(JSON.stringify(reply.body.error.details) === JSON.stringify({ field }), `details.field should be ${field}, got ${JSON.stringify(reply.body.error.details)}`);
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

function need<T>(value: T | undefined, what: string): T {
  check(value !== undefined, `${what} is missing (an earlier step failed)`);
  return value;
}

async function main(): Promise<void> {
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL is not set");

  const run = Date.now().toString(36);
  const today = localDateString(new Date(), dashboardTimeZone());
  const messageDate = "2000-01-01";
  const messageText = `Smoke message ${run}`;
  console.log(`Browser smoke · ${base} · run ${run}\n`);

  let previousActive: SprintDto | null = null;
  let sprintA: SprintDto | undefined;
  let sprintB: SprintDto | undefined;
  const cards: WorkCardDto[] = [];
  const items: ChecklistItemDto[] = [];

  const cardsOfA = async () => {
    const reply = await call<List<WorkCardDto>>("GET", `/api/cards?sprintId=${need(sprintA, "sprint A").id}`);
    expectStatus(reply, 200);
    return reply.body.data;
  };
  const freshItem = async (id: string) => {
    const card = (await cardsOfA()).find((c) => c.items.some((i) => i.id === id));
    const found = card?.items.find((i) => i.id === id);
    check(found, `item ${id} not found`);
    return found;
  };

  await step("GET /api/sprints?status=active", async () => {
    const reply = await call<List<SprintDto>>("GET", "/api/sprints?status=active");
    expectStatus(reply, 200);
    check(reply.body.data.length <= 1, "more than one active sprint");
    previousActive = reply.body.data[0] ?? null;
    return previousActive ? `active before the run: ${previousActive.name}` : "no active sprint before the run";
  });

  await step("create sprint A (active)", async () => {
    const reply = await call<SprintDto>("POST", "/api/sprints", { name: `Smoke sprint A ${run}`, goal: "Prove the browser API", startsOn: today, endsOn: addDays(today, 6), status: "active" });
    expectStatus(reply, 201);
    sprintA = reply.body;
    check(sprintA.status === "active" && sprintA.daysLeft === 6 && sprintA.version === 1, "sprint A should be active, 6 days left, version 1");
    return `id ${sprintA.id}`;
  });

  for (const index of [0, 1]) {
    await step(`create card ${index + 1}`, async () => {
      const reply = await call<WorkCardDto>("POST", "/api/cards", { title: `Smoke card ${index + 1} ${run}`, sprintId: need(sprintA, "sprint A").id, milestoneTitle: "smoke" });
      expectStatus(reply, 201);
      cards[index] = reply.body;
      check(reply.body.createdBy === "user" && reply.body.sprintId === sprintA?.id, "createdBy should be user and sprintId sprint A");
      if (index === 1) check(cards[1].position === cards[0].position + 1000, "positions should step by 1000");
      return `position ${reply.body.position}`;
    });
  }

  for (const index of [0, 1, 2]) {
    await step(`create item ${index + 1} on card 1`, async () => {
      const reply = await call<ChecklistItemDto>("POST", `/api/cards/${need(cards[0], "card 1").id}/items`, { title: `Step ${index + 1}`, issueNumber: index + 1 });
      expectStatus(reply, 201);
      items[index] = reply.body;
      check(reply.body.createdBy === "user" && !reply.body.done && !reply.body.isCurrent, "new item should be open, not current, by user");
      if (index > 0) check(items[index].position === items[index - 1].position + 1000, "positions should step by 1000");
      return `position ${reply.body.position}`;
    });
  }

  await step("reorder cards (card 2 before card 1)", async () => {
    const [one, two] = [need(cards[0], "card 1"), need(cards[1], "card 2")];
    const reply = await call<List<WorkCardDto>>("POST", "/api/cards/reorder", { ids: [two.id, one.id] });
    expectStatus(reply, 200);
    const order = reply.body.data.map((c) => c.id);
    check(order[0] === two.id && order[1] === one.id, "card 2 should come first, then card 1");
    check(reply.body.data[0].position === 1000 && reply.body.data[1].position === 2000, "positions should be rewritten to 1000, 2000");
    cards[0] = reply.body.data[1];
    cards[1] = reply.body.data[0];
    return `${order.length} cards on the list`;
  });

  await step("reorder items (3, 1, 2)", async () => {
    const [i1, i2, i3] = items.map((item, index) => need(item, `item ${index + 1}`));
    const reply = await call<List<ChecklistItemDto>>("POST", `/api/cards/${need(cards[0], "card 1").id}/items/reorder`, { ids: [i3.id, i1.id, i2.id] });
    expectStatus(reply, 200);
    check(reply.body.data.map((i) => i.id).join() === [i3.id, i1.id, i2.id].join(), "order should be 3, 1, 2");
    check(reply.body.data.map((i) => i.position).join() === "1000,2000,3000", "positions should be 1000, 2000, 3000");
    for (const item of reply.body.data) items[items.findIndex((i) => i.id === item.id)] = item;
  });

  await step("toggle done on item 1 (sets doneAt), then back (clears it)", async () => {
    const i1 = need(items[0], "item 1");
    const on = await call<ChecklistItemDto>("PATCH", `/api/items/${i1.id}`, { version: i1.version, done: true });
    expectStatus(on, 200);
    check(on.body.done && on.body.doneAt !== null && on.body.version === i1.version + 1, "done should be true with doneAt and version +1");
    const card = (await cardsOfA()).find((c) => c.id === cards[0]?.id);
    check(card?.progress.done === 1 && card.progress.total === 3, "card progress should be 1 / 3");
    const off = await call<ChecklistItemDto>("PATCH", `/api/items/${i1.id}`, { version: on.body.version, done: false });
    expectStatus(off, 200);
    check(!off.body.done && off.body.doneAt === null, "done should be false and doneAt cleared");
    items[0] = off.body;
  });

  await step("set item 2 current, then item 3 current (item 2 cleared)", async () => {
    const [i2, i3] = [need(items[1], "item 2"), need(items[2], "item 3")];
    const first = await call<ChecklistItemDto>("PATCH", `/api/items/${i2.id}`, { version: i2.version, isCurrent: true });
    expectStatus(first, 200);
    check(first.body.isCurrent, "item 2 should be current");
    const second = await call<ChecklistItemDto>("PATCH", `/api/items/${i3.id}`, { version: i3.version, isCurrent: true });
    expectStatus(second, 200);
    items[2] = second.body;
    const card = (await cardsOfA()).find((c) => c.id === cards[0]?.id);
    check(card, "card 1 missing");
    check(card.items.filter((i) => i.isCurrent).map((i) => i.id).join() === i3.id, "exactly one current item (item 3) expected");
    const cleared = card.items.find((i) => i.id === i2.id);
    check(cleared && cleared.version === first.body.version + 1, "item 2 should be cleared with a version bump");
    check(card.current?.itemId === i3.id && card.current.label === "now", "card.current should be item 3 (now)");
    items[1] = cleared;
  });

  await step("PATCH card with a stale version → 409 CONFLICT", async () => {
    const one = need(cards[0], "card 1");
    const ok = await call<WorkCardDto>("PATCH", `/api/cards/${one.id}`, { version: one.version, title: `Smoke card 1 renamed ${run}` });
    expectStatus(ok, 200);
    check(ok.body.version === one.version + 1, "version should bump");
    cards[0] = ok.body;
    const stale = await call<ErrorBody>("PATCH", `/api/cards/${one.id}`, { version: one.version, title: "Lost update" });
    expectStatus(stale, 409);
    const details = stale.body.error.details as HermesConflictDetails<WorkCardDto>;
    check(stale.body.error.code === "CONFLICT", "code should be CONFLICT");
    check(details.currentVersion === ok.body.version && details.data.title === ok.body.title, "details should carry currentVersion and the current card");
    return `currentVersion ${details.currentVersion}`;
  });

  await step("PATCH item with a stale version → 409 CONFLICT", async () => {
    const i1 = need(items[0], "item 1");
    const stale = await call<ErrorBody>("PATCH", `/api/items/${i1.id}`, { version: i1.version - 1, done: true });
    expectStatus(stale, 409);
    const details = stale.body.error.details as HermesConflictDetails<ChecklistItemDto>;
    check(details.currentVersion === (await freshItem(i1.id)).version && details.data.id === i1.id, "details should carry the current item");
  });

  await step("unknown field → 400 with details.field", async () => {
    const one = need(cards[0], "card 1");
    expectField(await call<ErrorBody>("PATCH", `/api/cards/${one.id}`, { version: one.version, colour: "red" }), 400, "colour");
    expectField(await call<ErrorBody>("POST", "/api/cards", { title: "x", hermesSuggestion: "nope" }), 400, "hermesSuggestion");
  });

  await step("bad id → 400, unknown id → 404, missing version → 400", async () => {
    expectField(await call<ErrorBody>("PATCH", "/api/items/not-a-uuid", { version: 1, done: true }), 400, "id");
    const missing = await call<ErrorBody>("PATCH", "/api/items/00000000-0000-4000-8000-000000000000", { version: 1, done: true });
    expectStatus(missing, 404);
    expectField(await call<ErrorBody>("PATCH", `/api/items/${need(items[0], "item 1").id}`, { done: true }), 400, "version");
  });

  await step("create sprint B, activate it → sprint A closed", async () => {
    const created = await call<SprintDto>("POST", "/api/sprints", { name: `Smoke sprint B ${run}`, startsOn: today, endsOn: addDays(today, 13) });
    expectStatus(created, 201);
    check(created.body.status === "planned" && created.body.daysLeft === null, "sprint B should start planned");
    const activated = await call<SprintDto>("PATCH", `/api/sprints/${created.body.id}`, { version: created.body.version, status: "active" });
    expectStatus(activated, 200);
    sprintB = activated.body;
    check(sprintB.status === "active" && sprintB.daysLeft === 13, "sprint B should be active with 13 days left");
    const active = await call<List<SprintDto>>("GET", "/api/sprints?status=active");
    check(active.body.data.length === 1 && active.body.data[0].id === sprintB.id, "only sprint B should be active");
    const closed = await call<List<SprintDto>>("GET", "/api/sprints?status=closed");
    const a = closed.body.data.find((s) => s.id === sprintA?.id);
    check(a && a.version === (sprintA?.version ?? 0) + 1, "sprint A should be closed with a version bump");
  });

  await step("PUT /api/daily-message", async () => {
    const reply = await call<HermesDailyMessage>("PUT", "/api/daily-message", { date: messageDate, text: messageText });
    expectStatus(reply, 200);
    check(JSON.stringify(reply.body) === JSON.stringify({ date: messageDate, text: messageText, author: "user" }), `unexpected body ${JSON.stringify(reply.body)}`);
  });

  await step("GET /api/today returns the pieces", async () => {
    const reply = await call<TodayResponse>("GET", "/api/today");
    expectStatus(reply, 200);
    const body = reply.body;
    check(body.date === today && body.timeline.date === today, "date should default to today");
    check(body.workingOn.activeSprint?.id === sprintB?.id, "active sprint should be sprint B");
    const listed = body.workingOn.cards.map((c) => c.id);
    check(listed.indexOf(need(cards[1], "card 2").id) < listed.indexOf(need(cards[0], "card 1").id), "cards should follow the reorder");
    check(body.workingOn.cards.find((c) => c.id === cards[0]?.id)?.items.length === 3, "card 1 should carry its 3 items");
    check(Array.isArray(body.warnings.alerts) && typeof body.warnings.waiting.gmailNeedsReply === "number", "warnings missing");
    const seerr = body.warnings.waiting.seerrPending;
    check(seerr === null || typeof seerr === "number", "seerrPending should be a number or null");
    check(typeof body.sources.calendar.ok === "boolean" && typeof body.sources.seerr.ok === "boolean", "sources missing");
    check((seerr === null) === !body.sources.seerr.ok, "seerrPending null exactly when sources.seerr is not ok");
    return `${body.timeline.events.length} events · ${body.workingOn.cards.length} cards · ${body.warnings.alerts.length} alerts · seerr ${seerr ?? `unavailable (${body.sources.seerr.error})`} · calendar ${body.sources.calendar.ok ? "ok" : body.sources.calendar.error}`;
  });

  await step("GET /api/today?date= shows that day's daily message; bad date → 400", async () => {
    const reply = await call<TodayResponse>("GET", `/api/today?date=${messageDate}`);
    expectStatus(reply, 200);
    check(reply.body.banner.dailyMessage?.text === messageText && reply.body.banner.dailyMessage.author === "user", "daily message for 2000-01-01 missing");
    expectField(await call<ErrorBody>("GET", "/api/today?date=2026-02-30"), 400, "date");
  });

  // ---------- Clean up: archive the smoke cards, give the active sprint back ----------
  for (const index of [0, 1]) {
    await step(`archive card ${index + 1}`, async () => {
      const card = (await cardsOfA()).find((c) => c.id === cards[index]?.id) ?? need(cards[index], `card ${index + 1}`);
      const reply = await call<WorkCardDto>("PATCH", `/api/cards/${card.id}`, { version: card.version, status: "archived" });
      expectStatus(reply, 200);
      check(reply.body.status === "archived", "status should be archived");
      const visible = await call<List<WorkCardDto>>("GET", "/api/cards");
      check(!visible.body.data.some((c) => c.id === card.id), "archived card still listed");
    });
  }

  await step("restore the sprint that was active before the run", async () => {
    const before = previousActive as SprintDto | null;
    const b = need(sprintB, "sprint B");
    if (before) {
      const fresh = (await call<List<SprintDto>>("GET", "/api/sprints")).body.data.find((s) => s.id === before.id);
      check(fresh, "previous sprint not found");
      const reply = await call<SprintDto>("PATCH", `/api/sprints/${before.id}`, { version: fresh.version, status: "active" });
      expectStatus(reply, 200);
      const active = await call<List<SprintDto>>("GET", "/api/sprints?status=active");
      check(active.body.data.length === 1 && active.body.data[0].id === before.id, "the previous sprint should be the only active one");
      return `${before.name} active again, sprint B closed`;
    }
    const reply = await call<SprintDto>("PATCH", `/api/sprints/${b.id}`, { version: b.version, status: "closed" });
    expectStatus(reply, 200);
    return "sprint B closed";
  });

  console.log(failures === 0 ? "\nAll browser smoke steps passed." : `\n${failures} browser smoke step(s) failed.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
