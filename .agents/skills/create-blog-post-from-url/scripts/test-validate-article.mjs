import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findBannedPhrases, validateArticle } from "./validate-article.mjs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);

const DEFAULT_BODY = "正文。\n\n![输入与检查的概念示意](./assets/02-illustration-flow.png)";

function createFixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rss-article-validator-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const taskDir = path.join(root, "output", "rss-articles", "rss-test");
  const assets = path.join(taskDir, "assets");
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, "01-cover.png"), PNG);
  fs.writeFileSync(path.join(assets, "02-illustration-flow.png"), PNG);

  const title = overrides.title ?? "测试工具：完成可靠发布";
  const description =
    overrides.description ??
    "这是一段用于验证文章发布流程的中文摘要，说明文章解决的问题、适合的读者、可以获得的结果，以及执行过程中需要关注的限制和检查方法，确保长度符合公众号列表和微信预览要求。";
  const source = "https://example.com/source";
  const body = overrides.body ?? DEFAULT_BODY;
  const articlePath = path.join(taskDir, "article.md");

  fs.writeFileSync(
    path.join(assets, "cover-brief.json"),
    JSON.stringify({
      article_title: title,
      cover_type: "tutorial",
      core_theme: "可靠发布",
      reader_takeaway: "完成发布",
      summary_angle: "从输入到验证",
      narrative_flow: "3-beat process",
      information_blocks: [
        { role: "step", source_anchor: "原文步骤一", visual_idea: "输入" },
        { role: "step", source_anchor: "原文步骤二", visual_idea: "验证" },
      ],
      selected_style: "HD-2D",
      selected_style_prompt_descriptor: "HD-2D pixel diorama",
      final_prompt: "wide cover illustration",
    }),
  );

  fs.writeFileSync(
    articlePath,
    `---
pubDatetime: 2026-01-01T12:00:00+08:00
title: "${title}"
description: "${description}"
tags: ["Test"]
slug: "test-article"
ogImage: "./assets/01-cover.png"
source: "${source}"
---

${body}

## 参考

- [原文](${source})
`,
  );

  return { root, taskDir, assets, articlePath };
}

const RSS = { mode: "rss-article" };

test("有效的 RSS 文章通过校验，模式参数可省略", t => {
  const fixture = createFixture(t);
  assert.deepEqual(validateArticle(fixture.articlePath), []);
  assert.deepEqual(validateArticle(fixture.articlePath, RSS), []);
  assert.deepEqual(validateArticle(fixture.articlePath, { mode: "blog" }), ["不支持的文章模式: blog"]);
});

test("拦截微信超长标题", t => {
  const fixture = createFixture(t, { title: "题".repeat(33) });
  assert.ok(validateArticle(fixture.articlePath).some(error => error.includes("微信标题最多 32")));
});

test("文章文件名必须为 article.md", t => {
  const fixture = createFixture(t);
  const renamed = path.join(fixture.taskDir, "001-test-article.md");
  fs.renameSync(fixture.articlePath, renamed);
  assert.ok(validateArticle(renamed).some(error => error.includes("article.md")));
});

test("拦截缺失的封面", t => {
  const fixture = createFixture(t);
  fs.rmSync(path.join(fixture.assets, "01-cover.png"));
  assert.ok(validateArticle(fixture.articlePath).some(error => error.includes("不存在")));
});

test("拦截黑名单句式", () => {
  const cases = [
    ["本文把这个问题拆开，分三步处理。", "宣布拆解问题"],
    ["下面按四个问题拆开日常表达式。", "宣布拆解问题"],
    ["这篇带你看懂中央包管理。", "带你看懂"],
    ["瓶颈不是生成代码，而是审查代码。", "不是……而是"],
    ["省下的不是算力，是每一轮判断的延迟。", "不是……而是"],
    ["一文看懂中央包管理。", "带你看懂"],
    ["你以为它在理解上出问题，其实它缺验收标准。", "你以为"],
    ["表面上是性能问题，实际上是锁竞争。", "你以为"],
    ["一个反直觉的观察：日历越满越容易漏事。", "反直觉"],
  ];
  for (const [body, label] of cases) {
    assert.ok(
      findBannedPhrases({ body }).some(hit => hit.includes(label)),
      `未拦截: ${body}`,
    );
  }
  assert.ok(
    findBannedPhrases({ description: "本文拆解四道关口。" })[0].startsWith(
      "description",
    ),
  );
});

