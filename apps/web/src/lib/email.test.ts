import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTE } from "@trackme/landing/src/palette";
import { renderAlertEmail } from "./email";
import { codeBoxes, escapeHtml, factsTable, oneLine, renderEmail, safeUrl } from "./email-layout";

/**
 * The emails are part of the brand: same palette, same mark, no hue the app does not have. These tests render the real
 * templates and fail on the drift that the old ones had (zinc greys, a lilac accent, gradients, tracked uppercase labels, dead links)
 * and on the one thing worse than ugly in an email: a user-supplied string reaching the HTML unescaped.
 */

const sample = renderEmail({
  preheader: "pre",
  title: "A title",
  intro: "intro",
  body: factsTable([["Site", "acme.com"]]) + codeBoxes("123456"),
  action: { label: "Go", url: "https://app.example.com/x?y=1&z=2" },
  note: { tone: "warn", html: "careful" },
  reason: "because",
  appUrl: "https://app.example.com",
});

const HEX = (html: string) => [...html.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase());

test("the layout uses the palette's surfaces and text, and the old off-brand colours are gone", () => {
  const used = new Set(HEX(sample));
  for (const c of [PALETTE.surface.ink, PALETTE.surface.card, PALETTE.surface.raised, PALETTE.text.strong, PALETTE.text.body, PALETTE.signal.warn]) {
    assert.ok(used.has(c.toLowerCase()), `expected ${c} in the layout`);
  }
  for (const old of ["#0a0a0a", "#18181b", "#27272a", "#3f3f46", "#bcbcbc", "#969696", "#a2a2a2", "#c2c2c2", "#52525b", "#71717a", "#fafafa", "#f4f4f5"]) {
    assert.ok(!used.has(old), `${old} is not a TrackMe colour`);
  }
});

test("no gradients, no tracked uppercase labels, no emoji, no placeholder links", () => {
  assert.doesNotMatch(sample, /gradient/i);
  assert.doesNotMatch(sample, /text-transform:\s*uppercase|letter-spacing:\s*0\.\d+em/i);
  assert.doesNotMatch(sample, /href="#"/);
  assert.doesNotMatch(sample, /\p{Extended_Pictographic}/u);
});

test("the mark and the glyph band are text, so there is no image to block or host", () => {
  assert.doesNotMatch(sample, /<img/i);
  for (const g of [".", ":", "+", "#"]) assert.ok(sample.includes(`>${g}<`), `glyph ${g}`);
});

test("it declares dark colour scheme and has a hidden preheader", () => {
  assert.match(sample, /name="color-scheme" content="dark"/);
  assert.match(sample, /display:none;max-height:0/);
});

test("a link must be http(s); a javascript: or data: URL never becomes a button", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,x"), null);
  assert.equal(safeUrl("not a url"), null);
  assert.equal(safeUrl("https://a.example/x"), "https://a.example/x");
  const html = renderEmail({ preheader: "p", title: "t", action: { label: "Go", url: "javascript:alert(1)" }, appUrl: "https://a.example" });
  assert.doesNotMatch(html, /javascript:/);
});

test("the button URL is attribute-escaped", () => {
  assert.ok(sample.includes('href="https://app.example.com/x?y=1&amp;z=2"'));
});

test("an alert escapes every user-supplied string, in the title, message, field names and values", () => {
  const evil = `<img src=x onerror=alert(1)>`;
  const { subject, html, text } = renderAlertEmail({
    title: `Spike ${evil}`,
    message: `Down ${evil}`,
    timestamp: "2026-11-10T10:00:00Z",
    siteDomain: evil,
    workspaceName: evil,
    fields: { [evil]: evil, count: 4 },
    dashboardUrl: "javascript:alert(1)",
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.ok(subject.startsWith("[TrackMe] "));
  assert.doesNotMatch(text, /javascript:/);
  assert.match(html, /Tue, 10 Nov 2026 10:00:00 GMT/);
});

test("an alert with a real dashboard link gets a button and the link in the plain text", () => {
  const { html, text } = renderAlertEmail({ title: "t", message: "m", timestamp: "2026-11-10T10:00:00Z", siteDomain: "a.com", workspaceName: "W", dashboardUrl: "https://app.example.com/w/overview" });
  assert.match(html, /Open in TrackMe/);
  assert.match(text, /https:\/\/app\.example\.com\/w\/overview/);
});

test("subject and name helpers cannot carry a header injection", () => {
  assert.equal(oneLine("Acme\r\nBcc: victim@example.com"), "Acme Bcc: victim@example.com");
  assert.equal(oneLine(`a${String.fromCharCode(0x2028)}b`), "a b");
  assert.equal(escapeHtml(`"<&>'`), "&quot;&lt;&amp;&gt;&#39;");
});

test("the code boxes carry exactly the digits given", () => {
  const boxes = codeBoxes("048213");
  for (const d of "048213") assert.ok(boxes.includes(`>${d}</td>`));
  assert.equal((boxes.match(/<td align="center"/g) ?? []).length, 6);
});
