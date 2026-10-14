import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "@/lib/api/http";
import { assertHermesToken, createRateLimiter } from "./auth";

const env = { HERMES_DASHBOARD_TOKEN: "s3cret-token" } as unknown as NodeJS.ProcessEnv;

function code(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    assert.ok(error instanceof HttpError);
    return error.code;
  }
}

test("the bearer token must match exactly", () => {
  assert.equal(code(() => assertHermesToken("Bearer s3cret-token", env)), null);
  assert.equal(code(() => assertHermesToken("bearer s3cret-token", env)), null);
  assert.equal(code(() => assertHermesToken("Bearer s3cret-tokeN", env)), "UNAUTHORIZED");
  assert.equal(code(() => assertHermesToken("Bearer s3cret", env)), "UNAUTHORIZED");
  assert.equal(code(() => assertHermesToken("s3cret-token", env)), "UNAUTHORIZED");
  assert.equal(code(() => assertHermesToken(null, env)), "UNAUTHORIZED");
});

test("an unset token refuses every request instead of allowing it", () => {
  const original = console.error;
  console.error = () => {};
  try {
    const empty = {} as NodeJS.ProcessEnv;
    assert.equal(code(() => assertHermesToken("Bearer ", empty)), "INTERNAL_ERROR");
    assert.equal(code(() => assertHermesToken("Bearer anything", { HERMES_DASHBOARD_TOKEN: "  " } as unknown as NodeJS.ProcessEnv)), "INTERNAL_ERROR");
  } finally {
    console.error = original;
  }
});

test("the rate limiter allows `limit` requests per sliding window", () => {
  const limiter = createRateLimiter(3, 60_000);
  assert.equal(limiter.take(0), 0);
  assert.equal(limiter.take(10_000), 0);
  assert.equal(limiter.take(20_000), 0);
  assert.equal(limiter.take(30_000), 30); // oldest hit leaves the window at 60s
  assert.equal(limiter.take(60_000), 0);
  assert.equal(limiter.take(60_500), 10);
});
