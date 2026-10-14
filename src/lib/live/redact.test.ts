import assert from "node:assert/strict";
import test from "node:test";
import { redactSecrets, safeErrorMessage } from "./redact";

const ENV = {
  DATABASE_URL: "postgresql://continuum:hunter2pass@db:5432/continuum",
  GOOGLE_REFRESH_TOKEN: "1//refresh-token-value",
  SEERR_API_KEY: "seerr-key-123456",
  DASHBOARD_TIME_ZONE: "America/Denver",
  SHORT_KEY: "abc",
};

test("URL passwords, bearer tokens and secret env values are removed", () => {
  assert.equal(redactSecrets("connect postgres://user:p%40ss@host:5432/db failed", {}), "connect postgres://user:***@host:5432/db failed");
  assert.equal(redactSecrets("Authorization: Bearer abc.def-ghi", {}), "Authorization: Bearer ***");
  assert.equal(redactSecrets("token 1//refresh-token-value rejected", ENV), "token *** rejected");
  assert.equal(redactSecrets("url postgresql://continuum:hunter2pass@db:5432/continuum", ENV), "url ***");
  assert.equal(redactSecrets("key seerr-key-123456", ENV), "key ***");
});

test("non-secret env values and short values are left alone", () => {
  assert.equal(redactSecrets("zone America/Denver", ENV), "zone America/Denver");
  assert.equal(redactSecrets("abc", ENV), "abc");
});

test("error messages become one capped line", () => {
  assert.equal(safeErrorMessage(new Error("first\n  second\tthird"), {}), "first second third");
  assert.equal(safeErrorMessage("plain", {}), "plain");
  assert.equal(safeErrorMessage({ weird: true }, {}), "Unknown error");
  assert.equal(safeErrorMessage(new Error(""), {}), "Unknown error");
  assert.equal(safeErrorMessage(new Error("x".repeat(1000)), {}).length, 300);
});
