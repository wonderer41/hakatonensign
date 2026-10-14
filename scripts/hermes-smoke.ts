// End-to-end check of the Hermes write API (/api/hermes/*) against a running dev server.
// Usage: npm run dev   (in another terminal), then: npm run hermes:smoke
// Base URL: NEXT_PUBLIC_APP_URL. Token: HERMES_DASHBOARD_TOKEN. Both read from .env.
//
// Writes test rows with "smoke-" keys into the server's database: run it against a dev DB.
// Each run uses fresh keys; the card is archived at the end, the alert resolved, the sprint
// stays "planned" (never active, so a real active sprint is never closed), and the stocks
// snapshot is dated 2000-01-01 so it never becomes the newest one on the page.
// The script sends ~32 requests; the API allows 60 per minute.
import "dotenv/config";
import type {
  AlertDto,
  ChecklistItemDto,
  HermesBannerResult,
  HermesConflictDetails,
  HermesStateResponse,
  HermesWriteResult,
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

async function call<T>(method: string, path: string, body?: unknown, bearer = token): Promise<Reply<T>> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
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
