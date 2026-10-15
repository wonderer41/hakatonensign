import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { HttpError } from "@/lib/api/http";
import { fetchGoogleCalendarWindow } from "./client";
import type { GoogleCalendarConfig } from "./config";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const FROM = new Date("2026-10-14T06:00:00Z");
const TO = new Date("2026-10-30T06:00:00Z");

// The token cache is keyed by client + refresh token, so each test uses its own refresh token.
function config(refreshToken: string): GoogleCalendarConfig {
  return { clientId: "client", clientSecret: "secret", refreshToken, calendarId: "primary" };
}

/** Fakes Google: counts token refreshes and answers the events call with `calendarStatus(token)`. */
function fakeGoogle(options: { expiresIn?: number; calendarStatus?: (token: string) => number } = {}) {
  const calls = { tokens: 0, calendarTokens: [] as string[] };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      calls.tokens += 1;
      return Response.json({ access_token: `token-${calls.tokens}`, expires_in: options.expiresIn ?? 3599 });
    }
    const token = new Headers(init?.headers).get("Authorization")?.replace("Bearer ", "") ?? "";
    calls.calendarTokens.push(token);
    const status = options.calendarStatus?.(token) ?? 200;
    return status === 200 ? Response.json({ items: [] }) : new Response("{}", { status });
  };
  return calls;
}

test("reuses the access token across syncs instead of refreshing every time", async () => {
  const calls = fakeGoogle();
  await fetchGoogleCalendarWindow(config("reuse"), FROM, TO);
  await fetchGoogleCalendarWindow(config("reuse"), FROM, TO);
  assert.equal(calls.tokens, 1);
  assert.deepEqual(calls.calendarTokens, ["token-1", "token-1"]);
});

test("refreshes when the token is about to expire", async () => {
  const calls = fakeGoogle({ expiresIn: 30 });
  await fetchGoogleCalendarWindow(config("short-lived"), FROM, TO);
  await fetchGoogleCalendarWindow(config("short-lived"), FROM, TO);
  assert.equal(calls.tokens, 2);
});

test("a different refresh token never gets another one's access token", async () => {
  const calls = fakeGoogle();
  await fetchGoogleCalendarWindow(config("first-account"), FROM, TO);
  await fetchGoogleCalendarWindow(config("second-account"), FROM, TO);
  assert.equal(calls.tokens, 2);
});

test("a rejected token is dropped and the request retried once with a fresh one", async () => {
  const calls = fakeGoogle({ calendarStatus: (token) => (token === "token-1" ? 401 : 200) });
  await fetchGoogleCalendarWindow(config("revoked"), FROM, TO);
  await fetchGoogleCalendarWindow(config("revoked"), FROM, TO);
  assert.equal(calls.tokens, 2);
  assert.deepEqual(calls.calendarTokens, ["token-1", "token-2", "token-2"]);
});

test("a token rejected twice in a row is an UNAUTHORIZED error", async () => {
  const calls = fakeGoogle({ calendarStatus: () => 401 });
  await assert.rejects(
    fetchGoogleCalendarWindow(config("always-401"), FROM, TO),
    (error: unknown) => error instanceof HttpError && error.code === "UNAUTHORIZED",
  );
  assert.equal(calls.tokens, 2);
});
