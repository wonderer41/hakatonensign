import assert from "node:assert/strict";
import test from "node:test";
import { formatSseEvent, SSE_HEADERS, SSE_OPEN_COMMENT } from "./sse";

test("SSE messages use the exact framing the client expects", () => {
  assert.equal(formatSseEvent("change", { type: "card.upserted", cardId: "c1" }), 'event: change\ndata: {"type":"card.upserted","cardId":"c1"}\n\n');
  assert.equal(formatSseEvent("ping", {}), "event: ping\ndata: {}\n\n");
});

test("data stays on one line even when values contain newlines", () => {
  const message = formatSseEvent("change", { type: "x", note: "a\nb" });
  assert.equal(message.split("\n").length, 4);
});

test("the opening line is an SSE comment and headers disable caching and buffering", () => {
  assert.ok(SSE_OPEN_COMMENT.startsWith(":"));
  assert.ok(SSE_OPEN_COMMENT.endsWith("\n\n"));
  assert.equal(SSE_HEADERS["Content-Type"], "text/event-stream");
  assert.equal(SSE_HEADERS["Cache-Control"], "no-cache, no-transform");
  assert.equal(SSE_HEADERS.Connection, "keep-alive");
});
