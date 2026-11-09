# RSS 最新文章（DSH 插件）

按 OPML 定时抓取 RSS，使用 SQLite 去重，提取近期文章正文，并在侧栏展示最新文章。支持分类、主题标签、搜索、未读筛选、分页、正文阅读和单篇文章创作。

定时与手动抓取完成后，默认自动分析近期文章的阅读价值，支持独立选择分析模型；不生成日报或写入日报 Markdown，不注册 `rss_brief_report` 工具和 `/report` 路由。已有文章、摘要、已读状态和历史日报记录全部保留。

- 包名：`@local/dsh-rss-brief`，版本 `0.3.0`，保留插件身份和现有数据目录。
- 本仓库完整提供 Host、Client、技能、辅助脚本与版本包检查；安装不再依赖另一份源码目录或工作区技能副本。
- 数据目录：`%USERPROFILE%\.dsh\rss-brief`；订阅、内容工作区与插件源码分别定位。
- 订阅源来自 `opmlPath` 指向的 OPML；移除的源会停用，历史数据保留。

## 快速开始

运行要求：DSH `>=0.2.2-rc.1 <0.3.0`，Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`（受当前 jsdom 依赖约束；本机验证版本为 Node 26.13.0）。创作功能另外需要 Python 3.10+ 与 `requirements.txt` 中的依赖；仅 RSS 阅读不需要 Python。

本地开发：

```powershell
npm ci --ignore-scripts
npm run check
npm test
npm run test:python
npm run package:check
```

Python 依赖由用户显式安装到选定环境，例如 `python -m pip install -r requirements.txt`。插件不自动安装依赖。通过 Harness 插件管理器安装本仓库绝对目录，使用本地链接开发；Client 为可直接加载的 JavaScript，无额外前端编译步骤。

正式交付使用 `npm run release:pack` 生成并验证 `artifacts/local-dsh-rss-brief-0.3.0.tgz` 和 SHA-256 校验文件。插件管理器可安装本地包目录或版本包路径。发布流程与回退见 [发布说明](docs/releasing.md)，目录与数据迁移见 [迁移说明](docs/migration.md)。

默认安装会创建数据目录下的 `subscriptions.opml` 和 `workspace/`，随后可在阅读页管理订阅；若旧数据库已有启用源且默认 OPML 缺失，会先从数据库导出这些源，避免初始化为空订阅。非秘密本机配置保存到 `<dataDir>/config.json`，示例见 [配置样例](examples/config.json)。配置优先级为默认值 < 本机配置 < 显式 Cordis 行配置；文件内不能重定向 `dataDir`。配置文件的修改在下一次插件加载时生效。

`articleWorkspace` 中的环境配置供创作脚本读取，绝不随包分发。产物写入该工作区的 `output/`。插件随包注册 `create-blog-post-from-url`、`azure-image-gen` 和 `wechat-draft` 三个技能；脚本、模板和样式均从安装包定位。

## 订阅管理与 OPML 导入

入口为 RSS 阅读页的「设置 → 管理订阅」。可搜索全部来源，表单逐条保存；移除前需要确认。订阅管理读取 OPML 的全部订阅，包括没有文章的源。可手动新增、修改标题／RSS URL／网站 URL／分类和删除订阅；输入分类名即可新建分类或把源移到已有分类。删除仅在 feeds 表停用源，历史文章、评分、正文和已读标记保留；修改 RSS URL 会启用新身份并停用旧身份。最后一个源可以删除，空 OPML 在启动与同步时合法。

「导入 OPML」支持选择最大 1 MiB 的 `.opml` 或 `.xml` 文件。先显示新增、已存在、文件内重复和无效条目的数量，以及有效来源的名称、地址和分类；确认后仅合并新增来源，按规范化 RSS URL 去重，已有来源的名称、分类和相对顺序不变。新来源使用最近的命名父分组，无分组时归入“未分组”。无效条目跳过并计数，XML 结构错误则拒绝整份文件。全重复或没有有效新来源时不写入、不备份。预览只读；确认导入复用订阅保存的备份、分类目录更新及数据库事务，保留历史文章和阅读记录，不自动抓取。订阅版本变化后必须重新预览。

`POST /plugin/rss-brief/subscriptions` 的 `{action:'previewImport',opml}` 返回 `{ok:true,revision,import:{total,added,existing,duplicates,invalid,feeds:[{title,xmlUrl,htmlUrl,group,status:'add'|'existing'}]}}`；确认使用 `{action:'import',opml,revision}`，提交相同 XML 与预览版本，成功返回完整订阅快照、导入统计和 `changed`。原始 XML 限 1 MiB UTF-8，导入 JSON 请求体最多 8 MiB，以容纳转义；Agent 工具的两个同名 action 使用同一逻辑。

`GET /plugin/rss-brief/subscriptions` 返回 `{ok:true,revision,feeds:[{title,xmlUrl,htmlUrl,group}],categories:[string]}`。`POST` 提交 `{action:'add'|'update'|'delete',revision,originalUrl?,feed?}`；add 需要完整 feed，update 需要 originalUrl 和完整 feed，delete 需要 originalUrl。标题和分类须非空、单行，分别最多 300／120 字符；xmlUrl 必须是唯一的绝对 HTTP(S) URL，htmlUrl 可为空；URL 不接受凭据。两个入口均要求已认证 owner，POST 必须为 JSON；单条增改删请求体上限 8192 字节。成功返回完整新快照与可选 changed；版本冲突返回 409，重复 URL 或非法字段返回 400，非 JSON 类型返回 415。

revision 是 OPML 内容的 SHA-256，修改前须使用最新列表返回的版本；冲突后先刷新再重试。保存使用严格 XML 解析，拒绝格式错误的文件；保留其他 outline、已有分类及未修改源的相对顺序。每次实际改动前将原 OPML 保存为同目录下唯一的 `.bak` 文件，并重新生成同目录的 `订阅分类目录.md`（分类、数量、站点和 RSS 链接，保留已有「说明」段落）。写入失败尽力恢复两个文件；备份保留用于人工恢复。保存立即同步本进程的 feeds 表，不启动抓取或模型调用；列表只读，不生成目录或备份。空分类保留，便于再次添加订阅。

## 定时抓取

```text
OPML → feeds 表
  └─ 默认每 1 小时（可配置）：并发抓取启用的源 → 新条目 INSERT OR IGNORE
       └─ 提取近期文章正文（默认每轮最多 40 篇）
            └─ 有界 AI 阅读价值评估 → SQLite → 最新文章列表 / 高质量筛选 / 正文阅读
