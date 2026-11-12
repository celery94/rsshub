# RSS 单篇文章：输入、配图与微信草稿

`<skill-dir>` 为本技能安装目录，`<azure-image-gen-dir>` 为已加载生图技能的安装目录；`<workspace>` 为任务输入指定的工作区绝对路径。资源从技能安装位置读取，产物和 `.env` 从工作区读取；命令中的相对产物路径在工作区执行。

本参考用于 `rss-article` 模式：把一篇 RSS 文章或公开链接写成中文长文，配一张封面和至少一张正文图，只保存为公众号 `news` 图文草稿，不提交发布，不调用 `freepublish/submit`。兼容命令 `rss-task.mjs publish` 只存草稿，微信实际返回非空 `media_id` 后，`succeeded` 表示“草稿已保存”。两种模式共同的约定见 `SKILL.md`，这里不再重复。插件的“文章”按钮会按本参考启动 Agent 任务；按钮与调度逻辑在插件源码中维护。

## 执行约定

- 加载顺序：本技能，配图阶段加载 `azure-image-gen`，保存草稿阶段加载 `wechat-draft`，仅复用草稿能力。
- 默认中文、作者 `Aide Hub`、HD-2D 风格、一张宽封面和至少一张正文插图，第二张正文图按内容需要添加。交付止于保存草稿，不提供提交发布能力。
- 生图是主要等待项，按第 3 节的一次成图规则执行，不连续重生成来试探风格。
- 任务状态以本任务 `result.json` 为准；`publications/{article_id}.json` 是按钮侧的交接记录，不由本流程维护或修改。
- 用户明确缩小为只写文章、不配图或不上传时，遵从当次要求，保留产物并说明该任务未达到默认草稿交付标准；不要使用严格 RSS 草稿命令强行上传不完整内容。
- 文章整理、写作、配图、校验、存草稿和相关任务状态分析无需重启或重载插件；技能、参考文档及工作区脚本变更也无需重载。仅实际修改插件实现且需要激活时才重载，并遵从用户当次限制。

## 任务输入

按钮或会话准备一个 UTF-8 JSON 文件，再调用初始化脚本。以下字段构成 v1 协议，未知字段会被拒绝：

| 字段 | 必需 | 含义 |
| --- | --- | --- |
| `version` | 是 | 固定数字 `1` |
| `mode` | 是 | 固定 `rss-article` |
| `task_id` | 是 | 1–80 个 ASCII 字母、数字、下划线或连字符；不能使用 Windows 设备保留名，也不能含路径片段 |
| `source_url` | 是 | 完整 HTTP/HTTPS 原文 URL，不能带用户名或密码；初始化使用 WHATWG `URL.href` 归一化 |
| `article_id` | 否 | RSS 内部文章标识，使用字符串 |
| `title` | 否 | RSS 原始标题，最终标题仍须编辑并符合微信长度要求 |
| `feed_title` | 否 | 订阅源名称 |
| `published_at` | 否 | 原文发布时间，带时区的 ISO 8601 字符串，仅用于背景判断 |
| `cached_content` | 否 | 缓存完整正文字符串；摘要或截断片段不算完整原文 |
| `instructions` | 否 | 调用者本次写作要求，不含凭据 |

最小输入示例也保存在 [rss-article-input.json](../examples/rss-article-input.json)，可供按钮接入时参考；这是示例任务，不代表已经生成或上传文章：

```json
{
  "version": 1,
  "mode": "rss-article",
  "task_id": "rss-example-001",
  "source_url": "https://www.anthropic.com/engineering/building-effective-agents"
}
```

仅传链接的会话请求也可执行：Agent 先按上述规则生成一个新的任务 ID 和输入文件。后续按钮应为同一篇文章的同一次操作复用相同任务 ID，不要在轮询或重试时不断生成新 ID。

初始化会归一化 URL，例如 `https://example.com` 保存为 `https://example.com/`。写 frontmatter 时从已保存的 `input.json` 复制 `source_url`，不得再单独变更尾斜线、参数或片段；保存草稿前要求 `source` 与该值精确一致。

命令示例中的 `node` 和 `python` 代表环境中可用的解释器；DSH 环境可通过依赖工具取得绝对路径，Windows PowerShell 执行带空格的解释器路径时使用 `& '完整路径'`。不要更改全局 PATH，也不要为该流程启动另一个 Web 服务。

## 产物目录

```text
output/rss-articles/{task_id}/
  input.json
  result.json
  source-notes.md
  article.md
  assets/
    cover-brief.json
    01-cover.png
    02-illustration-flow.png
```

