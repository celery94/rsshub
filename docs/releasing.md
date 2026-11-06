# 开发、打包与发布

## 开发来源

本仓库是 `@local/dsh-rss-brief` 的完整来源。包名、插件行 ID `rss-brief` 和默认数据目录保持稳定。开发时通过 Harness 插件管理器安装本仓库的绝对目录；不要修改 profile 的包清单或 patch，不要在 profile 运行 npm。

现有 Client 是可以直接交给 DSH 加载的 JavaScript，`npm run build` 校验 Host 和 Client 语法，无需额外 Web 服务。实现变更检查通过后按插件管理器返回结果重载，必要时刷新已有 Harness 页面。

## 本地验证

```powershell
npm ci --ignore-scripts
npm run check
npm test
npm run test:python
npm run package:check
```

`npm test` 执行全部已有 Host/Client 检查和技能 Node 测试，均使用临时目录、模拟服务或回环 HTTP。Python 测试需要 Python 3.10+ 和 `requirements.txt` 中的可选依赖。可通过 `PYTHON` 环境变量选择解释器。测试不生图、不调用真实模型、不保存微信草稿、不修改运行数据库。

`package:check` 实际运行 npm pack，检查压缩包条目，拒绝环境配置、个人订阅、缓存、数据库、产物和测试文件；然后把 tarball 安装进临时 npm 项目，验证依赖闭包、空订阅启动、Host 路由与三项技能资源。该步骤需要能访问 npm registry，或已有完整 npm 缓存。它不改变当前 Harness 安装。

## 生成版本包

1. 同时更新 `package.json` 与 lockfile 版本，并记录行为变化。
2. 完成本地验证。
3. 执行 `npm run release:pack`。
4. 交付 `artifacts/local-dsh-rss-brief-<version>.tgz` 与相邻 `.sha256` 文件。该命令不上传。

包保留 `private: true` 和 `UNLICENSED`。当前配置支持私有交付；迁移没有选择开源许可证。公开分发前应确认既有技能、参考和图标的来源与授权，设置项目许可证。公开发布 npm 时还须选用自己拥有的 npm scope、调整包名及 patch 引用，并明确已有安装的升级路径。GitHub Release 的版本包不要求先改 npm 包名。

## GitHub 自动化

- 仓库仅保留 `release.yml`，不在普通分支推送或 PR 上运行 Check 工作流。
- 推送 `v<version>` 标签后，在 Ubuntu、Node 26、Python 3.13 上执行检查和测试；要求标签与包版本一致，生成 tarball、SHA-256 和 CI artifact，随后创建附带这些文件的 **draft Release**。
- 维护者核对草稿后，在 GitHub 完成正式发布。工作流不调用 npm publish。

Release 工作流创建草稿，不直接公开发布，也不调用 npm publish。标签由维护者显式创建并推送。

## 安装与升级

通过 Harness 插件管理器安装本地源码目录或 `.tgz` 绝对路径。安装结果中的 `application`、`warnings` 和 `nextStep` 决定是否已激活；需要重启时应按提示处理。不要仅凭文件已经更新声称运行了新版本。

升级始终保留 `dataDir`。机器配置、SQLite、任务关联和内容工作区均在包外；不把它们复制进新版本包。升级后验证订阅数、阅读页、技能发现和历史草稿结果，验证期间不要点击真实创作按钮。

## 回退

通过插件管理器重新安装上一个版本包。数据库、已读记录和历史任务结果不恢复成旧快照、不做反向迁移。

本次保留的旧源码目录是参考和回退来源，但 0.2.0 使用旧目录约定，直接重新安装不足以恢复创作功能：先从当前外部订阅位置复制 OPML 和分类目录到旧 patch 指定的位置，并将迁移前 Git 提交 `4cff6d2` 的完整 `.agents/skills` 恢复到旧内容工作区。保持新 `skills/` 和数据目录不动，再由插件管理器切回旧源码。文件位置见 `migration.md`。旧内容任务继续使用其记录中的工作区，已有成功、待核对和未知结果不重做。
