/** Runtime skills and resources always come from the installed bundle. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const skillsRoot = fileURLToPath(new URL("../skills/", import.meta.url));
export const articleSkillRoot = join(skillsRoot, "create-blog-post-from-url");
const names = ["create-blog-post-from-url", "azure-image-gen", "wechat-draft"];

export function registerSkills(ctx) {
  const registry = ctx.get?.("skills") ?? ctx.skills;
  if (!registry) return;
  for (const name of names) {
    const root = join(skillsRoot, name);
    const path = join(root, "SKILL.md");
    const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
    const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    const value = header?.[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
    if (!value) throw new Error(`技能缺少 description：${name}`);
    const description = value.startsWith('"') ? JSON.parse(value) : value;
    ctx.effect(() => registry.register({
      name, description, path, source: "runtime", provider: "rss-brief",
      resourceBase: { kind: "directory", path: root },
      content: text.slice(header[0].length).trim(),
    }), `rss-brief: skill ${name}`);
  }
}
