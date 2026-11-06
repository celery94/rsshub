# 0.3.0 仓库与安装迁移

## 目录边界

```text
rsshub/                         完整插件源码与 Git 历史
  index.js / client.js / lib/    Host 与 Client
  skills/                       技能、脚本、模板唯一实现
  scripts/                      离线检查、打包与发布工具
  examples/                     空 OPML 与非秘密配置样例
  docs/                         安装、发布和迁移说明

<dataDir>/                      默认 ~/.dsh/rss-brief
  config.json                   本机非秘密配置，不随版本更新
  rss-brief.sqlite              原有数据库，迁移不改 schema
  publications/ / shares/       原任务关联，保留原 ID 和状态
  subscriptions.opml            新安装的默认订阅文件
  workspace/                    新安装的默认内容工作区

<articleWorkspace>/
  .env                          本机凭据，禁止入包和日志
  output/rss-articles/           原任务输入、文章、图片和草稿结果
  output/rss-shares/             原分享任务输入、图片与结果
```

源码目录不必同时充当内容工作区。新安装从数据目录使用默认内容工作区；旧安装可继续使用原工作区，避免移动历史路径。数据库中的文章、评分、已读记录和模型选择保持原样。

## 配置规则

配置优先级：默认值 < `<dataDir>/config.json` < 显式 Cordis 行配置。文件中只识别已有插件配置键，凭据不属于这些配置。`dataDir` 由显式行配置或旧默认路径决定，JSON 文件不能把自身重定向到另一目录。

- 未配 `opmlPath`：使用 `<dataDir>/subscriptions.opml`。不存在时，新库创建空文件；旧库先导出现有启用源，保留标题、RSS/网站 URL 和分组。
- 显式指定 `opmlPath`：不自动创建或覆盖该文件；路径错误会报告配置错误。
- 未配 `articleWorkspace`：默认 `<dataDir>/workspace`。显式指定 OPML 时兼容旧行为，回退至 OPML 所在目录。
- 重载后读取修改后的本机配置。包内 patch 始终是可移植的 `config: {}`。

## 本机迁移位置

本机插件源码由 `D:/Projects/repos/dsh-plugins/rss-brief` 迁入当前 `D:/Projects/repos/rsshub`；旧目录保留作回退来源，之后应只维护新仓库。

个人订阅与分类目录移到 `%USERPROFILE%/.dsh/rss-brief/subscriptions/`，本机 `config.json` 指向其中的 `folo.opml`。该移动保留文件内容与顺序。内容工作区仍显式使用 `D:/Projects/repos/rsshub`，保留原 `.env` 和 `output/`，不复制凭据、不改历史任务结果。这里是当前安装的兼容选择，其他安装无需相同路径。

以后若要把当前内容工作区也迁出源码目录，应单独处理历史任务记录与会话工作目录；本次通过显式保留旧工作区避免改写历史结果。新增安装已经完全支持独立内容工作区。

## 技能和任务兼容

三个技能由插件从 `skills/` 注册，配套资源从包内定位。任务 helper 使用 `createTaskRunner({ workspace, mode, skillRoot })`；命令行用绝对脚本路径及 `--workspace <任务工作区>`。Python 桥同样显式接收工作区，资源定位不再从工作区搜索技能副本。

旧 `.agents/skills` 目录及其七个 CLI 转发入口已移除，源码和发布包统一使用新入口。历史会话中手工复制的旧命令需要改为随包脚本路径。移除前检查的 17 个历史任务均已有非空草稿结果，其中待核对任务仍保持原状态；目录清理不修改这些结果。新任务提示词使用包内 helper 绝对路径；历史任务读取元数据中的 `workspaceDir`，不会因为默认工作区变化而重新生成。

同一数据目录仍生成相同任务 ID。已有非空 `media_id`、`needs_attention`、运行中的微信草稿阶段以及未知结果继续阻止自动重复创建；历史 `publish*` 字段保持只读。

## 验证范围

离线测试覆盖可移植默认值、本机配置优先级、旧数据库订阅保留、安装包资源注册、跨安装目录和内容工作区的 Node/Python 桥接、随包 CLI 直接调用，以及变更默认工作区后恢复原任务结果。

安装切换通过现有 Harness 的插件管理器完成。代码迁移和安装验证不调用真实生图、模型创作或微信上传，不借此提交内容发布请求。
