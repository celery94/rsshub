# 微信发布与 Git 交付

## RSS 单篇交付

`rss-article` 模式先读取 [rss-article-workflow.md](rss-article-workflow.md)，完成内容审查后使用 `validate-article.mjs <task-dir>/article.md --mode rss-article` 校验。RSS 模式隐含微信标题、封面要求，同时要求至少一张与封面不同的正文图片。

通过 `rss-task.mjs publish <task_id> --python <python-executable>` 调用 RSS 发布桥，复用 `wechat-draft` 的现有图文草稿能力；不要绕过任务状态直接调用独立发布 CLI。发布桥使用 `article.md` 的 title、description、ogImage、source，作者为 `Aide Hub`，Markdown 格式和自动排版，正文图片失败即停止。source 必须与任务 source_url 一致。

成功后将微信返回的非空 `media_id` 和产物路径写入 `result.json`，向用户说明“已保存到公众号草稿箱”。该模式到此完成，不执行下文博客 Git 提交与推送步骤。提交中断或结果未知时，保留 `needs_attention`，核实公众号草稿箱后再人工处理，不自动再次新增草稿。

下文的 Prettier、`src/` 路径和 Git 交付约定适用于原有 `blog` 模式。RSS 工作区没有 Prettier 时不安装工具或虚构格式检查通过，使用已有校验脚本并完成文字审查。

## 微信文末

固定关注语默认省略。只有用户明确要求，或账号运营确实需要引导时，才在
`## 参考` 前加入一句与本篇判断直接相关的话。不得复用统一模板，也不得为了
关注引导改写文章结尾。

仅在文章已经产出对应资源或用户明确提供资源时，才可提到资料、清单、源码或自动回复关键词。关键词建议可以放在最终报告，不得把尚未配置的回复写成已生效能力。

## 发布前检查

对新文章和 `cover-brief.json` 运行 Prettier，再执行：

```bash
node .agents/skills/create-blog-post-from-url/scripts/validate-article.mjs \
  src/data/blog/{ID}-{slug}.md \
  --wechat
```

校验失败时：

- 保留已经生成的文章和资源
- 不调用微信发布
- 不提交、不推送
- 报告每个校验错误和本地文件路径

## 微信参数

使用 `wechat-draft` 技能，参数映射如下：

| 参数 | 来源 |
|---|---|
| `title` | frontmatter `title` |
| `content-file` | 新文章 Markdown 路径 |
| `content-format` | `markdown` |
| `author` | `Aide Hub` |
| `digest` | frontmatter `description` |
| `cover-image` | `ogImage` 指向的最终本地封面 |
| `content-source-url` | frontmatter `source` |

从项目或父目录的 `.env` 读取 `WECHAT_APP_ID` 和
`WECHAT_APP_SECRET`，不得输出凭据。

如果用户要求不生成封面但仍要发微信，必须取得已有永久封面素材或请用户提供本地封面。封面缺失时停止发布。

发布成功后报告 `media_id`，提醒用户在公众号后台检查草稿。

## Git 提交与推送

只有微信发布成功并返回 `media_id` 后才执行：

1. 检查当前分支、upstream 和工作区改动。
2. 只暂存：
   - `src/data/blog/{ID}-{slug}.md`
   - `src/assets/{ID}/`
3. 使用 `feat: add blog post {slug}` 形式的 Conventional Commit。
4. 推送当前分支；没有 upstream 时推送到 `origin` 同名分支并设置 upstream。
5. 报告 commit hash 和推送分支。

用户明确不发微信或只生成博客时，跳过本节全部 Git 操作。微信发布失败时也不提交、不推送。
