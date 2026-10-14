import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "./http";
import {
  ROOT,
  arrayOf,
  enumValue,
  fieldPath,
  finiteNumber,
  httpUrl,
  integer,
  isoDateTime,
  jsonObject,
  localDate,
  optionalString,
  requiredString,
  strictObject,
} from "./validate";

function rejects(run: () => unknown, field: string): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.code, "VALIDATION_ERROR");
    assert.deepEqual(error.details, { field });
    return true;
  });
}

test("strictObject rejects unknown fields by name and non-objects", () => {
  assert.deepEqual(strictObject({ a: 1 }, ROOT, ["a", "b"]), { a: 1 });
  rejects(() => strictObject({ a: 1, extra: 2 }, ROOT, ["a"]), "extra");
  rejects(() => strictObject({ amount: 2 }, "payments[0]", ["merchant"]), "payments[0].amount");
  rejects(() => strictObject([], ROOT, []), "body");
  rejects(() => strictObject(null, "counts", []), "counts");
  rejects(() => strictObject(JSON.parse('{"__proto__": {"x": 1}}'), ROOT, []), "__proto__");
});

test("field paths read like the payload", () => {
  assert.equal(fieldPath(ROOT, "rows"), "rows");
  assert.equal(fieldPath(fieldPath("rows", 3), "price"), "rows[3].price");
});

test("strings are trimmed and capped at the column size", () => {
  assert.equal(requiredString("  hi  ", "title", 5), "hi");
  rejects(() => requiredString("   ", "title", 5), "title");
  rejects(() => requiredString("toolong", "title", 5), "title");
  rejects(() => requiredString(42, "title", 5), "title");
  assert.equal(optionalString(undefined, "goal", 5), undefined);
  assert.equal(optionalString(null, "goal", 5), null);
  assert.equal(optionalString("  ", "goal", 5), null);
  rejects(() => optionalString(1, "goal", 5), "goal");
});

test("date-times need an explicit zone; dates must be real", () => {
  assert.equal(isoDateTime("2026-10-14T07:00:00-06:00", "at"), "2026-10-14T13:00:00.000Z");
  assert.equal(isoDateTime("2026-10-14T13:00Z", "at"), "2026-10-14T13:00:00.000Z");
  rejects(() => isoDateTime("2026-10-14T13:00:00", "at"), "at");
  rejects(() => isoDateTime("2026-10-14", "at"), "at");
  rejects(() => isoDateTime("2026-13-40T00:00:00Z", "at"), "at");
  assert.equal(localDate("2026-10-14", "date"), "2026-10-14");
  rejects(() => localDate("2026-02-30", "date"), "date");
});

test("numbers, enums, arrays and urls", () => {
  assert.equal(integer(5, "n", { min: 1, max: 9 }), 5);
  rejects(() => integer(1.5, "n"), "n");
  rejects(() => integer("5", "n"), "n");
  rejects(() => integer(0, "n", { min: 1 }), "n");
  assert.equal(finiteNumber(-2.5, "x"), -2.5);
  rejects(() => finiteNumber(Number.NaN, "x"), "x");
  rejects(() => finiteNumber("1", "x"), "x");
  assert.equal(enumValue("b", "kind", ["a", "b"] as const), "b");
  rejects(() => enumValue("c", "kind", ["a", "b"] as const), "kind");
  assert.deepEqual(arrayOf([1, 2], "list", 3, (v, f) => integer(v, f)), [1, 2]);
  rejects(() => arrayOf([1, "x"], "list", 3, (v, f) => integer(v, f)), "list[1]");
  rejects(() => arrayOf([1, 2, 3, 4], "list", 3, (v, f) => integer(v, f)), "list");
  assert.equal(httpUrl("https://github.com/x", "url"), "https://github.com/x");
  rejects(() => httpUrl("javascript:alert(1)", "url"), "url");
  rejects(() => jsonObject({ big: "x".repeat(100) }, "meta", 50), "meta");
});
