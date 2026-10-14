import assert from "node:assert/strict";
import test from "node:test";
import { loadAccessList } from "./access-list";
import { createDenialLog } from "./denial-log";
import { createAclGate, FORBIDDEN_MESSAGE, forbiddenResponse } from "./gate";

function gateFor(value: string) {
  const lines: string[] = [];
  const list = loadAccessList({ DASHBOARD_ALLOWED_CIDRS: value } as unknown as NodeJS.ProcessEnv);
  const gate = createAclGate(list, createDenialLog({ write: (line) => lines.push(line) }));
  return { gate, lines };
}

test("allowed peers pass without a log line", () => {
  const { gate, lines } = gateFor("192.168.1.0/24");
  assert.equal(gate("::ffff:192.168.1.20"), true);
  assert.equal(gate("127.0.0.1"), true);
  assert.deepEqual(lines, []);
});

test("refused peers are logged once per window by their normalised address", () => {
  const { gate, lines } = gateFor("192.168.1.0/24");
  assert.equal(gate("::ffff:172.17.0.2"), false);
  assert.equal(gate("172.17.0.2"), false);
  assert.deepEqual(lines, ["[acl] denied 172.17.0.2 (1 request)"]);
});

test("a peer without a usable address is refused and logged as unknown", () => {
  const { gate, lines } = gateFor("192.168.1.0/24");
  assert.equal(gate(undefined), false);
  assert.deepEqual(lines, ["[acl] denied unknown (1 request)"]);
});

test("the refusal is a 403 in the project's error envelope", async () => {
  const response = forbiddenResponse();
  assert.equal(response.status, 403);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(await response.json(), { error: { code: "FORBIDDEN", message: FORBIDDEN_MESSAGE } });
});
