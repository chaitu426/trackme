import assert from "node:assert/strict";
import test from "node:test";

import { describeLink, downloadExtension, isSameSite } from "./autocapture";

test("treats www and subdomains as the same site", () => {
  assert.equal(isSameSite("www.example.com", "example.com"), true);
  assert.equal(isSameSite("blog.example.com", "example.com"), true);
  assert.equal(isSameSite("example.com", "www.example.com"), true);
  assert.equal(isSameSite("example.com.evil.io", "example.com"), false);
  assert.equal(isSameSite("notexample.com", "example.com"), false);
});

test("recognises downloadable files by extension", () => {
  assert.equal(downloadExtension("/files/report.PDF"), "pdf");
  assert.equal(downloadExtension("/a/b/archive.tar.gz"), "gz");
  assert.equal(downloadExtension("/pricing"), null);
  assert.equal(downloadExtension("/page.html"), null);
});

test("an external link is an outbound click and drops the query string", () => {
  const link = describeLink("https://other.com/a/b?token=secret#x", "example.com");
  assert.equal(link?.name, "outbound_click");
  assert.deepEqual(link?.properties, { url: "https://other.com/a/b", host: "other.com" });
});

test("a file link is a download, even on another host", () => {
  const link = describeLink("https://cdn.other.com/docs/guide.pdf", "example.com");
  assert.equal(link?.name, "file_download");
  assert.equal(link?.properties.file, "guide.pdf");
  assert.equal(link?.properties.ext, "pdf");
});

test("internal links, mailto and javascript links are ignored", () => {
  assert.equal(describeLink("https://example.com/pricing", "example.com"), null);
  assert.equal(describeLink("https://www.example.com/pricing", "example.com"), null);
  assert.equal(describeLink("mailto:a@b.com", "example.com"), null);
  assert.equal(describeLink("javascript:void(0)", "example.com"), null);
});
