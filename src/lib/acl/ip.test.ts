import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIp, parseIp } from "./ip";

test("IPv4 addresses come back unchanged", () => {
  assert.equal(normalizeIp("192.168.1.5"), "192.168.1.5");
  assert.equal(normalizeIp("0.0.0.0"), "0.0.0.0");
  assert.equal(normalizeIp("255.255.255.255"), "255.255.255.255");
});

test("IPv4-mapped IPv6 peers are normalised to IPv4", () => {
  assert.equal(normalizeIp("::ffff:192.168.1.5"), "192.168.1.5");
  assert.equal(normalizeIp("::FFFF:127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeIp("::ffff:7f00:1"), "127.0.0.1");
  assert.equal(normalizeIp("0:0:0:0:0:ffff:c0a8:105"), "192.168.1.5");
  assert.deepEqual(parseIp("::ffff:10.0.0.1"), { family: 4, bytes: [10, 0, 0, 1] });
});

test("IPv4-compatible (::a.b.c.d) and NAT64 addresses stay IPv6", () => {
  assert.equal(normalizeIp("::1.2.3.4"), "::102:304");
  assert.equal(normalizeIp("64:ff9b::1.2.3.4"), "64:ff9b::102:304");
});

test("IPv6 is canonicalised (RFC 5952) and zone ids are dropped", () => {
  assert.equal(normalizeIp("::1"), "::1");
  assert.equal(normalizeIp("0:0:0:0:0:0:0:1"), "::1");
  assert.equal(normalizeIp("::"), "::");
  assert.equal(normalizeIp("2001:DB8:0:0:0:0:0:1"), "2001:db8::1");
  assert.equal(normalizeIp("2001:db8:0:0:1:0:0:1"), "2001:db8::1:0:0:1");
  assert.equal(normalizeIp("2001:db8:0:1:1:1:1:1"), "2001:db8:0:1:1:1:1:1");
  assert.equal(normalizeIp("1:2:3:4:5:6:7::"), "1:2:3:4:5:6:7:0");
  assert.equal(normalizeIp("fd7a:115c:a1e0::abcd"), "fd7a:115c:a1e0::abcd");
  assert.equal(normalizeIp("FE80::1%eth0"), "fe80::1");
  assert.deepEqual(parseIp("::1")?.bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
});

test("anything that is not an address is null", () => {
  for (const value of [undefined, null, "", "localhost", "1.2.3", "256.0.0.1", "010.0.0.1", "1.2.3.4 ", "1::2::3", "[::1]", "::g", "192.168.1.0/24"]) {
    assert.equal(normalizeIp(value), null, String(value));
  }
});

test("the strict config parser refuses zone ids", () => {
  assert.equal(parseIp("fe80::1%eth0"), null);
});