图片也可以是 `.jpg`；额外正文图继续使用 `03-illustration-{topic}` 编号。内部锁和临时文件由辅助脚本管理，Agent 不手动覆盖任务输入或结果。所有本地图片和 brief 的实际路径都必须位于本任务目录中，不能通过 `..`、符号链接或 junction 引用其他目录。图片放在 `assets/`，使用字母、数字、点、下划线和连字符组成的英文文件名，链接以 `./assets/` 开头且不含空格、URL 参数或百分号转义。图片链接只使用内联 Markdown，不使用尖括号路径、HTML 图片标签或引用式图片语法，以与现有微信 Markdown 转换器保持一致。

`article.md` 的 frontmatter（字段规则见 `source-and-writing.md` 的「Frontmatter」）：

```yaml
---
pubDatetime: 2026-11-04T14:00:00+08:00
title: "Agent 工作流如何保留可核对的证据"
description: "这里填写经编辑的中文摘要，说明具体问题、文章结论、适用场景与读者可采取的行动；长度为八十到一百二十个字符，不夸大能力，不承诺未经验证的结果，也不使用可以套在任何文章上的开场和宣传语。"
tags: ["AI", "Agent"]
slug: "agent-workflow-evidence"
ogImage: "./assets/01-cover.png"
source: "https://www.anthropic.com/engineering/building-effective-agents"
---
```

不照抄示例中的日期。slug 使用小写 kebab-case；正文保留 `## 参考` 与原文 URL。正文图片示例：

```markdown
![任务依次经过取证、写作和核对的概念示意](./assets/02-illustration-flow.png)
```

## 执行步骤

### 1. 初始化与预检

```text
node <skill-dir>/scripts/rss-task.mjs --workspace <workspace> init <input.json>
node <skill-dir>/scripts/rss-task.mjs --workspace <workspace> preflight
```

初始化保存规范化输入，创建 `running / evidence` 结果。重复初始化不能覆盖产物；同一任务 ID 换了输入会报错。已成功任务直接读取并返回已有草稿结果。未完成的取证、写作、配图或校验任务可按现有产物恢复，不能不加判断地从头重做。

预检不调用远程 API，仅检查有效配置是否存在，输出缺失变量名而不显示值。生图需要 `AZURE_IMAGE_ENDPOINT` + `AZURE_API_KEY`，或兼容的 `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_API_KEY`；微信需要 `WECHAT_APP_ID` + `WECHAT_APP_SECRET`。使用现有技能的环境变量和 `.env` 语义，不把密钥放进输入、提示词、文章、结果或命令行参数。

Python 环境需要生图脚本的 `requests`、`Pillow`，以及微信脚本使用的 `beautifulsoup4`（导入名 `bs4`）和样式模块依赖。DSH 自带的 Python 不一定有这些包；用 `Get-Command python,py` 或 `py -0p` 找到已有解释器，验证 `import requests, PIL, bs4` 通过后，生图、引用检查和 `publish --python` 都用这同一个解释器。草稿桥加载微信模块时也会检测导入失败。缺失时记录失败原因，不在无人值守任务中临时安装依赖。初始化、预检和后续阶段出错时保留任务目录。

### 2. 取证与写作

先读取 `source-and-writing.md` 与 `chinese-style-and-deai.md`，按共用说明的「内容使用与按需核查」先检查任务输入、`cached_content` 和本任务已有证据笔记。完整、来源清楚且足以支持结论的内容直接复用，不重复打开原文。保存或补充作者、日期、章节和 2–4 个可追溯原文锚点到 `source-notes.md`；仅有具体缺口时才调用可用的相关技能定向补查，记录补充来源与结果。补查后仍没有可信完整原文时，使用 `SOURCE_INCOMPLETE` 失败，不根据标题或 RSS 摘要编写文章。

```text
node <skill-dir>/scripts/rss-task.mjs --workspace <workspace> stage <task_id> writing
```

按读者问题组织独立中文文章，区分原作者观点与编辑推论，不编造经历和实测。完成内容编辑、文字编辑和单独去 AI 味改稿。沿用标题最多 32 字、摘要 80–120 字、时区和引用要求。

进入配图前把正文改完。标题链、开头、去 AI 味改稿和禁用句式检查都在本阶段收尾；`stage images` 之后不再修改正文，确需改动时先回退到本阶段重改，再重跑校验。

先用已有材料核对拟采用的事实。会影响结论的价格、版本、接口、产品能力、争议数据等，只有在已有材料无法支持本次所需信息、存在冲突或时效疑点时才补查官方资料；已有适用核查结果直接复用。地名、线路、历史时间线等稳定信息按原文归属，不必逐条再抓官网；正文实际使用的补充来源才写入 `## 参考`。

### 3. 配图

```text
node <skill-dir>/scripts/rss-task.mjs --workspace <workspace> stage <task_id> images
```

