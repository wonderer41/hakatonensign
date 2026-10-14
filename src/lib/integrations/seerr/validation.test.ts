import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "@/lib/api/http";
import { parseEmptyBody, parseSeerrDecision, parseSeerrRequestId } from "./validation";

function rejects(fn: () => unknown, field: string | undefined): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.code, "VALIDATION_ERROR");
    assert.deepEqual(error.details, field === undefined ? undefined : { field });
    return true;
  });
}

test("request ids are positive integers", () => {
  assert.equal(parseSeerrRequestId("1"), 1);
  assert.equal(parseSeerrRequestId("2147483647"), 2147483647);
  for (const bad of ["0", "-1", "1.5", "abc", "012", "1e3", "", " 1", "2147483648", "99999999999"]) {
    rejects(() => parseSeerrRequestId(bad), "id");
  }
});

test("approve body is exactly { library }", () => {
  assert.deepEqual(parseSeerrDecision({ library: "temp" }), { library: "temp" });
  assert.deepEqual(parseSeerrDecision({ library: "permanent" }), { library: "permanent" });
  rejects(() => parseSeerrDecision({}), "library");
  rejects(() => parseSeerrDecision({ library: "Temp" }), "library");
  rejects(() => parseSeerrDecision({ library: null }), "library");
  rejects(() => parseSeerrDecision({ library: "temp", is4k: true }), "is4k");
  rejects(() => parseSeerrDecision(null), undefined);
  rejects(() => parseSeerrDecision(["temp"]), undefined);
});

test("decline takes no body", () => {
  parseEmptyBody("");
  parseEmptyBody("  ");
  parseEmptyBody("{}");
  rejects(() => parseEmptyBody('{"reason":"no"}'), "reason");
  rejects(() => parseEmptyBody("[]"), undefined);
  rejects(() => parseEmptyBody("not json"), undefined);
});
