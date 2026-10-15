import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkHost, checkStateChange, hostName, isIpLiteral, parseAllowedHosts } from "./request-origin";

function facts(overrides: Partial<Parameters<typeof checkStateChange>[0]>) {
  return { method: "POST", pathname: "/api/cards", host: "daily.example.com", origin: null, secFetchSite: null, ...overrides };
}

describe("parseAllowedHosts", () => {
  it("lowercases, trims, dedupes and ignores blanks", () => {
    assert.deepEqual(parseAllowedHosts(" Daily.Example.com, ubuntu-main ,,daily.example.com"), ["daily.example.com", "ubuntu-main"]);
    assert.deepEqual(parseAllowedHosts(undefined), []);
  });
  it("rejects entries that are not host names", () => {
    assert.throws(() => parseAllowedHosts("daily.example.com:4849"), /not a host name/);
    assert.throws(() => parseAllowedHosts("http://daily.example.com"), /not a host name/);
  });
});

describe("hostName / isIpLiteral", () => {
  it("strips ports and brackets", () => {
    assert.equal(hostName("Daily.Example.com:4849"), "daily.example.com");
    assert.equal(hostName("[::1]:3000"), "::1");
    assert.equal(hostName("127.0.0.1"), "127.0.0.1");
    assert.equal(hostName(""), null);
    assert.equal(hostName(null), null);
  });
  it("recognises IP literals", () => {
    assert.equal(isIpLiteral("192.168.1.18"), true);
    assert.equal(isIpLiteral("::ffff:192.168.1.18"), true);
    assert.equal(isIpLiteral("daily.example.com"), false);
    assert.equal(isIpLiteral("999.1.1.1"), false);
  });
});

describe("checkHost", () => {
  const allowed = ["daily.example.com", "ubuntu-main"];
  it("accepts everything when no list is configured", () => {
    assert.equal(checkHost("attacker.test", []), true);
    assert.equal(checkHost(null, []), true);
  });
  it("accepts listed hosts, IP literals and localhost; refuses other names and a missing Host", () => {
    assert.equal(checkHost("daily.example.com", allowed), true);
    assert.equal(checkHost("UBUNTU-MAIN:4849", allowed), true);
    assert.equal(checkHost("127.0.0.1:4849", allowed), true);
    assert.equal(checkHost("[::1]:4849", allowed), true);
    assert.equal(checkHost("localhost:3000", allowed), true);
    assert.equal(checkHost("rebind.attacker.test:4849", allowed), false);
    assert.equal(checkHost(null, allowed), false);
  });
});

describe("checkStateChange", () => {
  it("never touches safe methods, pages or the Hermes routes", () => {
    assert.deepEqual(checkStateChange(facts({ method: "GET", secFetchSite: "cross-site" })), { allowed: true });
    assert.deepEqual(checkStateChange(facts({ pathname: "/", secFetchSite: "cross-site" })), { allowed: true });
    assert.deepEqual(checkStateChange(facts({ pathname: "/api/hermes/cards/x", secFetchSite: "cross-site" })), { allowed: true });
  });
  it("uses Sec-Fetch-Site when the browser sends it", () => {
    assert.deepEqual(checkStateChange(facts({ secFetchSite: "same-origin" })), { allowed: true });
    assert.deepEqual(checkStateChange(facts({ secFetchSite: "none" })), { allowed: true });
    assert.deepEqual(checkStateChange(facts({ secFetchSite: "cross-site", origin: "https://daily.example.com" })), { allowed: false, reason: "cross-site" });
    assert.deepEqual(checkStateChange(facts({ secFetchSite: "same-site" })), { allowed: false, reason: "cross-site" });
  });
  it("falls back to Origin vs Host", () => {
    assert.deepEqual(checkStateChange(facts({ origin: "https://daily.example.com" })), { allowed: true });
    assert.deepEqual(checkStateChange(facts({ origin: "http://localhost:3000", host: "localhost:3000" })), { allowed: true });
    assert.deepEqual(checkStateChange(facts({ origin: "https://evil.test" })), { allowed: false, reason: "origin-mismatch" });
    assert.deepEqual(checkStateChange(facts({ origin: "null" })), { allowed: false, reason: "cross-site" });
    assert.deepEqual(checkStateChange(facts({ origin: "not a url" })), { allowed: false, reason: "origin-mismatch" });
  });
  it("lets non-browser clients through (no browser headers at all)", () => {
    assert.deepEqual(checkStateChange(facts({ method: "PUT" })), { allowed: true });
    assert.deepEqual(checkStateChange(facts({ method: "DELETE", host: null })), { allowed: true });
  });
});