读取 `cover-prompt-template.md` 和 `hd-2d-style.md`，加载 `azure-image-gen`。先保存本任务 `assets/cover-brief.json`，再生图；final_prompt 非空。默认封面 `2256x960`，正文图 `1536x864`，`quality medium`、`format png`、`background opaque`，两类终稿都使用 `--skip-post-process` 保留清晰度。草图、检查与定向精修遵从生图技能；明确用户风格覆盖时遵从当次要求。

封面和正文图都按「一次成图」执行：

- 生成前把整幅像素化写进 final_prompt：建筑立面、桥、挡土墙、路面、树木和车辆都由同一像素尺度的色块构成，同时保留三维透视、前中后层次和共同光影。只写 `HD-2D` 或 `pixel art` 会得到光滑的写实渲染。
- 文章依赖的关键空间关系要写成可核对条件，例如底层半埋进坡体、桥从上层道路接入二层，而不是只给建筑名称。
- 可见文字默认只用 1–3 个带底框的中文短标签或数字 chip；禁止横幅、漂浮标题和海报文字。标签要完整落在画面内并留出边距，避免贴边被裁切。数据类标签只能取自证据笔记。
- 首轮只要主题、构图和标签正确就接受，不为更好看的细节反复重生。只对 1–3 个具体问题做一次定向修改；同一张图最多重生成 2 次，仍不合格时按失败规则处理或在报告中说明。

封面命令示例（prompt 必须替换为来源明确的完整提示词）：

```text
python <azure-image-gen-dir>/scripts/azure_generate_image.py "<完整封面 prompt>" --output output/rss-articles/<task_id>/assets/01-cover.png --size 2256x960 --quality medium --format png --background opaque --skip-post-process
```

正文图同样显式指定最终输出路径、16:9 尺寸和 `--skip-post-process`。每张先在证据笔记中记录解释目标、对应段落、来源锚点和 prompt；不以无关装饰图凑数量。默认首张正文图是必需资源，必须与封面不同，并在相关段落附近以中文 alt 引用；第二张为可选，失败时可删除引用并说明。

检查实际图片内容、可读性和风格一致性；支持看图时不能仅凭文件存在通过验收。无法看图时遵从 `azure-image-gen` 的 No-Vision 流程并在报告说明。校验器的文件头检查只能排除明显伪文件，不能代替图像解码和视觉审查。真实截图、技术图和实验图不改绘。

### 4. 审查与校验

```text
node <skill-dir>/scripts/rss-task.mjs --workspace <workspace> stage <task_id> validation
python <skill-dir>/scripts/check-references.py output/rss-articles/<task_id>/article.md
node <skill-dir>/scripts/validate-article.mjs output/rss-articles/<task_id>/article.md --mode rss-article
```

先完成内容审查与去 AI 味审查，检查原文证据、引用、真实图片和生成插图的角色。RSS 校验隐含微信要求：frontmatter、标题、摘要、语言规则、封面 brief、PNG/JPG 文件头及至少一张非封面正文图。所有图片必须是本任务内的本地文件；网页图片下载为 PNG/JPG 后再引用。

校验器实际检查的项目固定为：frontmatter 必需字段、标题不超过 32 字、摘要 80–120 字、标题和摘要不含中文弯引号、slug 与日期格式、`## 参考` 含 `source` 原文 URL、封面为 `./assets/01-cover.png`（或 `.jpg`）、至少一张 `./assets/02-illustration-{topic}.png`（或 `.jpg`）、图片为任务内 PNG/JPG、`cover-brief.json` 必填字段齐全且 `article_title` 与标题一致、禁用句式列表。按这些项目自检即可，不必通读 `validate-article.mjs`；只有报错时再定点读对应检查。

`publish` 会在内部再完整校验一次，因此手动校验只需在正文和参考链接定稿后运行一轮，不要在存草稿前重复跑同一校验。

只有链接检查、内容审查和文章校验均通过后才能保存草稿。格式校验无法证明事实完整或文字质量，不能以脚本退出码代替审查。本工作区没有 Prettier，不安装，也不声称已运行。

### 5. 保存草稿

```text
node <skill-dir>/scripts/rss-task.mjs --workspace <workspace> publish <task_id> --python <python-executable>
```

`publish` 命令名保留兼容，实际只存草稿。辅助脚本再次验证文章，将 source 与输入 source_url 核对后，调用 `publish-rss-draft.py` 复用 `wechat-draft` 的草稿能力。草稿桥从 frontmatter 读取 title、description、ogImage、source，作者为 `Aide Hub`，使用 Markdown、自动样式和 `news`，正文图片上传失败即停止。

