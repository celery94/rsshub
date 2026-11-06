/** Offline article/document fixtures. Run: node scripts/readable-check.mjs */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { EXTRACTOR_VERSION, buildContentDocument, contentDocumentText, extractReadable, isHtmlContentType } from "../lib/readable.js";

let checks = 0;
function check(label, run) {
  run();
  checks += 1;
  console.log(`ok ${checks} - ${label}`);
}
function nodes(document) {
  const all = [];
  function walk(children) {
    for (const node of children || []) { all.push(node); walk(node.children); }
  }
  walk(document.children);
  return all;
}
function find(document, type) { return nodes(document).filter((node) => node.type === type); }
function assertBounded(document, { bytes = 1048576, count = 10000, depth = 32 } = {}) {
  assert.ok(Buffer.byteLength(JSON.stringify(document)) <= bytes, "JSON byte cap");
  assert.ok(nodes(document).length <= count, "node count cap");
  function measure(children, level = 1) {
    for (const node of children || []) {
      assert.ok(level <= depth, "tree depth cap");
      measure(node.children, level + 1);
    }
  }
  measure(document.children);
}

const richBody = `<h1>Research notes</h1>
  <p>A real article keeps <strong>important words</strong> and <em>emphasis</em> with
  a <a href="../reference?x=1&amp;y=2" title="Reference">reference</a>.
  This paragraph explains the results with enough original prose for extraction.</p>
  <h2>Methods</h2><h3>Details</h3><h4>Measurements</h4><h5>Controls</h5><h6>Appendix</h6>
  <blockquote><p>The experiment is reproducible and the observations are useful.</p></blockquote>
  <ul><li>First observation</li><li>Second observation</li></ul>
  <ol start="3"><li>Third step</li></ol>
  <pre><code>function example() {\n  const value = 42;\n\n  return value;\n}</code></pre>
  <figure><img src="/fallback.jpg" data-src="../images/diagram.png" alt="A useful diagram" width="640" height="360" title="Diagram"><figcaption>Measured results.</figcaption></figure>
  <table><thead><tr><th scope="col" colspan="2">Metric</th></tr></thead><tbody><tr><td rowspan="2">Accuracy</td><td>99%</td></tr><tr><td>98%</td></tr></tbody></table>
  <p>Additional context describes the tradeoffs and explains why these measurements
  matter. Readers can reproduce the setup and compare its accuracy with earlier results.<br>Final observation.</p><hr>`;
const richPage = `<!doctype html><html lang="en"><head><title>Research notes | Example</title></head><body>
  <header>Site logo</header><nav>menu item <a href="/subscribe">Subscribe now</a></nav>
  <article>${richBody}</article><footer>Footer navigation</footer></body></html>`;
const base = { url: "https://example.test/news/2026/post" };

check("extractor version and existing HTML MIME recognition", () => {
  assert.equal(EXTRACTOR_VERSION, 3);
  for (const type of ["text/html; charset=utf-8", "application/xhtml+xml", "application/xml", "text/xml"]) assert.equal(isHtmlContentType(type), true);
  assert.equal(isHtmlContentType("application/pdf"), false);
});

check("Readability preserves rich article structure and resolves final-URL assets", () => {
  const result = extractReadable(richPage, base);
  assert.equal(result.extractorVersion, 3);
  assert.equal(result.document.version, 1);
  assert.equal(result.quality.usable, true);
  assert.ok(result.title.includes("Research notes"));
  assert.ok(result.text.includes("important words"));
  assert.ok(!result.text.includes("Subscribe now"));
  assert.ok(!result.text.includes("Footer navigation"));
  for (const type of ["p", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li", "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "strong", "em", "a", "img", "figure", "figcaption", "br", "hr"]) {
    assert.ok(find(result.document, type).length, `preserved ${type}`);
  }
  assert.equal(find(result.document, "a")[0].href, "https://example.test/news/reference?x=1&y=2");
  assert.equal(find(result.document, "img")[0].src, "https://example.test/news/images/diagram.png");
  assert.equal(find(result.document, "img")[0].width, 640);
  assert.equal(find(result.document, "img")[0].alt, "A useful diagram");
  assert.equal(find(result.document, "ol")[0].start, 3);
  assert.equal(find(result.document, "th")[0].colSpan, 2);
  assert.equal(find(result.document, "td")[0].rowSpan, 2);
  const code = contentDocumentText({ children: find(result.document, "code") });
  assert.equal(code, "function example() {\n  const value = 42;\n\n  return value;\n}");
  assert.ok(result.text.includes("\n  const value = 42;\n\n  return value;"));
  assert.equal(result.truncated, false);
  assertBounded(result.document);
});

