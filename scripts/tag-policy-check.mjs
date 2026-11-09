/** Fixed theme + article form classification; simulated output, no model calls. */
import assert from "node:assert/strict";
import { TAGGING_VERSION, TOPIC_TAGS, FORMAT_TAGS, normalizeTag, normalizeFormat, normalizeClassificationTags } from "../lib/tags.js";
import { ASSESSMENT_VERSION, assessArticles, buildAssessmentSystemPrompt, parseAssessmentResponse } from "../lib/ai.js";

const result = (tags, id = 1) => ({ id, contentType: "editorial", tags,
  score: 80, dimensions: { information: 20, evidence: 20, depth: 16, utility: 16, clarity: 8 },
  category: "engineering", relevance: 80, summary: "比较实现细节和测试结果。", reason: "说明了方法和限制。" });
let checks = 0;
async function check(label, run) { await run(); console.log(`ok ${++checks} - ${label}`); }

await check("taxonomy is bounded, disjoint and supports one or two themes with exactly one form", () => {
  assert.equal(TOPIC_TAGS.length, 14); assert.equal(FORMAT_TAGS.length, 8);
  assert.equal(new Set([...TOPIC_TAGS, ...FORMAT_TAGS]).size, 22);
  assert.equal(Object.isFrozen(TOPIC_TAGS), true); assert.equal(Object.isFrozen(FORMAT_TAGS), true);
  assert.deepEqual(normalizeClassificationTags(["技术解析", "软件开发"]), ["软件开发", "技术解析"]);
  assert.deepEqual(normalizeClassificationTags(["实践案例", "Agent应用", "商业与产业"]), ["Agent应用", "商业与产业", "实践案例"]);
  assert.deepEqual(normalizeClassificationTags(["#ＡＩ编程", "AI编程", "教程指南"]), ["AI编程", "教程指南"]);
  assert.equal(normalizeFormat(" #技术解析 "), "技术解析");
  assert.equal(normalizeTag("Rust"), "Rust", "legacy keyword filters stay readable");
});
await check("missing dimensions, extra dimensions and free-form keywords cannot pollute classification", () => {
  for (const tags of [[], ["软件开发"], ["技术解析"], ["软件开发", "教程指南", "技术解析"],
    ["软件开发", "数据与数据库", "AI编程", "技术解析"], ["软件开发", "技术解析", "Rust"],
    ["C#事件生命周期", "技术解析"], ["人工智能", "新闻动态"], ["软件开发", "\n技术解析"], null]) {
    assert.throws(() => normalizeClassificationTags(tags), JSON.stringify(tags));
  }
  for (const format of ["软件开发", "教程", "unknown", "", null, [], true]) assert.throws(() => normalizeFormat(format));
});
await check("parser enforces both dimensions per article while ad output stays short-circuited", () => {
  const parsed = parseAssessmentResponse(JSON.stringify([
    result(["数据与数据库", "教程指南"]), result(["MongoDB索引优化", "技术解析"], 2),
    { id: 3, contentType: "advertorial", discardReason: "主要内容引导购买产品" },
  ]), new Set([1, 2, 3]));
  assert.deepEqual(parsed.get(1).tags, ["数据与数据库", "教程指南"]);
  assert.equal(parsed.has(2), false); assert.equal(parsed.get(3).contentType, "advertorial");
  assert.throws(() => parseAssessmentResponse(JSON.stringify([result(["软件开发"])]), new Set([1])), /固定主题和内容类型/);
  // Distinct implementation details aggregate into the same stable reading categories.
  const related = parseAssessmentResponse(JSON.stringify([result(["软件开发", "技术解析"], 4), result(["软件开发", "技术解析"], 5)]), new Set([4, 5]));
  assert.deepEqual(related.get(4).tags, related.get(5).tags);
});
await check("prompt uses a fixed taxonomy, explains classification purpose and ignores old keyword vocabulary", () => {
  const prompt = buildAssessmentSystemPrompt("", ["DoNotReuseOldKeyword", "MongoDB索引优化"]);
  assert.deepEqual(JSON.parse(prompt.match(/主题词表：([^\n]+)。/u)[1]), TOPIC_TAGS);
  assert.deepEqual(JSON.parse(prompt.match(/内容类型词表：([^\n]+)。/u)[1]), FORMAT_TAGS);
  assert.equal(prompt.includes("DoNotReuseOldKeyword"), false);
  assert.ok(prompt.includes("每篇必须选择1–2个主题") && prompt.includes("且仅选择1个内容类型"));
  assert.ok(prompt.includes("不能自造标签") && prompt.includes("类型与质量评分相互独立"));
  assert.ok(prompt.includes("仅当文章对第二主题也有实质讨论") && prompt.includes("不从标题补造"));
});
await check("invalid classification retries and a separate version upgrades old labels without invalidating scores", async () => {
  let calls = 0;
  const assessed = await assessArticles({ articles: [{ id: 1, text: "The article explains C# event handler identity and unsubscription lifetime.", content_status: "ok" }],
    callModel: async ({ user }) => {
      calls++;
      if (calls === 2) assert.ok(user.includes("固定分类规则"));
      return JSON.stringify([result(calls === 1 ? ["C#事件生命周期"] : ["软件开发", "技术解析"])]);
    } });
  assert.equal(calls, 2); assert.equal(assessed.failures.length, 0);
  assert.deepEqual(assessed.results[0].tags, ["软件开发", "技术解析"]);
  assert.equal(assessed.results[0].taggingVersion, 3); assert.equal(TAGGING_VERSION, 3);
  assert.equal(assessed.results[0].version, ASSESSMENT_VERSION);
  assert.equal(ASSESSMENT_VERSION, 2, "classification changes do not invalidate scores");
});
console.log(`Passed ${checks} fixed classification policy checks (offline).`);
