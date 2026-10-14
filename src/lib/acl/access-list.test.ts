import assert from "node:assert/strict";
import test from "node:test";
import { describeAccessList, isAllowed, loadAccessList, parseCidrs, type AccessList } from "./access-list";

function listOf(value: string): AccessList {
  return loadAccessList({ DASHBOARD_ALLOWED_CIDRS: value } as unknown as NodeJS.ProcessEnv);
}

function texts(value: string): string[] {
  return parseCidrs(value).map((rule) => rule.text);
}

test("empty, blank or unset means allow everyone", () => {
  assert.deepEqual(parseCidrs(undefined), []);
  assert.deepEqual(parseCidrs(""), []);
  assert.deepEqual(parseCidrs(" , ,"), []);
  assert.equal(loadAccessList({} as NodeJS.ProcessEnv).allowAll, true);
  assert.equal(listOf("  ").allowAll, true);
  const all = listOf("");
  for (const peer of ["203.0.113.9", "2001:db8::1", undefined, "garbage"]) assert.equal(isAllowed(peer, all), true);
});

test("entries are trimmed, canonicalised and default to a single host", () => {
  assert.deepEqual(texts(" 192.168.1.0/24, 100.64.0.0/10,172.18.0.0/16 ,"), ["192.168.1.0/24", "100.64.0.0/10", "172.18.0.0/16"]);
  assert.deepEqual(texts("192.168.1.10,FD7A:115C:A1E0::/48,2001:db8::1"), ["192.168.1.10/32", "fd7a:115c:a1e0::/48", "2001:db8::1/128"]);
  assert.deepEqual(texts("0.0.0.0/0,::/0"), ["0.0.0.0/0", "::/0"]);
  assert.equal(listOf("10.0.0.0/8").allowAll, false);
});

test("a bad entry is a startup error that names it", () => {
  const cases: Array<[string, RegExp]> = [
    ["not-an-ip", /"not-an-ip" is not an IPv4\/IPv6 address or CIDR/],
    ["192.168.1.0/33", /"192\.168\.1\.0\/33" has an invalid prefix length \(IPv4 allows \/0 to \/32\)/],
    ["fd00::/129", /"fd00::\/129" has an invalid prefix length \(IPv6 allows \/0 to \/128\)/],
    ["10.0.0.0/", /"10\.0\.0\.0\/" has an invalid prefix length/],
    ["10.0.0.0/-1", /"10\.0\.0\.0\/-1" has an invalid prefix length/],
    ["10.0.0.0/8/9", /"10\.0\.0\.0\/8\/9" has an invalid prefix length/],
    ["10.0.0.0/ 8", /"10\.0\.0\.0\/ 8" has an invalid prefix length/],
    ["10.0.0.0 /8", /"10\.0\.0\.0 \/8" is not an IPv4\/IPv6 address or CIDR/],
    ["010.0.0.0/8", /"010\.0\.0\.0\/8" is not an IPv4\/IPv6 address/],
    ["fe80::1%eth0", /"fe80::1%eth0" is not an IPv4\/IPv6 address/],
    ["192.168.1.5/24", /"192\.168\.1\.5\/24" has host bits set; did you mean 192\.168\.1\.0\/24\?/],
    ["192.168.1.0/2", /"192\.168\.1\.0\/2" has host bits set; did you mean 192\.0\.0\.0\/2\?/],
    ["fd7a:115c:a1e0::1/48", /has host bits set; did you mean fd7a:115c:a1e0::\/48\?/],
    ["::ffff:10.0.0.0/104", /"::ffff:10\.0\.0\.0\/104" is an IPv4-mapped IPv6 address; write it as plain IPv4/],
  ];
  for (const [entry, message] of cases) {
    assert.throws(() => parseCidrs(`192.168.1.0/24, ${entry}, 10.0.0.0/8`), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^DASHBOARD_ALLOWED_CIDRS: /);
      assert.match(error.message, message);
      return true;
    }, entry);
  }
});

test("loopback is always allowed, even when the list does not mention it", () => {
  const list = listOf("10.99.0.0/16");
  for (const peer of ["127.0.0.1", "127.255.3.9", "::1", "::ffff:127.0.0.1", "0:0:0:0:0:0:0:1"]) {
    assert.equal(isAllowed(peer, list), true, peer);
  }
});

test("IPv4 CIDR boundaries, including IPv4-mapped peers from a dual-stack socket", () => {
  const list = listOf("192.168.1.0/24,100.64.0.0/10,172.18.0.0/16");
  const allowed = ["192.168.1.0", "192.168.1.255", "::ffff:192.168.1.77", "100.64.0.0", "100.127.255.255", "172.18.0.5", "::ffff:ac12:5"];
  const denied = ["192.168.0.255", "192.168.2.0", "::ffff:192.168.2.1", "100.63.255.255", "100.128.0.0", "172.17.0.2", "172.19.0.1", "10.0.0.1", "0.0.0.0"];
  for (const peer of allowed) assert.equal(isAllowed(peer, list), true, peer);
  for (const peer of denied) assert.equal(isAllowed(peer, list), false, peer);
});

test("single hosts match only themselves", () => {
  const list = listOf("192.168.1.10,2001:db8::10");
  assert.equal(isAllowed("192.168.1.10", list), true);
  assert.equal(isAllowed("::ffff:192.168.1.10", list), true);
  assert.equal(isAllowed("192.168.1.11", list), false);
  assert.equal(isAllowed("2001:db8::10", list), true);
  assert.equal(isAllowed("2001:db8::11", list), false);
});

test("IPv6 CIDRs, including prefixes that are not byte aligned", () => {
  const list = listOf("fd7a:115c:a1e0::/48,2001:db8::/33");
  assert.equal(isAllowed("fd7a:115c:a1e0:ab12::1", list), true);
  assert.equal(isAllowed("fd7a:115c:a1e1::1", list), false);
  assert.equal(isAllowed("2001:db8:7fff:ffff::1", list), true);
  assert.equal(isAllowed("2001:db8:8000::", list), false);
  assert.equal(isAllowed("fe80::1%eth0", list), false);
});

test("families never cross: an IPv4 rule does not match IPv6 bytes and /0 stays in its family", () => {
  assert.equal(isAllowed("a00::1", listOf("10.0.0.0/8")), false);
  const v4All = listOf("0.0.0.0/0");
  assert.equal(isAllowed("203.0.113.9", v4All), true);
  assert.equal(isAllowed("::ffff:203.0.113.9", v4All), true);
  assert.equal(isAllowed("2001:db8::1", v4All), false);
  const v6All = listOf("::/0");
  assert.equal(isAllowed("2001:db8::1", v6All), true);
  assert.equal(isAllowed("203.0.113.9", v6All), false);
});

test("a missing or unparseable peer address is refused when a list is set", () => {
  const list = listOf("10.0.0.0/8");
  for (const peer of [undefined, null, "", "unknown", "10.0.0.1, 127.0.0.1"]) assert.equal(isAllowed(peer, list), false, String(peer));
});

test("startup line: loud warning in production, quiet in development, ranges when set", () => {
  const all = listOf("");
  assert.deepEqual(describeAccessList(all, "production"), {
    level: "warn",
    message: "[acl] DASHBOARD_ALLOWED_CIDRS is not set; every client is allowed",
  });
  assert.equal(describeAccessList(all, undefined).level, "warn");
  assert.equal(describeAccessList(all, "development").level, "info");
  assert.deepEqual(describeAccessList(listOf("192.168.1.0/24, fd00::/8"), "production"), {
    level: "info",
    message: "[acl] allowing loopback and 192.168.1.0/24, fd00::/8",
  });
});
