import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { HttpError } from "@/lib/api/http";
import { approveSeerrRequest, declineSeerrRequest } from "./decisions";
import { checkSeerrPending, fetchPendingRequests } from "./pending";
import { animeTvDetails, movieDetails, movieRequest, pendingPage, testEnv, tvRequest } from "./test-fixtures";

// A fake Seerr behind global fetch: routes are "METHOD /path?query" → status + JSON body (or a thrown error).
type Reply = { status: number; body?: unknown } | Error;
interface Call {
  method: string;
  path: string;
  apiKey: string | null;
  body: unknown;
}

const realFetch = globalThis.fetch;
let routes: Map<string, Reply>;
let calls: Call[];

beforeEach(() => {
  routes = new Map();
  calls = [];
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = `${url.pathname}${url.search}`;
    const headers = new Headers(init?.headers);
    calls.push({ method, path, apiKey: headers.get("X-Api-Key"), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const reply = routes.get(`${method} ${path}`);
    if (!reply) return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const env = testEnv();
const hasCode = (code: string) => (error: unknown) => error instanceof HttpError && error.code === code;

test("approve (movie, Temp): moves the request to the Temp library, then approves it", async () => {
  routes.set("GET /api/v1/request/42", { status: 200, body: movieRequest });
  routes.set("GET /api/v1/movie/603", { status: 200, body: movieDetails });
  routes.set("PUT /api/v1/request/42", { status: 200, body: movieRequest });
  routes.set("POST /api/v1/request/42/approve", { status: 200, body: { ...movieRequest, status: 2 } });

  const target = await approveSeerrRequest(42, "temp", env);
  assert.equal(target.kind, "temp");
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.path}`),
    ["GET /api/v1/request/42", "GET /api/v1/movie/603", "PUT /api/v1/request/42", "POST /api/v1/request/42/approve"],
  );
  assert.ok(calls.every((call) => call.apiKey === "test-api-key"));
  assert.deepEqual(calls[2].body, { mediaType: "movie", serverId: 0, rootFolder: "/media/movies-temp", profileId: 4 });
});

test("approve (anime show, Permanent): lands in the anime library with its seasons", async () => {
  routes.set("GET /api/v1/request/43", { status: 200, body: tvRequest });
  routes.set("GET /api/v1/tv/1429", { status: 200, body: animeTvDetails });
  routes.set("PUT /api/v1/request/43", { status: 200, body: tvRequest });
  routes.set("POST /api/v1/request/43/approve", { status: 200, body: tvRequest });

  const target = await approveSeerrRequest(43, "permanent", env);
  assert.equal(target.kind, "anime");
  assert.deepEqual(calls[2].body, { mediaType: "tv", serverId: 1, rootFolder: "/media/anime-tv", profileId: 2, seasons: [1, 2] });
});

test("approve refuses a request that is no longer pending, without touching it", async () => {
  routes.set("GET /api/v1/request/42", { status: 200, body: { ...movieRequest, status: 2 } });
  await assert.rejects(approveSeerrRequest(42, "temp", env), hasCode("CONFLICT"));
  assert.equal(calls.length, 1);
});

test("approve refuses when Seerr sends no keywords (anime unknown)", async () => {
  routes.set("GET /api/v1/request/42", { status: 200, body: movieRequest });
  routes.set("GET /api/v1/movie/603", { status: 200, body: { ...movieDetails, keywords: undefined } });
  await assert.rejects(approveSeerrRequest(42, "temp", env), hasCode("UPSTREAM_ERROR"));
  assert.ok(!calls.some((call) => call.method !== "GET"));
});

test("Seerr's 409 maps to CONFLICT, 202 on edit to CONFLICT, 404 to NOT_FOUND", async () => {
  routes.set("GET /api/v1/request/42", { status: 200, body: movieRequest });
  routes.set("GET /api/v1/movie/603", { status: 200, body: movieDetails });
  routes.set("PUT /api/v1/request/42", { status: 200, body: movieRequest });
  routes.set("POST /api/v1/request/42/approve", { status: 409, body: { message: "Only pending requests can be approved or declined." } });
  await assert.rejects(approveSeerrRequest(42, "temp", env), hasCode("CONFLICT"));

  routes.set("PUT /api/v1/request/42", { status: 202, body: { message: "No seasons available to request" } });
  await assert.rejects(approveSeerrRequest(42, "temp", env), hasCode("CONFLICT"));

  await assert.rejects(approveSeerrRequest(7, "temp", env), hasCode("NOT_FOUND"));
});

test("network errors, timeouts, 5xx and a rejected key map to SEERR_UNAVAILABLE", async () => {
  routes.set("POST /api/v1/request/42/decline", new TypeError("fetch failed"));
  await assert.rejects(declineSeerrRequest(42, env), hasCode("SEERR_UNAVAILABLE"));

  routes.set("POST /api/v1/request/42/decline", new DOMException("The operation timed out.", "TimeoutError"));
  await assert.rejects(declineSeerrRequest(42, env), (error: unknown) => hasCode("SEERR_UNAVAILABLE")(error) && /10 s/.test((error as Error).message));

  routes.set("POST /api/v1/request/42/decline", { status: 503 });
  await assert.rejects(declineSeerrRequest(42, env), hasCode("SEERR_UNAVAILABLE"));

  routes.set("POST /api/v1/request/42/decline", { status: 403, body: { message: "You do not have permission" } });
  await assert.rejects(declineSeerrRequest(42, env), hasCode("SEERR_UNAVAILABLE"));
});

test("decline posts the decision", async () => {
  routes.set("POST /api/v1/request/42/decline", { status: 200, body: { ...movieRequest, status: 3 } });
  await declineSeerrRequest(42, env);
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), ["POST /api/v1/request/42/decline"]);
});

test("pending list: one details call per title; a failed lookup still lists the request", async () => {
  routes.set("GET /api/v1/request?filter=pending&take=20&skip=0", { status: 200, body: pendingPage });
  routes.set("GET /api/v1/tv/1429", { status: 200, body: animeTvDetails });
  routes.set("GET /api/v1/movie/603", { status: 500 });

  const warn = console.warn;
  console.warn = () => {};
  try {
    const dtos = await fetchPendingRequests(env);
    assert.deepEqual(dtos.map((dto) => [dto.id, dto.title, dto.year]), [
      [43, "Attack on Titan", 2013],
      [42, "TMDB #603", null],
    ]);
  } finally {
    console.warn = warn;
  }
});

test("pending poll reports the count and whether it changed", async () => {
  routes.set("GET /api/v1/request?filter=pending&take=1&skip=0", { status: 200, body: { ...pendingPage, results: [tvRequest] } });
  assert.deepEqual(await checkSeerrPending(null, env), { count: 2, changed: true });
  assert.deepEqual(await checkSeerrPending(2, env), { count: 2, changed: false });
  assert.deepEqual(await checkSeerrPending(3, env), { count: 2, changed: true });
});