test("黑名单不误伤技术表述、代码和参考", () => {
  const body = [
    "差集可能把一个区间拆成两个。",
    "用 `-f` 而不是 `-F`，是为了避免转义。",
    "判别字段存在但不是字符串，是协议错误。",
    "反汇编器也叫拆解工具。",
    "`不是 A，而是 B` 只出现在行内代码里。",
    "```",
    "// 你以为这里会抛异常",
    "```",
    "> 原文引用：你以为这是缓存问题。",
    "",
    "## 参考",
    "",
    "- [一个反直觉的观察](https://example.com)",
  ].join("\n");
  assert.deepEqual(findBannedPhrases({ body }), []);
});

test("文章校验报告黑名单命中", t => {
  const fixture = createFixture(t, { body: `这类补全不是模型问题，而是上下文问题。\n\n${DEFAULT_BODY}` });
  assert.ok(validateArticle(fixture.articlePath).some(error => error.includes("命中禁用句式")));
});

test("RSS 必须有正文图，封面重复引用不能替代", t => {
  for (const body of ["正文。", "![重复的封面](./assets/01-cover.png)"]) {
    const fixture = createFixture(t, { body });
    assert.ok(validateArticle(fixture.articlePath, RSS).some(error => error.includes("至少一张")));
  }
});

test("RSS 不把代码示例中的图片当作正文配图", t => {
  const fixture = createFixture(t, { body: [
    "示例：", "```markdown", "![流程示意](./assets/02-illustration-flow.png)", "```",
    "`![流程示意](./assets/02-illustration-flow.png)`",
    "<!-- ![流程示意](./assets/02-illustration-flow.png) -->",
  ].join("\n") });
  assert.ok(validateArticle(fixture.articlePath, RSS).some(error => error.includes("至少一张")));
});

test("RSS 不把破损语法、转义文本或未闭合代码围栏算作正文图", t => {
  for (const body of [
    "![流程概念示意](./assets/02-illustration-flow.png",
    "\\![流程概念示意](./assets/02-illustration-flow.png)",
    "```markdown\n![流程概念示意](./assets/02-illustration-flow.png)",
  ]) {
    const fixture = createFixture(t, { body });
    assert.ok(validateArticle(fixture.articlePath, RSS).some(error => error.includes("至少一张")), body);
  }
});

test("RSS 必需正文图不能放入微信会改写的参考章节", t => {
  const fixture = createFixture(t, { body: "正文。" });
  fs.appendFileSync(fixture.articlePath, "\n![流程概念示意](./assets/02-illustration-flow.png)\n");
  const errors = validateArticle(fixture.articlePath, RSS);
  assert.ok(errors.some(error => error.includes("不能放进")));
  assert.ok(errors.some(error => error.includes("至少一张")));
});

test("RSS 原文 URL 必须位于实际参考章节而非仅在正文或代码里", t => {
  const fixture = createFixture(t);
  const content = fs.readFileSync(fixture.articlePath, "utf8").replace(
    "## 参考\n\n- [原文](https://example.com/source)",
    "原文：https://example.com/source\n\n## 参考\n\n无来源。",
  );
  fs.writeFileSync(fixture.articlePath, content);
  assert.ok(validateArticle(fixture.articlePath, RSS).some(error => error.includes("参考 小节必须包含原文")));
});