check("feed conversion does not select or discard short feed fragments", () => {
  const document = buildContentDocument(`<h1>A feed title</h1><p>Brief <b>news</b> &amp; <i>context</i>.</p><div>Another paragraph.</div>`, base);
  assert.equal(document.version, 1);
  assert.equal(find(document, "h1").length, 1);
  assert.equal(find(document, "strong").length, 1);
  assert.equal(find(document, "em").length, 1);
  assert.ok(contentDocumentText(document).includes("Brief news & context."));
  assert.ok(contentDocumentText(document).includes("Another paragraph."));
  assert.equal(document.truncated, false);
  const code = buildContentDocument("<pre><code>\n  leading indentation\n\n</code></pre>");
  assert.equal(contentDocumentText(code), "\n  leading indentation\n\n");
});

check("Atom entity-encoded HTML is parsed once through the same sanitizer", () => {
  const document = buildContentDocument('&lt;p&gt;Encoded &lt;strong&gt;feed&lt;/strong&gt; text.&lt;/p&gt;&lt;img src="/encoded.jpg" onerror="evil()"&gt;&lt;script&gt;evil()&lt;/script&gt;', base);
  assert.equal(find(document, "p").length, 1);
  assert.equal(find(document, "strong").length, 1);
  assert.equal(find(document, "img")[0].src, "https://example.test/encoded.jpg");
  assert.equal(find(document, "img")[0].onerror, undefined);
  assert.ok(!contentDocumentText(document).includes("evil()"));
  const literal = buildContentDocument("The literal tag &lt;p&gt; is part of this explanation.");
  assert.equal(find(literal, "p").length, 0);
  assert.ok(contentDocumentText(literal).includes("<p>"));
});