```

启动 5 秒后检查抓取是否到期，此后每分钟检查；以 `meta.lastFetchAt` 判断下一次抓取。同一时刻只运行一个 sync 任务。Host 关闭期间不运行，下次启动时抓取到期即补跑一次，不按日期回溯。旧配置中的 `reportAt`、`maxReportArticles` 和 `minRelevance` 不再使用。

抓取间隔默认 60 分钟，可通过设置中的抓取间隔保存为 5–10080 分钟的整数。保存值写入 SQLite `meta.fetchIntervalMinutes`，优先于 bundle 的 `fetchIntervalMinutes`，插件重载后保留；未保存时使用 bundle 配置。修改后立即重新判断是否到期：缩短到已经到期会及时启动一轮，延长则按新间隔等待；不会打断或叠加已有 sync。下次抓取时间、状态工具与实际调度使用同一个有效间隔。抓取间隔接口独立于模型设置，不查询模型清单。

定时与手动同步在正文提取后执行有界 AI 评估，默认开启、每轮最多 40 篇、每批 4 篇。优先本轮新文章，再处理最近 `contentWindowDays`（默认 3 天）启用源中的待评文章；无文本不调用模型。文章内容作为不可信数据，严格校验五维得分与总分。单次模型调用 90 秒超时，无效输出最多重试一次；凭据、额度、模型不可用时停止后续批次，抓取内容继续可用。失败按 5 分钟起步指数退避，最长 24 小时；成功结果按内容指纹与规则版本缓存。正文改变使旧评分过期，下一轮重评，失败不清空旧评分。更改模型不触发历史全量重评。

抓取对超时、连接重置、响应流/压缩体中断、HTTP 408/429/500/502/503/504 最多重试一次；每次尝试受 `requestTimeoutMs` 限制，默认间隔 750ms，遵守不超过 5 秒的 `Retry-After`，更长等待留给下一轮。403/404 不重试。Cloudflare 验证页、RSSHub 限流、重定向和内容格式错误会写入状态；200 HTML 不当作空 RSS，不把截断 XML 当作成功结果或保存其 ETag。

## 广告与软文丢弃

分析先判断 `contentType`：`editorial`（正常文章）、`advertisement`（广告）或 `advertorial`（软文）。广告和软文直接丢弃，不再评分或推荐。模型必须给出具体丢弃理由；缺少类型、非法类型、空理由均视为分析失败，不能据此丢弃。

明确促销、优惠券、导购、购买或报名转化、带货稿，以及以品牌／产品推广为主要目的的伪装报道和无独立论证的宣传稿，会被丢弃。正常产品新闻、包含缺点和方法的独立评测、技术案例不因提到品牌或有普通站点广告而被丢弃；信息不足时保留正常评估／暂评流程。

丢弃是持久化排除：列表、搜索、分类和未读计数、高质量筛选、批量已读、正文与文章创作入口均不可见。内部保留文章去重标识、判定类型、理由、时间及模型，后续重复抓取不复活、不重复提取正文或分析。旧版评分不据文字理由猜测丢弃；近期文章会随分析规则版本更新逐批重新判断。

## 最新文章与阅读

- 固定使用紧凑单行列表，不再提供密度切换。宽屏按左侧标签导航、中间文章列表、右侧正文排布，列表与正文独立滚动；两条分隔线支持拖动或方向键调整宽度，双击恢复对应默认值。导航宽度与列表占剩余空间的比例保存到当前浏览器，刷新和重新打开后恢复，窄屏不改写保存值。选中文章高亮，自动已读后保留当前行。阅读中可刷新和加载更多，切换筛选关闭当前正文。窄屏打开正文时集中显示阅读栏，关闭后恢复列表位置。
- 直接读取已抓取、已发布且源仍启用的文章，包含今天；打开列表不会调用模型或抓取正文。
- 按发布时间倒序，同一时间按文章 ID 倒序；支持 OPML 分类及分类下的订阅源筛选，可组合标题/来源/摘要搜索、只看未读和高质量条件。
- 筛选先于 SQL 分页，分类与订阅源计数覆盖当前搜索、未读、质量和快照条件下的全部文章，不受选中分类或源限制；启用但无匹配文章的源在接口中仍返回 0，左侧导航隐藏计数为 0 的来源和分类；搜索、未读或质量筛选变化后按新计数重新显示。未读数量遵循选中分类和源。默认每页 100 篇，最多 200 篇；首批 ID 快照避免新入库文章挤动分页，刷新重新获取快照。
- 「全部标为已读」处理当前分类、订阅源、搜索、未读、质量条件与快照内的全部匹配文章，包括尚未加载的分页；保留已有已读时间戳，事务内完成。
- 文章支持已读/未读、原文链接、上一篇/下一篇；只看未读时阅读队列保留当前位置。
- 正文缓存优先，缺失时按需提取；失败保留已有内容，可重新提取。HEAD 和 `cacheOnly=1` 不触发外站请求。
- 保留 RSS `content:encoded`、Atom `content` 和 description 原始内容；显式全文可直接阅读，订阅摘要按需补全网页。原始订阅内容上限 512 Ki 字符，达到上限显示截断标识。
- Readability/jsdom 提取网页后转换为允许的 JSON 节点，支持图片、链接、列表、引用、代码、表格；不执行脚本、事件或外站样式。相对资源按最终原文 URL 解析。
- 纯文本上限 6 万字；结构化文档上限 1 MiB、1 万节点、32 层。自动失败重试间隔至少 10 分钟，手动刷新立即重试；同篇提取合并，并发最多 3 篇。
- 阅读成功后自动已读，可手动改回未读；`Esc` 返回，`[` / `]` 切换文章。打开文章时记录列表的滚动像素及前三个可见文章的偏移；返回按钮和 Esc 均在布局完成后恢复原位置，已加载分页保留。只看未读时，若顶部文章已被移除则使用相邻文章定位。阅读期间暂停列表后台刷新，返回后恢复；搜索、分类及筛选变化重置列表位置。位置保存在当前页面实例中，整页刷新不恢复。

## 阅读价值与独立分析模型

设置中的“文章分析模型”独立于“文章创作模型”。可以沿用创作模型，或指定服务商与模型；`meta.analysisProvider` / `meta.analysisModel` 持久化，专用 bundle 配置 `analysisProvider` / `analysisModel` 优先。显式指定的分析服务商或模型不可用时明确报错，不切换到其他模型。每轮固定模型快照，保存设置从下一轮生效，不直接调用模型。自动分析开关和每轮篇数（1–200）可独立保存；即使模型配置固定，两项仍可修改。

评分与主题相关度分开：信息增量 25 分、证据 25 分、深度完整性 20 分、实用价值 20 分、表达密度 10 分。后端校验各项并求和，80+ 推荐精读、60–79 值得浏览、低于 60 可跳过，提供中文理由及估算阅读时间。这是基于文章内容的 AI 评估，不代表外部事实核查。

优先使用正文或 RSS 全文；摘要、截断内容标为暂评。超过 12,000 字符时取开头、中段和结尾的样本，标为取样暂评。只有完整、当前有效的评分达到 `highQualityThreshold`（默认 60，可调至 100）才标为高质量；暂评、未评和过期结果不会进入“只看高质量”。列表、紧凑模式与阅读页展示一致，阅读页可展开五维明细。无内容保持待正文，不编造分数。

## 文章分类标签

文章在同一次 AI 分析中选择固定的“主题 + 内容类型”，便于把相近内容长期归在一起。每篇必须有 1–2 个主题和且仅有 1 个内容类型，主主题排第一、内容类型排最后；单一主题不强补第二个主题。模型只能使用固定名称，不自行生成技术细节、产品名或文章关键词，也不再复用历史自由标签作为提示词词表。

主题共 14 个：AI与模型、AI编程、Agent应用、软件开发、数据与数据库、系统与基础设施、安全与隐私、硬件与半导体、产品与设计、商业与产业、科学与数学、游戏与文化、社会与时事、生活与随笔。按文章主要讨论对象选择；只有对另一个主题也有实质讨论才跨两个主题，避免同一技术文章例行贴多个相近分类。

内容类型共 8 个：新闻动态、教程指南、技术解析、实践案例、研究报告、观点评论、资源推荐、内容合集。按写作目的选择，独立于质量评分。例如 C# 事件原理归“软件开发 + 技术解析”，MongoDB 配置步骤归“数据与数据库 + 教程指南”，企业使用 Agent 的项目复盘可归“Agent应用 + 商业与产业 + 实践案例”。摘要或取样内容仍保留暂评说明，不从片段补造教程步骤或研究证据。

阅读页区分主题与内容类型；较宽的紧凑列表优先显示主主题和内容类型，余量以 `+N` 和悬浮文字提示。中间列表较窄时收起行内标签、来源名称与摘要，为标题留出空间，完整信息可在右侧阅读栏查看。主题和内容类型各有一个选择器，可以分别清除并组合筛选，与搜索、订阅分类、来源、未读和高质量条件取交集。点击内容类型标签切换类型筛选，点击主题或历史标签切换主题筛选。顶部两个目录保留固定名称及零计数项；左侧主导航按“主题／内容类型／历史标签”分组展示现有标签，隐藏无匹配且未选中的零计数项，选中项变为零时仍保留。主题、内容类型和历史标签分组默认展开，点击分组标题或聚焦后按 Enter／空格可独立折叠与展开，折叠保留当前筛选。旧订阅分类和站点树收进默认折叠的“订阅来源”。左侧“全部文章”清除主题、内容类型、订阅分类及来源选择，保留搜索、未读和质量条件；各标签行与顶部筛选同步。分页、未读数和“全部标为已读”遵循相同交集。此版本暂不提供手工编辑分类词表。

标签保存在新增的 `article_tags` 表，分析成功后与评分在同一事务中保存，失败保留已有结果。增量升级保留旧文章、评分和已读状态，不改变评分有效性；缺标签文章返回空数组。标签使用独立规则版本 `tagging_version`，当前为 3；规则升级不使旧评分过期。同步时逐批补分析最近 `contentWindowDays`（默认 3 天）内缺标签或标签规则版本过旧的文章，继续遵守每轮篇数和失败退避，新文章优先；更早的历史文章不自动全量补标。重新分析成功后原子替换标签，失败保留旧标签及规则版本；旧标签在更新前继续可见和可筛选。数据库升级和打开阅读列表均不调用模型。

## 模型设置与文章创作

头部齿轮打开阅读设置，通过「自动抓取／阅读分析／文章创作」分区导航调整偏好，管理订阅入口独立保留。各分区分别保存，切换分区保留未保存输入，并以圆点和底部状态提示；关闭弹窗或进入订阅管理前可选择继续编辑或放弃更改。弹窗限制键盘焦点在内部，关闭后恢复入口焦点；窄屏改用顶部换行导航。抓取间隔支持 30 分钟、1 小时、6 小时和每天的快捷选择。文章创作可跟随 Harness 默认模型，或指定已注册 provider 的模型。选择保存在 SQLite `meta.aiProvider` / `meta.aiModel`；优先级为 bundle 固定的 `provider`/`model` > 面板保存 > Harness 默认。保存前校验实时清单；已保存 provider 下线时回退默认模型。模型设置本身不会启动模型调用。

文章阅读页「创作并保存微信草稿」启动独立、可在 Harness 查看的 Agent 会话：读取完整原文、编辑中文文章、生成 HD-2D 封面和至少一张正文图、校验并保存微信公众号图文草稿。按钮点击仅授权本次草稿创建，不提交发布；实际非空 `media_id` 与任务 `status=succeeded` 表示草稿已保存，不要求或新增发布字段。

- 写作使用 RSS 模型设置的当前模型；创建会话后通过 `agent.model.select()` 保存任务的模型快照，再提交任务提示词，不改 Harness 全局默认。恢复时通过 `sessionController.events()` 读取完成事件，不依赖旧版控制器内部接口。
- 工作目录为 `articleWorkspace`，默认 `<dataDir>/workspace`；显式指定 OPML 且未指定工作区时沿用 OPML 所在目录。三个技能及辅助脚本由插件安装包提供，工作区无需复制技能。历史任务按记录中的原工作目录恢复。
- 生图和微信凭据沿用技能读取的本地环境变量或 `.env`，不传给浏览器。缺配置、技能或模型时返回具体错误。
- 同一数据库的同一篇文章使用固定任务 ID；并发点击和刷新复用任务，成功后复用草稿；提交结果未知时保留待核对状态，停止自动重试。
- 自动评分、文章创作和分享海报共用一条队列，同一时间只运行一个，按点击顺序执行。创作任务从启动起占用队列，直到对应 Agent 会话结束；队列空闲时直接启动，忙时返回 `status: "queued"` 和 `queuePosition`，阅读页显示排队位置并继续轮询。抓取期间的评分在调用模型前排队，等待时阶段显示为 `queued`。队列只在内存中，插件重载后未启动的排队任务需要重新点击；已有草稿、待核对和运行中的任务不会进入队列。
- 产物保存在工作区 `output/rss-articles/{task_id}/`，数据目录 `publications/` 保存任务关联，默认不提交或推送 Git。
- 关闭阅读页停止界面轮询，后台 Agent 继续执行；热重载后恢复持久化关联，不重复启动运行中任务。
- 文章、海报内容整理和草稿保存不重启或重载插件；技能、参考文档和工作区辅助脚本修改也无需重载。仅插件实现需要激活时由主流程处理，并遵从当前用户限制。
- 新旧 `succeeded` 草稿结果均仅需实际非空 `media_id`。历史发布字段只读展示，历史 `needs_attention`、发布拒绝或结果未知的记录保留，不改写任务结果。

## HD-2D 分享图（1–3 张）

阅读页分享海报按钮创建独立的 `rss-share` 后台 Agent 任务：核对当前完整正文，按随包分享技能生成 1–3 张高清分享图和 100–200 字中文文案（另附来源），保存为微信公众号图片消息草稿 `newspic`。一张能讲清就只做一张，第一张作为封面。使用现有“文章创作模型”，与自动评分模型分开；Azure 生图沿用现有本机配置。

- 仅完整正文就绪时允许启动；摘要、截断、提取中、正文错误或已丢弃文章不会启动生图。GET 查询不生成，不上传。
- 画面解释对象、动作、关系与后果，文字就近补充事实、预测条件和局限，不强制预设版式、数字卡片、插画横条或特定渲染脚本。尺寸、构图和清单协议遵循随包分享参考，Azure 按 poster-brief 每张一次直接生成含文字的完整海报，使用 `--skip-post-process` 保持分辨率，不另出无文字底图或本地排版。
- 一次策划全部图片，一轮集中生成，一次集中验收；优先复用素材本地展开，不逐张审图追加付费重绘。事实与文件检查仍须执行，不合格时停止上传。
- 新任务使用 `images` 清单；`poster_layout: editorial` 只保留为历史兼容字段，不强制 `editorial` 对象。旧 `content`／无版式输入和成功草稿保持兼容，不因升级重复提交。
- 原图保留在任务目录，`assets/` 只放清单内的 1–3 张最终 PNG/JPG；上传前按分享技能校验标题／文案、来源、路径、真实图片格式、分辨率及图片数。服务端与客户端接受 1–3 张结果，第一张为封面。
- 分享任务使用独立任务 ID、数据目录 `shares/` 和工作区 `output/rss-shares/{task_id}/`，与原有长篇图文任务互不覆盖。同类任务重复点击、刷新和重载复用；结果未知时暂停自动重试。
- 点击仅授权本次图片消息草稿创建，不提交发布；实际非空 `media_id` 与任务 `status=succeeded` 表示草稿已保存。历史 `publishId` / `publishStatus` 继续只读展示，`needs_attention` 保持待核对，不因已有草稿改成成功，不修改、迁移或补发历史结果。
- 技能参考 `references/rss-share-workflow.md` 及辅助脚本随插件包提供。详细执行协议、图像排版和草稿校验见随包 `create-blog-post-from-url` 分享参考。不自动提交或推送 Git。

## 接口与代理工具

| 接口 | 用途 |
|---|---|
| `GET /plugin/rss-brief/latest` | 最新文章，支持 `q`、`category=opml:分类名`、`feed=源ID`、`tag=主题或旧标签`、`format=内容类型`、`unread=1`、`quality=high`、`limit`、`offset`、`snapshot` |
| `GET /plugin/rss-brief/state` | 兼容入口，与 latest 相同；旧 `date` 参数不选择历史日报 |
| `GET /plugin/rss-brief/article?id=N` | 正文；`cacheOnly=1` 仅缓存，`refresh=1` 强制刷新 |
| `POST /plugin/rss-brief/read` | `{id,read}` 切换已读 |
| `POST /plugin/rss-brief/read-all` | `{view:"latest",q,category,feed?,tag?,format?,unread,quality,snapshot}` 批量已读；category 无筛选时为 null，feed、tag 和 format 无筛选时省略 |
| `GET /plugin/rss-brief/subscriptions` | 全部 OPML 订阅、分类和 revision（owner，只读） |
| `POST /plugin/rss-brief/subscriptions` | 手动订阅增改删，或 `{action:'previewImport'|'import',opml,revision?}` 预览和合并 OPML（owner，JSON） |
| `POST /plugin/rss-brief/sync` | 立即抓取 |
| `GET /plugin/rss-brief/schedule` | 抓取间隔与上次/下次抓取时间；不查询模型清单 |
| `POST /plugin/rss-brief/schedule` | `{fetchIntervalMinutes:60}` 保存抓取间隔，只接受 5–10080 分钟整数 |
| `GET /plugin/rss-brief/settings` | 当前模型及 provider/model 清单 |
| `POST /plugin/rss-brief/settings` | `{provider,model}` 保存，两者为空则恢复默认 |
| `GET /plugin/rss-brief/analysis-settings` | 分析开关、每轮上限、独立分析模型及模型清单（owner） |
| `POST /plugin/rss-brief/analysis-settings` | `{provider,model,enabled,perSync}`；模型对留空沿用创作模型，1–200 篇，严格 JSON（owner） |
| `GET /plugin/rss-brief/publication?id=N` | 查询创作任务，不启动模型或抓取 |
| `POST /plugin/rss-brief/publication` | `{id:N}` 启动或复用创作任务 |
| `GET /plugin/rss-brief/share?id=N` | 查询独立分享海报任务，不生成或上传（owner） |
| `POST /plugin/rss-brief/share` | `{id:N}` 启动或复用 1–3 张 HD-2D 分享图／newspic 草稿任务（owner） |

latest 和 state 保留 `report.groups`、`report.stats` 等现有列表载荷兼容字段；这是最新文章容器，`view` 固定为 `latest`，`date:null`、`dates:[]`，不会读取历史日报。调度仅返回上次/下次抓取时间和时区，不返回日报调度或历史日报列表。正文响应保留 `contentText`、`contentDocument`、来源、提取时间、刷新错误与截断状态。

latest 和 state 的 `latest.sources` 返回全部启用订阅源，格式为 `[{id,title,category,count}]`；`category` 与 `latest.categories[].key` 一致（`opml:分类名`），无匹配文章的源返回 `count:0`，停用源不返回。计数使用与分类一致的搜索、未读、质量和快照条件，忽略当前分类／源选择。`feed` 与分类及其他条件取交集，先于分页和批量已读 SQL 执行；未知或停用源匹配为空。查询参数必须是单个正安全整数；重复、空值、零、负数、小数及不安全整数返回 400。批量已读的 `feed` 可省略，提供时必须为 JSON 正安全整数，拒绝 null、字符串、布尔值和其他类型。

列表条目与正文响应提供 `tags:string[]`、`topics:string[]` 和 `format:string|null`；旧自由标签仍在 tags 中可见、可筛选，未识别为新词表名称的标签不自动推断分类。`latest.tags` 保留 `[{name,count}]` 格式，忽略当前 tag，遵循 format 及当前分类、来源、搜索、未读、质量、快照条件。新增 `latest.tagGroups:{topics:[{name,count}],formats:[{name,count}]}`，分别按固定词表顺序返回全部主题与类型（含 count:0）；topics 忽略 tag、遵循 format，formats 忽略 format、遵循 tag，其余条件均保留。分类和来源计数遵循 tag 与 format 两者。`latest.navigation.total` 为左侧“全部文章”的去重文章数，忽略 category、feed、tag、format，保留搜索、未读、质量和快照条件；主题可能重叠且历史文章可能没有新分类，不能通过相加主题数量得到该值。

`tag` 仍允许旧标签，规范化后按大小写不敏感精确匹配；未知标签返回空列表，重复、空白、控制字符及超长查询返回 400。`format` 必须是单个固定内容类型名称，非法或重复值返回 400；省略时不限制类型。批量已读同样接受可选 tag、format 字符串并取交集，拒绝 null、数组、布尔值、数字及非法类型名称；非法请求不写入或扩大范围。

`/schedule` 的 GET 与 POST 成功均返回 `{ok:true,fetchIntervalMinutes,defaultFetchIntervalMinutes,timeZone,nextSyncAt,lastFetchAt}`：`fetchIntervalMinutes` 为有效间隔，`defaultFetchIntervalMinutes` 为本次激活的 bundle 配置值；从未抓取时 `lastFetchAt:null`、`nextSyncAt:"尽快"`。POST 请求必须是只含 `fetchIntervalMinutes` 数字字段的 JSON 对象；非法 JSON、字符串、非整数、越界和额外字段返回 400 且不写入，非 JSON Content-Type 返回 415。模型 `/settings` 接口保持原行为。

路由绑定本机 Web 服务，响应 `no-store`。抓取间隔读写、批量已读及文章创作要求已认证 owner 身份；写入接受 JSON，批量已读必须携带有效快照，不允许缺少范围的全库默认操作，也不再接受 daily 范围。

| 工具 | 用途 |
|---|---|
| `rss_brief_status` | 源/文章计数、上次/下次抓取、AI 路由和失败源 |
| `rss_brief_sync` | 立即抓取；`wait:true` 最多等 90 秒，`limit` 仅供测试 |
| `rss_brief_subscriptions` | `action:list/add/update/delete/previewImport/import`；与订阅接口共用操作，确认导入使用预览 revision，修改保留历史且不抓取 |

## 配置与安装

bundle patch 仅声明插件身份，使用 `config: {}`。个性化配置写在数据目录的 `config.json`；例如：

```json
{
  "fetchIntervalMinutes": 60,
  "timeZone": "Asia/Shanghai"
}
```

可额外指定 `opmlPath` 和 `articleWorkspace` 的本机绝对路径。保持个人 OPML 和同目录的分类目录在包外；不要将真实路径或密钥写回发布 patch。

| 键 | 默认 | 说明 |
|---|---|---|
| `opmlPath` | `<dataDir>/subscriptions.opml` | 外部 OPML 路径，默认文件缺失时初始化 |
| `dataDir` | `%USERPROFILE%\.dsh\rss-brief` | SQLite、正文与文章创作任务关联 |
| `articleWorkspace` | `<dataDir>/workspace`；显式 OPML 时为其父目录 | 配置与生成产物的工作区，技能从包内读取 |
| `timeZone` | `Asia/Shanghai` | 文章本地日期与状态时间 |
| `fetchIntervalMinutes` | `60` | 默认抓取间隔，5–10080 分钟；SQLite 中的设置保存值优先 |
| `syncConcurrency` | `6` | 抓取并发，1–16 |
| `requestTimeoutMs` | `20000` | 单请求超时，毫秒 |
| `itemsPerFeed` | `20` | 每源每轮最新条目上限 |
| `contentWindowDays` | `3` | 自动正文提取窗口 |
| `contentPerSync` | `40` | 每轮正文提取上限 |
| `provider` / `model` | 空 | 成对配置锁定模型，否则使用面板或默认模型 |
| `aiBatchSize` / `aiMaxTokens` / `focus` | `4` / `4000` / 技术行业筛选口径 | 阅读评估批次、输出额度和读者兴趣 |
| `analysisEnabled` / `analysisPerSync` | `true` / `40` | 自动分析开关与每轮上限；面板保存值优先 |
| `analysisProvider` / `analysisModel` | 空 | 独立分析模型，成对配置并优先于面板保存值；未指定则沿用创作模型 |
| `highQualityThreshold` | `60` | 高质量门槛，60–100，仅完整且未过期的结果有效 |

配置在插件激活时读取。通过插件管理器安装 bundle；本地目录安装用于开发，版本 `.tgz` 安装用于交付。更改安装来源或替换包后按插件管理器的 `application`/`nextStep` 处理，不能把保存配置当作已经激活。Host 修改需要重载插件，Client 修改需要刷新页面。SQLite 和历史日报位于独立目录，不随 bundle 移除。

## 数据与限制

SQLite 文件为 `%USERPROFILE%\.dsh\rss-brief\rss-brief.sqlite`（WAL）。保留 `feeds`、`articles`、`reads`、`reports`、`meta` 现有表和迁移；不会清理历史文章、AI 摘要、日报、已读状态或 `lastReportDate`。历史 `reports/YYYY-MM-DD.md` 文件保留，但不再读取或更新为活动日报。

最新文章只显示启用源。OPML 为唯一源清单，手动订阅管理将修改持久化到 OPML 及分类目录。不回溯超过每源最新条目上限；不做付费墙、登录抓取或跨源 canonical URL 去重。正文提取可能受 JavaScript 页面、CDN 验证或站方限制影响；图片直接从原站加载。已读状态保存在本机，不跨设备同步。

保留现有宝玉、少数派 Matrix、Readhub、BBC 中文 Telegram 原站适配，沿用 OPML 中的订阅身份、分类和历史；原站接口结构变化会显示真实错误。历史修复所移除的源仅停用，文章和已读数据仍在库中。

## 后端检查

以下检查使用临时目录、本地 HTTP 源或内存 SQLite，不修改共享数据、不调用真实模型：

```text
node --check index.js
node scripts/assessment-check.mjs
node scripts/tags-check.mjs
node scripts/tag-policy-check.mjs
node scripts/classification-check.mjs
node scripts/classification-client-check.mjs
node scripts/sidebar-navigation-check.mjs
node scripts/sidebar-navigation-client-check.mjs
node scripts/tag-version-check.mjs
node scripts/tags-routes-check.mjs
node scripts/tags-client-check.mjs
node scripts/discard-check.mjs
node scripts/analysis-host-check.mjs
node scripts/assessment-client-check.mjs
node scripts/host-smoke.mjs
node scripts/schedule-check.mjs
node scripts/subscriptions-check.mjs
node scripts/subscriptions-client-check.mjs
node scripts/latest-check.mjs
node scripts/source-navigation-check.mjs
node scripts/bulk-read-check.mjs
node scripts/article-routes-check.mjs
node scripts/publication-routes-check.mjs
node scripts/publication-check.mjs
node scripts/share-check.mjs
node scripts/share-client-check.mjs
node scripts/article-content-check.mjs
node scripts/content-storage-check.mjs
node scripts/feed-http-check.mjs
node scripts/sources-check.mjs
```

schedule 检查使用临时 SQLite 和模拟 fetch，验证默认 60 分钟、保存与重载优先级、非法请求不写、owner 鉴权、缩短后立即到期抓取、延长与分钟边界调度；不访问网络和模型清单。subscriptions 检查全程离线，使用唯一临时目录、临时 SQLite 和 fake ctx 分发 API／工具，验证 CRUD、XML 转义及顺序保留、分类变更、输入校验、认证、revision 冲突、备份与目录、写失败恢复、空订阅启动与同步，以及文章／已读历史保留；不绑定监听器。Host smoke 验证注册 status/sync/subscriptions 工具、没有 report route、定时器只 sync、关闭分析时无模型调用或日报文件、正文提取与已读回读、模型设置。latest 检查验证分页/快照/筛选、HTTP 参数、兼容 payload、state 别名及历史日报数据原样保留；source-navigation 检查验证所有启用源及零计数、同分类多源分页、搜索／未读／质量／快照计数、跨全部分页的批量范围和严格源 ID 校验；latest 与 bulk-read 检查同时覆盖真实 HTTP 路由的源筛选与非法参数。bulk-read 检查验证认证、事务、范围与拒绝已移除的 daily 请求。历史日报纯函数仍保留为兼容代码，但没有活动生成入口。