test("RSS 生成图片命名与发布桥约定一致", t => {
  const fixture = createFixture(t);
  fs.copyFileSync(path.join(fixture.assets, "01-cover.png"), path.join(fixture.assets, "other.png"));
  fs.writeFileSync(fixture.articlePath, fs.readFileSync(fixture.articlePath, "utf8").replace(
    "./assets/01-cover.png", "./assets/other.png",
  ).replace("./assets/02-illustration-flow.png", "./assets/other.png"));
  const errors = validateArticle(fixture.articlePath, RSS);
  assert.ok(errors.some(error => error.includes("封面必须使用")));
  assert.ok(errors.some(error => error.includes("02-illustration")));
});

test("RSS 拦截越界、远程、缺失、错误格式与非图片文件", t => {
  const cases = [
    ["../../../secret.png", "越出"],
    ["%2e%2e/%2e%2e/secret.png", "越出"],
    ["https://example.com/image.png", "本地资源"],
    ["data:image/png;base64,abcd", "本地资源"],
    ["./assets/missing.png", "不存在"],
    ["./assets/02-illustration-flow.webp", "只支持"],
    ["./assets/02-illustration-flow.png?version=1", "不含 URL 参数"],
    ["./assets/02-illustration-flow.png#figure", "不含 URL 参数"],
  ];
  for (const [reference, expected] of cases) {
    const fixture = createFixture(t, { body: `![机制概念示意](${reference})` });
    assert.ok(validateArticle(fixture.articlePath, RSS).some(error => error.includes(expected)), reference);
  }
  const fixture = createFixture(t);
  fs.writeFileSync(path.join(fixture.assets, "02-illustration-flow.png"), "this is not a PNG");
  assert.ok(validateArticle(fixture.articlePath, RSS).some(error => error.includes("文件头")));
});

test("RSS 图片要求中文说明和内联 Markdown", t => {
  for (const body of [
    "![flow](./assets/02-illustration-flow.png)",
    "![流程示意](<./assets/02-illustration-flow.png>)",
    '<img src="./assets/02-illustration-flow.png" alt="流程示意">',
    "![流程示意][flow]\n\n[flow]: ./assets/02-illustration-flow.png",
  ]) {
    const fixture = createFixture(t, { body });
    assert.ok(validateArticle(fixture.articlePath, RSS).length > 0);
  }
});

test("RSS 拦截指向目录外的资源 junction", t => {
  const fixture = createFixture(t);
  const external = path.join(fixture.root, "external");
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, "secret.png"), PNG);
  fs.symlinkSync(external, path.join(fixture.assets, "linked"), "junction");
  fs.writeFileSync(fixture.articlePath, fs.readFileSync(fixture.articlePath, "utf8").replace(
    "./assets/02-illustration-flow.png", "./assets/linked/secret.png",
  ));
  assert.ok(validateArticle(fixture.articlePath, RSS).some(error => error.includes("实际路径越出")));
});

test("RSS 对损坏的资源转义返回校验错误", t => {
  const fixture = createFixture(t);
  fs.writeFileSync(fixture.articlePath, fs.readFileSync(fixture.articlePath, "utf8").replace(
    "./assets/01-cover.png", "%broken",
  ));
  assert.ok(validateArticle(fixture.articlePath, RSS).some(error => error.includes("无法读取或不存在: %broken")));
});

test("CLI 默认按 RSS 校验，只接受 rss-article 模式", t => {
  const fixture = createFixture(t);
  const script = fileURLToPath(new URL("./validate-article.mjs", import.meta.url));
  const valid = spawnSync(process.execPath, [script, fixture.articlePath, "--mode", "rss-article"], { encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);
  const implicit = spawnSync(process.execPath, [script, fixture.articlePath], { encoding: "utf8" });
  assert.equal(implicit.status, 0, implicit.stderr);
  for (const args of [["--mode", "rss"], ["--mode", "blog"], ["--wechat"]]) {
    const invalid = spawnSync(process.execPath, [script, fixture.articlePath, ...args], { encoding: "utf8" });
    assert.equal(invalid.status, 2, args.join(" "));
  }
});
