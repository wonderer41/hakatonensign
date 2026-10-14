import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ApiRequestError, fetchJson, isAbortError, isApiRequestError, toApiRequestError } from "./api";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answer(status: number, body: string): void {
  globalThis.fetch = async () => new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

test("the server's error envelope becomes an ApiRequestError", () => {
  const error = toApiRequestError(409, { error: { code: "CONFLICT", message: "stale version", details: { currentVersion: 4 } } });
  assert.equal(error.status, 409);
  assert.equal(error.code, "CONFLICT");
  assert.equal(error.message, "stale version");
  assert.deepEqual(error.details, { currentVersion: 4 });
  assert.equal(isApiRequestError(error, "CONFLICT"), true);
  assert.equal(isApiRequestError(error, "NOT_FOUND"), false);

  const bare = toApiRequestError(502, undefined);
  assert.equal(bare.code, "HTTP_ERROR");
  assert.equal(bare.message, "The server answered 502");
});

test("fetchJson parses JSON and sends `json` as a JSON body", async () => {
  let sent: RequestInit | undefined;
  globalThis.fetch = async (_url, init) => {
    sent = init;
    return new Response('{"ok":true}', { status: 200 });
  };
  const result = await fetchJson<{ ok: boolean }>("/api/x", { method: "PATCH", json: { done: true } });
  assert.deepEqual(result, { ok: true });
  assert.equal(sent?.body, '{"done":true}');
  assert.equal(new Headers(sent?.headers).get("Content-Type"), "application/json");
  assert.equal(sent?.cache, "no-store");
});

test("fetchJson throws the envelope on 4xx and an empty body is undefined", async () => {
  answer(400, '{"error":{"code":"VALIDATION_ERROR","message":"durationMin must be 1–720","details":{"field":"durationMin"}}}');
  await assert.rejects(fetchJson("/api/schedule"), (error: unknown) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.code, "VALIDATION_ERROR");
    assert.deepEqual(error.details, { field: "durationMin" });
    return true;
  });

  globalThis.fetch = async () => new Response(null, { status: 204 });
  assert.equal(await fetchJson("/api/empty"), undefined);

  answer(200, "<html>");
  await assert.rejects(fetchJson("/api/html"), (error: unknown) => isApiRequestError(error, "INVALID_RESPONSE"));
});

test("fetchJson: network failure vs abort", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(fetchJson("/api/x"), (error: unknown) => isApiRequestError(error, "NETWORK_ERROR") && (error as ApiRequestError).status === 0);

  globalThis.fetch = async () => {
    throw new DOMException("The operation was aborted.", "AbortError");
  };
  await assert.rejects(fetchJson("/api/x"), (error: unknown) => isAbortError(error) && !(error instanceof ApiRequestError));
});