check("output allowlist removes executable HTML, forbidden attributes and unsafe URLs", () => {
  const document = buildContentDocument(`<p id="p" class="x" style="color:red" onclick="evil()">Safe
    <a href="javascript:alert(1)" onclick="evil()">script link</a>
    <a href="java&#x09;script:alert(1)">obfuscated link</a>
    <a href="data:text/html,bad">data link</a><a href="file:///secret">file link</a>
    <a href="https://user:password@example.test/">credential link</a>
    <a href="/good" onmouseover="evil()" target="_blank">good link</a>
    <a href="mailto:person@example.test">email</a>
    <img src="javascript:evil()" onerror="evil()"><img src="data:image/svg+xml,bad">
    <img src="/real.png" onload="evil()" style="width:100%"></p>
    <script>document.body.innerHTML = 'EXECUTED';</script><style>.bad{}</style>
    <iframe src="https://external.invalid/"></iframe><svg><text>SVG payload</text></svg>
    <form>Login form<input type="password"></form><p hidden>Hidden payload</p>
    <p style="display:none">Invisible payload</p><div aria-hidden="true">Hidden aria</div>`, base);
  assert.equal(find(document, "a").length, 1);
  assert.equal(find(document, "a")[0].href, "https://example.test/good");
  assert.equal(find(document, "img").length, 1);
  const allowedTypes = new Set("p h1 h2 h3 h4 h5 h6 blockquote ul ol li pre code table thead tbody tr th td strong em a img figure figcaption br hr text".split(" "));
  const allowedKeys = new Set("type children text href src alt title width height start colSpan rowSpan".split(" "));
  for (const node of nodes(document)) {
    assert.ok(allowedTypes.has(node.type));
    for (const key of Object.keys(node)) assert.ok(allowedKeys.has(key), `unexpected property ${key}`);
    if (node.href || node.src) assert.match(node.href || node.src, /^https?:\/\//);
  }
  const text = contentDocumentText(document);
  for (const bad of ["EXECUTED", "SVG payload", "Login form", "Hidden payload", "Invisible payload", "Hidden aria"]) assert.ok(!text.includes(bad));
  assert.ok(text.includes("script link"), "unsafe anchor's harmless text survives");
});

check("known video players become inert watch-link nodes; unknown iframes are dropped", () => {
  const document = buildContentDocument(`<p>Intro text.</p>
    <p><iframe src="//player.bilibili.com/player.html?isOutside=true&amp;aid=1&amp;bvid=BV1ij4g6xEsH&amp;p=1" title="Clip"></iframe></p>
    <iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1"></iframe>
    <iframe src="https://player.vimeo.com/video/12345"></iframe>
    <iframe src="https://player.bilibili.com/player.html?bvid=bad"></iframe>
    <iframe src="https://ads.invalid/embed/123"></iframe>
    <video src="/clip.mp4" poster="javascript:evil()"><track src="/x.vtt"></video>
    <video poster="/p.jpg"><source src="data:video/mp4,bad"><source src="/b.webm"></video>
    <video></video>`, base);
  assert.deepEqual(find(document, "video"), [
    { type: "video", provider: "bilibili", url: "https://www.bilibili.com/video/BV1ij4g6xEsH/", title: "Clip" },
    { type: "video", provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", poster: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" },
    { type: "video", provider: "vimeo", url: "https://vimeo.com/12345" },
    { type: "video", provider: "native", url: "https://example.test/clip.mp4" },
    { type: "video", provider: "native", url: "https://example.test/b.webm", poster: "https://example.test/p.jpg" },
  ]);
  assert.ok(contentDocumentText(document).includes("[视频：bilibili https://www.bilibili.com/video/BV1ij4g6xEsH/]"));
});

check("Readability keeps known players and drops related-content blocks", () => {
  const prose = "<p>漫威花了四年时间，用五部电影，让这个环绕镜头成为时代的经典。这一段足够长，用来模拟真实文章的导语与背景介绍，让提取器把它视为正文。</p>".repeat(3);
  const page = `<html><head><title>Video post</title></head><body><main><article>
    <div class="single-breadcrumbs"><a href="/">Home</a> › Videos</div>
    <h1>Video post</h1>${prose}
    <p><iframe src="//player.bilibili.com/player.html?bvid=BV1ij4g6xEsH"></iframe></p>
    <p><img src="/cover.jpg" alt="cover"></p></article>
    <div class="related-content"><h3>相关文章</h3><ul><li><a href="/other"><img src="/thumb.jpg">Other post</a></li></ul></div>
    </main></body></html>`;
  const result = extractReadable(page, base);
  assert.equal(result.quality.usable, true);
  assert.equal(find(result.document, "video")[0]?.url, "https://www.bilibili.com/video/BV1ij4g6xEsH/");
  assert.deepEqual(find(result.document, "img").map((image) => image.src), ["https://example.test/cover.jpg"]);
  assert.ok(!result.text.includes("相关文章") && !result.text.includes("Home"));
});

check("mailto is opt-in; relative URLs need an explicit final URL; HTML base cannot redirect", () => {
  const email = `<a href="mailto:person@example.test">Email</a>`;
  assert.equal(find(buildContentDocument(email), "a").length, 0);
  assert.equal(find(buildContentDocument(email, { allowMailto: true }), "a")[0].href, "mailto:person@example.test");
  assert.equal(find(buildContentDocument('<a href="/relative">Relative</a><img src="/relative.png">'), "a").length, 0);
  assert.equal(find(buildContentDocument('<a href="/relative">Relative</a><img src="/relative.png">'), "img").length, 0);
  const document = buildContentDocument('<base href="https://attacker.test/"><a href="next">Next</a>', base);
  assert.equal(find(document, "a")[0].href, "https://example.test/news/2026/next");
  const extracted = extractReadable(richPage.replace("<head>", '<head><base href="https://attacker.test/">'), base);
  assert.equal(find(extracted.document, "a")[0].href, "https://example.test/news/reference?x=1&y=2");
});

check("lazy images survive and obvious tracking pixels are discarded", () => {
  const document = buildContentDocument(`<p>Pictures</p>
    <img src="/pixel.gif" width="1" height="1">
    <img src="/collect.gif" width="1" height="1">
    <img src="/tracking.gif"><img data-src="/beacon.png">
    <img src="data:image/gif,placeholder" data-original="/photo.jpg">
    <img data-lazy-src="//cdn.example.test/chart.png" alt="Chart">
    <img data-srcset="/small.webp 400w, /large.webp 1200w">`, base);
  assert.deepEqual(find(document, "img").map((image) => image.src), [
    "https://example.test/photo.jpg", "https://cdn.example.test/chart.png", "https://example.test/large.webp",
  ]);
});

check("short semantic articles remain usable below the old 200-character threshold", () => {
  for (const container of ["article", "main"]) {
    const result = extractReadable(`<title>A small discovery</title><nav>Menu</nav><${container}><h1>A small discovery</h1><p>The new release fixes the parser and preserves every item.</p></${container}><footer>Copyright</footer>`, base);
    assert.equal(result.quality.usable, true);
    assert.ok(result.text.length < 200);
    assert.ok(result.text.includes("fixes the parser"));
  }
});

check("login, CAPTCHA, link directories and extraction failures return empty documents", () => {
  const pages = [
    `<title>Just a moment...</title><main><h1>Checking your browser</h1><p>Enable JavaScript and cookies to continue.</p></main>`,
    `<title>Sign in | Example</title><main><form><input type="password"><p>Sign in to your account</p></form></main>`,
    `<title>Member area</title><form><input type="password"><p>Enter your password to continue.</p></form><p>${"Account navigation. ".repeat(100)}</p>`,
    `<title>Member area</title><article><h1>Log in</h1><p>You need to sign in to continue reading this article.</p></article>`,
    `<title>Security</title><main><p>Please verify that you are human and complete the captcha.</p></main>`,
    `<title>Links</title><main>${Array.from({ length: 80 }, (_, i) => `<p><a href="/${i}">Directory entry number ${i}</a></p>`).join("")}</main>`,
    `<title>Welcome</title><nav>${"Home About Contact Subscribe ".repeat(200)}</nav><footer>${"Copyright Terms Privacy ".repeat(200)}</footer>`,
    `<title>No article</title><div>${"Unstructured menu text ".repeat(4)}</div>`,
    "",
  ];
  for (const page of pages) {
    const result = extractReadable(page, base);
    assert.equal(result.quality.usable, false, result.text);
    assert.equal(result.text, "");
    assert.deepEqual(result.document.children, []);
  }
});

check("technical articles may discuss login and CAPTCHA without being rejected", () => {
  for (const title of ["How CAPTCHA and login work", "CAPTCHA protocol explained", "Login security explained"]) {
    const result = extractReadable(`<title>${title}</title><article><h1>${title}</h1>
      <p>A developer may see the prompt “verify that you are human” during a security test.
      This technical article explains the protocol, its limits, and the user experience.</p>
      <p>${"The server issues a token and verifies its signature before returning a response. ".repeat(4)}</p></article>`, base);
    assert.equal(result.quality.usable, true);
    assert.ok(result.text.includes("verify that you are human"));
  }
});

check("text cap truncates both extraction and feed documents with an explicit flag", () => {
  const html = `<article><h1>Long article</h1><p>${"Useful scientific observations with detailed evidence. ".repeat(1800)}</p></article>`;
  const result = extractReadable(html, base);
  assert.equal(result.quality.usable, true);
  assert.ok(result.text.length <= 60000);
  assert.equal(result.truncated, true);
  assert.equal(result.document.truncated, true);
  assert.ok(find(result.document, "text").reduce((sum, node) => sum + node.text.length, 0) <= 60000);
  const document = buildContentDocument(html, { ...base, maxTextLength: 100 });
  assert.equal(document.truncated, true);
  assert.ok(find(document, "text").reduce((sum, node) => sum + node.text.length, 0) <= 100);
  assertBounded(result.document);
});

check("JSON byte cap handles Unicode, escaped strings and metadata", () => {
  for (const text of ["研究😀\"\\".repeat(500), "a".repeat(2000)]) {
    const document = buildContentDocument(`<p>${text}</p>`, { ...base, maxDocumentBytes: 512 });
    assert.equal(document.truncated, true);
    assert.ok(contentDocumentText(document).length > 0);
    assertBounded(document, { bytes: 512 });
    JSON.parse(JSON.stringify(document));
  }
  const metadata = `<figure>${'<img src="https://example.test/image.jpg" alt="'.concat("large ".repeat(200), '">').repeat(1800)}</figure>`;
  const document = buildContentDocument(metadata, base);
  assert.equal(document.truncated, true);
  assertBounded(document);
});

check("node and nesting caps are enforced and caller overrides cannot raise hard limits", () => {
  const document = buildContentDocument(`<ul>${"<li><strong>Item</strong></li>".repeat(5000)}</ul>`, { ...base, maxNodes: 999999 });
  assert.equal(document.truncated, true);
  assertBounded(document);
  const small = buildContentDocument(`<p>${"<strong>x</strong>".repeat(100)}</p>`, { maxNodes: 10 });
  assert.equal(small.truncated, true);
  assertBounded(small, { count: 10 });
  const nested = buildContentDocument(`${"<blockquote>".repeat(80)}<p>Deep content</p>${"</blockquote>".repeat(80)}`, base);
  assert.equal(nested.truncated, true);
  assertBounded(nested);
  const shallow = buildContentDocument("<blockquote><blockquote><p>Deep content</p></blockquote></blockquote>", { maxDepth: 2 });
  assert.equal(shallow.truncated, true);
  assertBounded(shallow, { depth: 2 });
});

console.log(`Passed ${checks} readable checks (offline fixtures; no network).`);