不要在 RSS 模式绕过辅助脚本直接调用独立 `publish_draft.py`，否则无法保护任务结果并防止重复建稿。正文/封面/brief 不合格时停止。仅调用 `draft/add` 创建草稿，保存微信实际返回的非空 `media_id`；不调用 `freepublish/submit`，不提交发布。新任务仅在取得该 `media_id` 时标记 `succeeded`，报告“草稿已保存”；不要求 `publish_id` 或 `publish_status=submitted`，`stage` 保持 `wechat_draft`。

### 6. 失败与恢复

内容、配置或必要配图失败时，记录稳定错误码和不含敏感信息的简短原因，例如：

```text
node <skill-dir>/scripts/rss-task.mjs --workspace <workspace> fail <task_id> SOURCE_INCOMPLETE "无法取得完整原文，保留现有证据笔记"
```

- `succeeded`：直接复用已有 `media_id`、文件与历史结果，不再次创建草稿。旧成功结果即使缺少 `publish_id` 或 `publish_status` 也不补发或改写。
- 已有非空 `media_id`：无论当前状态为何，都保留已有草稿结果，禁止自动重建。
- `failed` 且确认尚未创建草稿、结果也非未知：修复具体问题后从相应阶段恢复，保留已完成产物。
- `needs_attention`、结果未知或上次停留在 `running / wechat_draft`：可能已经创建草稿，保留错误及已取得的 `media_id`，禁止自动重建。历史 `needs_attention` 保持原样；旧 `running / wechat_draft` 由 helper 按未知结果转为 `needs_attention`。先核对微信后台及任务结果，再人工处理；不能仅因改为草稿流程就将旧未知状态改成成功。
- 历史 `publish_id`、`publish_status`、其他 `publish*` 字段及旧发布错误只读保留，不迁移、不清空、不补写，不重试历史发布请求。
- 新增草稿被微信明确拒绝可记录 `failed`；创建草稿超时、断连、无法解析响应或进程中断按结果未知处理，记录 `needs_attention`。微信请求错误可能含 token URL，不将原始异常写进结果或回显。
- 同一 `task_id` 的锁用于阻止并发修改与重复建稿；陈旧锁不自动删除，确认没有执行者后才能人工恢复。不要为了重试自动换任务 ID。
- 本地辅助脚本只保护同一 ID。跨任务 ID、跨项目或其他工具创建的重复稿件，需要后续按钮/任务服务统一关联文章与任务；本次不新增该服务。

## 结构化结果

任务阶段固定为 `evidence / writing / images / validation / wechat_draft`；状态固定为 `running / succeeded / failed / needs_attention`。辅助脚本原子保存 UTF-8 `result.json`，供后续按钮读取；终态保留具体阶段，不用 `completed` 替换阶段。

新任务结果字段为：`version`、`mode`、`task_id`、`source_url`、`status`、`stage`、`title`、`article_path`、`cover_path`、`inline_image_paths`、`media_id`、`error`、`created_at`、`updated_at`。产物路径使用相对工作区根目录的正斜线路径；初始化时标题可沿用输入 title，未提供时为 null，保存草稿前更新为最终文章标题。尚未校验的封面为 null、正文图片列表为空数组，未取得的 media_id 为 null。只有微信实际返回非空 `media_id` 后才将新任务标记 `succeeded`，表示“草稿已保存”。新任务不生成发布字段；历史 `publish_id`、`publish_status` 及其他 `publish*` 字段只读保留，不迁移或补写。失败或未知保留已取得的 `media_id` 与历史字段；历史终态结果保持原样，读取时不触发建稿、补发或状态改写。旧 `running / wechat_draft` 仅按前述恢复规则转为 `needs_attention`。`error` 为 null 或 `{ "code": "稳定错误码", "message": "不含敏感信息的原因" }`。

草稿保存成功结果示意（media_id 为示例占位，不能当作真实微信返回）：

```json
{
  "version": 1,
  "mode": "rss-article",
  "task_id": "rss-example-001",
  "source_url": "https://www.anthropic.com/engineering/building-effective-agents",
  "status": "succeeded",
  "stage": "wechat_draft",
  "title": "Agent 工作流如何保留可核对的证据",
  "article_path": "output/rss-articles/rss-example-001/article.md",
  "cover_path": "output/rss-articles/rss-example-001/assets/01-cover.png",
  "inline_image_paths": [
    "output/rss-articles/rss-example-001/assets/02-illustration-flow.png"
  ],
  "media_id": "<微信实际返回的非空 media_id>",
  "error": null,
  "created_at": "2026-11-04T06:00:00.000Z",
  "updated_at": "2026-11-04T06:15:00.000Z"
}
```

最终回复包含任务 ID、状态、文章/封面/正文图/结果路径，以及微信实际返回的 `media_id`。新任务成功报告“草稿已保存”，不宣称已提交发布或发布完成。旧结果中的发布字段仅按历史信息说明，缺少时不补写，原状态不迁移。失败或未知时说明具体阶段和已保留资源与 `media_id`。
