import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedAddress, parseOutboundUrl, resolvePublicAddress, UnsafeUrlError } from "./safe-fetch";
import { webhookUrlProblem } from "./webhook-url";

test("private, loopback, link-local and reserved IPv4 addresses are blocked", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1"]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "104.18.20.1"]) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test("IPv6 loopback, unique-local, link-local and the IPv4-in-IPv6 forms of private addresses are blocked", () => {
  for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:a00:1", "64:ff9b::7f00:1", "2002:7f00:1::1"]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test("only https URLs with a real host and no credentials are accepted", () => {
  for (const bad of [
    "http://example.com/hook", "ftp://example.com", "file:///etc/passwd", "https://user:pw@example.com/", "https://localhost/x",
    "https://printer.local/x", "https://metadata.internal/x", "https://singlelabel/x", "https://169.254.169.254/latest/meta-data/",
    "https://127.0.0.1/", "https://[::1]/", "https://2130706433/", "https://0x7f.1/", "not a url",
  ]) {
    assert.throws(() => parseOutboundUrl(bad), UnsafeUrlError, bad);
  }
  assert.equal(parseOutboundUrl("https://hooks.slack.com/services/T/B/x").hostname, "hooks.slack.com");
});

test("a name that resolves to a private address is refused, even if it also resolves to a public one", async () => {
  const lookup = async (_h: string) => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }];
  await assert.rejects(resolvePublicAddress("rebind.example.com", lookup), UnsafeUrlError);
  const metadata = async () => [{ address: "169.254.169.254", family: 4 }];
  await assert.rejects(resolvePublicAddress("sneaky.example.com", metadata), UnsafeUrlError);
  const none = async () => [];
  await assert.rejects(resolvePublicAddress("nothing.example.com", none), UnsafeUrlError);
});

test("a public name resolves to the address that will be connected to", async () => {
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  assert.deepEqual(await resolvePublicAddress("example.com", lookup), { address: "93.184.216.34", family: 4 });
  assert.deepEqual(await resolvePublicAddress("2606:4700:4700::1111"), { address: "2606:4700:4700::1111", family: 6 });
});

test("Slack and Discord channels must point at those services", () => {
  assert.equal(webhookUrlProblem("slack", "https://hooks.slack.com/services/T000/B000/xyz"), null); // security-guard: allow fake fixture, not a real webhook
  assert.match(webhookUrlProblem("slack", "https://evil.example.com/services/x")!, /hooks\.slack\.com/);
  assert.match(webhookUrlProblem("slack", "https://hooks.slack.com.evil.com/x")!, /hooks\.slack\.com/);
  assert.equal(webhookUrlProblem("discord", "https://discord.com/api/webhooks/1/abc"), null);
  assert.match(webhookUrlProblem("discord", "https://discord.com/other")!, /Discord/);
  assert.match(webhookUrlProblem("webhook", "https://169.254.169.254/x")!, /not allowed/);
  assert.equal(webhookUrlProblem("webhook", "https://example.com/hook"), null);
});
