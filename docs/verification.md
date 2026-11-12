# 0.3.0 迁移验证记录

验证日期：2026-11-06，Asia/Shanghai。

## 本机检查

环境：Windows、Node.js 26.13.0、npm 11.20.0、Python 3.13.0。现有 Python 环境包含 requests 2.32.5、Pillow 11.3.0、beautifulsoup4 4.13.5；迁移没有自动安装 Python 依赖。

| 检查 | 结果 |
| --- | --- |
| npm ci --ignore-scripts | 通过，37 个运行依赖包 |
| npm run check | Host、Client、库、脚本、技能语法及 manifest/lock 版本一致 |
| npm test | 29 个 Host/Client 检查脚本全部通过，技能 Node 测试 126/126 |
| npm run test:python | 文章与桥接 45/45，Azure 3/3，微信 16/16 |
| 指定 PYTHON 的跨目录测试 | 3/3，通过解释器选择修复后定向重验 |
| npm run package:check / release:pack | 实际 tarball 白名单及临时目录安装通过 |
| git diff --check | 通过 |

统一检查曾暴露旧测试 mock 未接受新 skills 服务查询，以及随包语言资源与实际客户端文案不一致；这两项已修复并重新跑通统一 Node 检查。白名单还加强了所有必需验证器、Python 模块、CSS 和工作流参考的存在性检查。

打包检查只允许运行资源、文档和示例，拒绝环境文件、个人订阅、运行数据库、缓存、输出、测试文件和旧备份。临时安装检查确认 Host 挂载、路由注册、空订阅初始化和三项随包技能，并实际执行文章/分享 helper 的初始化与缺少内容时的验证失败路径，确认不会进入草稿桥。

## 实际安装

通过当前 Harness 插件管理器停用旧 bundle、移除旧安装登记并重新安装当前仓库。移除登记是管理器报告 already-installed 后要求的替换步骤，没有删除旧源码或运行数据。新安装返回：

- bundle：`@local/dsh-rss-brief`
- version：`0.3.0`
- application：`applied`
- warnings：空
- 安装链接：当前 `rsshub` 仓库

实时状态工具读取的新 OPML 来自数据目录的 `subscriptions/folo.opml`。技能工具加载 `create-blog-post-from-url` 时报告资源根为当前仓库的 `skills/create-blog-post-from-url`。（此处保留重命名前的验证记录；当前技能名称为 `create-wechat-content`，目录为 `skills/create-wechat-content`。）

## 数据保留

切换前后以只读 SQLite 连接和 SHA-256 比对，结果一致：

| 对象 | 切换时记录 |
| --- | ---: |
| feeds 总记录 | 129 |
| 启用订阅 | 116 |
| articles 数据库记录 | 2440 |
| reads 记录 | 2332 |
| reports 历史记录 | 1 |
| schema 版本 | 4 |
| 任务关联及 result 文件指纹 | 53 个文件完全一致 |

数据库文章总数包含保留的丢弃记录；当时状态工具展示 2298 篇可见文章，另有 142 篇已丢弃。订阅身份、已读记录、选定模型/抓取配置、历史任务文件和本机环境文件的指纹均在切换时保持一致。普通阅读和原有定时任务随后仍可正常更新活动数据。

个人 OPML 与分类目录复制到数据目录后先逐字节校验，确认新安装使用新路径，再移除仓库内原文件。OPML 解析确认仍为 116 源。旧内容工作区和产物路径没有迁移，旧源码目录保留。

## GUI 验证

使用同一个正在运行的 Harness URL，没有启动新服务。浏览器连接恢复后，在现有浏览器打开该 URL，验证：

- 左侧 RSS 阅读入口和最新列表正常；原先的只看未读等筛选仍存在。
- 阅读设置展示原 60 分钟抓取间隔，未点击保存。
- 管理订阅展示 116 个订阅，未增删或修改。
- 插件详情显示版本 0.3.0、来源为当前仓库链接、组件运行中，原 RSS 图标和中文元信息正确渲染。
- latest、schedule、settings、analysis-settings、subscriptions 和插件详情接口均返回 200。

控制台存在部分外站 favicon 的跨源限制、解码或 404 请求，未发现上述本机 RSS 接口失败；未为迁移调整外站资源逻辑。

没有以验证为由启动真实创作、生图或微信上传。原分支/PR Check 工作流已按用户要求移除；仓库仅保留版本标签触发的 Release 流程，在 Ubuntu、Node 26、Python 3.13 上执行检查、测试和安装包验证。迁移验证阶段没有提交、推送、远端标签、Release 或 npm 发布；后续提交和推送按用户明确指令执行。旧兼容目录已在提交前移除，跨目录测试改为直接验证随包 CLI。
