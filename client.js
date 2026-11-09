window.__ModuleLoader__.load({
  id: "@local/dsh-rss-brief",
  factory(require) {
    const React = require("react");
    const h = React.createElement;

    /** Locale namespace, sidebar id, and main-panel key this bundle owns. */
    const NS = "dsh-rss-brief";
    const PANEL_ID = "rss-brief";
    const LATEST_ENDPOINT = "plugin/rss-brief/latest";
    const ARTICLE_ENDPOINT = "plugin/rss-brief/article";
    const IMAGE_ENDPOINT = "plugin/rss-brief/image";
    const READ_ENDPOINT = "plugin/rss-brief/read";
    const READ_ALL_ENDPOINT = "plugin/rss-brief/read-all";
    const SYNC_ENDPOINT = "plugin/rss-brief/sync";
    const SETTINGS_ENDPOINT = "plugin/rss-brief/settings";
    const SUBSCRIPTIONS_ENDPOINT = "plugin/rss-brief/subscriptions";
    const SCHEDULE_ENDPOINT = "plugin/rss-brief/schedule";
    const ANALYSIS_SETTINGS_ENDPOINT = "plugin/rss-brief/analysis-settings";
    const PUBLICATION_ENDPOINT = "plugin/rss-brief/publication";
    const POLL_RUNNING_MS = 3000;
    const POLL_IDLE_MS = 60000;

    const ZH = {
      "panel.title": "RSS 阅读",
      "action.refresh": "刷新",
      "action.sync": "立即抓取",
      "action.read": "阅读",
      "action.source": "原文",
      "action.settings": "设置",
      "subscriptions.title": "管理订阅",
      "subscriptions.subtitle": "添加来源、修改地址和分类，或移除订阅。",
      "subscriptions.count": "共 {count} 个订阅",
      "subscriptions.search": "搜索订阅名称、地址或分类",
      "subscriptions.add": "添加订阅",
      "subscriptions.edit": "编辑",
      "subscriptions.editTitle": "编辑订阅",
      "subscriptions.delete": "移除订阅",
      "subscriptions.confirmDelete": "移除“{title}”的订阅？已有文章和阅读记录会保留。",
      "subscriptions.confirm": "确认移除",
      "subscriptions.cancel": "取消",
      "subscriptions.name": "名称",
      "subscriptions.feedUrl": "RSS / Atom 地址",
      "subscriptions.homeUrl": "网站地址（选填）",
      "subscriptions.group": "分类",
      "subscriptions.groupHint": "选择现有分类或输入新分类",
      "subscriptions.required": "请填写名称、有效的 RSS / Atom 地址和分类。",
      "subscriptions.homeInvalid": "网站地址须以 http:// 或 https:// 开头。",
      "subscriptions.duplicate": "该订阅地址已存在，请修改已有订阅。",
      "subscriptions.empty": "还没有订阅，添加一个来源开始阅读。",
      "subscriptions.noMatches": "没有找到匹配的订阅。",
      "subscriptions.reload": "重新加载订阅",
      "subscriptions.conflict": "订阅已发生变化，请重新加载后再保存。当前填写内容已保留。",
      "subscriptions.saved": "订阅已保存",
      "subscriptions.removed": "订阅已移除",
      "subscriptions.ungrouped": "未分组",
      "subscriptions.invalidResponse": "无法读取订阅数据，请重新加载。",
      "settings.title": "阅读设置",
      "settings.subtitle": "按用途调整阅读和创作偏好",
      "settings.fetchTab": "自动抓取",
      "settings.analysisTab": "阅读分析",
      "settings.creationTab": "文章创作",
      "settings.creationHint": "用于生成微信文章和分享海报。",
      "settings.saveCreation": "保存创作设置",
      "settings.unsaved": "有未保存的更改",
      "settings.discardPrompt": "离开设置将丢弃未保存的更改。",
      "settings.discard": "放弃更改并离开",
      "settings.keepEditing": "继续编辑",
      "settings.savedHint": "各分区单独保存",
      "schedule.presets": "常用间隔",
      "schedule.halfHour": "30 分钟",
      "schedule.hour": "1 小时",
      "schedule.sixHours": "6 小时",
      "schedule.day": "每天",
      "settings.modelTitle": "文章创作模型",
      "assessment.title": "AI 阅读评估",
      "assessment.score": "评分 {score}/100",
      "assessment.highQuality": "高质量",
      "assessment.filter": "只看高质量",
      "assessment.empty": "暂无高质量文章",
      "assessment.emptyHint": "完成全文评估且评分达到 60 分的文章会出现在这里。",
      "assessment.showAll": "查看全部质量",
      "assessment.pending": "待评估",
      "assessment.failed": "评估暂不可用",
      "assessment.recommended": "深度阅读",
      "assessment.optional": "按需阅读",
      "assessment.skip": "可略过",
      "assessment.provisional": "暂定评估",
      "assessment.stale": "评估已过期，等待更新",
      "assessment.disclaimer": "AI 评估仅供阅读参考。",
      "assessment.excerpt": "仅基于摘要评估，获取全文后结果可能变化；不计入高质量筛选。",
      "assessment.sampled": "仅基于部分正文评估，未覆盖全文；不计入高质量筛选。",
      "assessment.information": "信息量",
      "assessment.evidence": "证据质量",
      "assessment.depth": "分析深度",
      "assessment.utility": "实用价值",
      "assessment.clarity": "表达清晰度",
      "analysis.title": "自动阅读分析",
      "analysis.hint": "抓取后评估文章质量，帮助筛选值得阅读的内容。",
      "analysis.enabled": "启用自动分析",
      "analysis.perSync": "每次抓取最多分析篇数",
      "analysis.limitHint": "每次 1–200 篇，数量越多，分析耗时越长。",
      "analysis.inherit": "沿用文章创作模型",
      "analysis.modelTitle": "分析模型",
      "analysis.save": "保存分析设置",
      "analysis.saved": "分析设置已保存，将在后续抓取中生效。",
      "analysis.error": "无法读取分析设置",
      "analysis.invalid": "请输入 1–200 之间的整数篇数，并选择完整的服务商和模型。",
      "analysis.pinned": "分析模型已由配置固定；仍可调整自动分析开关和篇数。",
      "settings.source.inherited": "沿用文章创作模型",
      "schedule.title": "抓取设置",
      "schedule.hint": "选择自动检查新文章的频率，也可输入 5–10080 分钟的间隔。",
      "schedule.minutes": "抓取间隔（分钟）",
      "schedule.loading": "正在读取抓取设置…",
      "schedule.error": "无法读取抓取设置",
      "schedule.invalid": "请输入 5–10080 之间的整数分钟数。",
      "schedule.invalidResponse": "抓取设置响应无效，请重试。",
      "schedule.saveError": "无法保存抓取设置",
      "schedule.save": "保存抓取设置",
      "schedule.saved": "抓取设置已保存并立即生效，下次抓取时间已更新。",
      "settings.follow": "跟随默认模型",
      "settings.followHint": "使用 Harness 当前默认模型",
      "settings.custom": "指定模型",
      "settings.customHint": "用于本插件的单篇文章创作",
      "settings.provider": "服务商",
      "settings.model": "模型",
      "settings.effective": "当前生效",
      "settings.source.default": "默认",
      "settings.source.custom": "自定义",
      "settings.source.config": "配置固定",
      "settings.pinned": "模型已由插件配置固定，无法在此修改。",
      "settings.pinnedHint": "如需更改，请修改 bundle 配置中的 provider / model，或移除后重载插件。",
      "settings.saved": "已保存，将在下一次文章创作任务中生效",
      "settings.save": "保存",
      "settings.saving": "正在保存…",
      "settings.cancel": "取消",
      "settings.close": "关闭",
      "settings.reset": "恢复默认",
      "settings.loading": "正在读取可用模型…",
      "settings.error": "无法读取模型设置",
      "settings.retry": "重试",
      "settings.empty": "没有可选的模型",
      "settings.emptyHint": "请先在 Harness 中配置模型服务商。",
      "settings.chooseProvider": "请选择服务商",
      "settings.chooseModel": "请选择模型",
      "settings.hint": "用于本插件的单篇文章创作，不会改动 Harness 默认模型。",
      "settings.currentDefault": "当前默认：{model}",
      "settings.modelCount": "{count} 个模型",
      "search.placeholder": "搜索标题、来源或摘要",
      "search.clear": "清除搜索",
      "tags.filter": "主题筛选",
      "tags.all": "全部主题",
      "tags.clear": "清除主题筛选",
      "topics.select": "筛选主题：{tag}",
      "formats.filter": "内容类型筛选",
      "formats.all": "全部内容类型",
      "formats.clear": "清除内容类型筛选",
      "formats.select": "筛选内容类型：{format}",
      "tags.select": "筛选标签：{tag}",
      "tags.count": "{tag}（{count}）",
      "tags.more": "另 {count} 个标签：{tags}",
      "search.results": "找到 {count} 篇匹配 “{query}”",
      "search.empty": "没有匹配的文章",
      "search.emptyHint": "换个关键词，或清除搜索查看全部。",
      "search.clearAction": "清除搜索",
      "read.markRead": "标为已读",
      "read.all": "全部标为已读",
      "read.allPending": "正在标记…",
      "read.allSuccess": "已将 {count} 篇文章标为已读",
      "read.allError": "无法批量标为已读",
      "read.allInvalid": "批量已读响应无效，请刷新列表。",
      "read.markUnread": "标为未读",
      "read.onlyUnread": "只看未读",
      "read.unreadSummary": "未读 {count} 篇",
      "read.empty": "没有未读文章",
      "read.emptyHint": "关闭「只看未读」可以查看全部文章。",
      "read.showAll": "显示全部",
      "state.error": "无法读取文章列表",
      "state.retry": "重试",
      "state.running": "正在{phase}",
      "phase.start": "启动任务",
      "phase.opml": "读取订阅源",
      "phase.feeds": "抓取 RSS",
      "phase.content": "提取正文",
      "phase.ai": "AI 分类与摘要",
      "phase.analysis": "分析阅读价值",
      "phase.queued": "排队等待分析",
      "badge.fallback": "降级",
      "badge.cached": "缓存",
      "meta.relevance": "相关度 {score}",
      "section.jump": "分类",
      "section.empty": "暂无分类",
      "section.feedErrors": "抓取异常（{count}）",
      "footer.nextSync": "下次抓取",
      "time.unknown": "时间未知",
      "reader.back": "返回文章列表",
      "reader.close": "关闭阅读",
      "reader.pane": "文章阅读",
      "layout.navigationWidth": "调整导航宽度",
      "layout.readerWidth": "调整列表与阅读栏宽度",
      "layout.resizeHint": "拖动或按左右方向键调整，双击恢复默认宽度",
      "reader.choose": "选择一篇文章",
      "reader.chooseHint": "点击左侧文章，在这里阅读全文。",
      "reader.original": "打开原文",
      "reader.loading": "正在读取正文…",
      "reader.error": "无法读取正文",
      "reader.retry": "重新提取",
      "reader.empty": "没有可显示的正文",
      "reader.fallback": "正文来自订阅源摘要",
      "reader.failed": "正文提取失败",
      "reader.summary": "AI 摘要",
      "reader.minutes": "约 {minutes} 分钟",
      "reader.at": "发表于 {date}",
      "reader.sourceNote": "正文保留原文结构，图片从来源网站加载。",
      "reader.fetching": "正在获取完整正文…",
      "reader.cached": "正在读取本地内容…",
      "reader.source.web": "网页正文",
      "reader.source.feed": "订阅内容",
      "reader.source.feed-summary": "订阅摘要",
      "reader.source.legacy": "已缓存正文",
      "reader.source.preview": "文章摘要",
      "reader.refreshFailed": "暂时无法更新正文，已保留现有内容",
      "reader.truncated": "文章较长，当前显示部分内容。可打开原文继续阅读。",
      "reader.imageFailed": "图片暂时无法加载",
      "reader.imageOriginal": "打开原图",
      "reader.video": "视频",
      "reader.videoOpen": "在新窗口播放",
      "reader.withVideo": "含视频",
      "reader.provider.bilibili": "哔哩哔哩",
      "reader.provider.youtube": "YouTube",
      "reader.provider.vimeo": "Vimeo",
      "reader.provider.qq": "腾讯视频",
      "reader.provider.youku": "优酷",
      "reader.provider.native": "视频文件",
      "reader.prev": "上一篇",
      "reader.next": "下一篇",
      "reader.prevHint": "上一篇（[）",
      "reader.nextHint": "下一篇（]）",
      "reader.keys": "Esc 返回 · [ 上一篇 · ] 下一篇",
      "share.create": "生成分享海报并保存微信草稿",
      "share.querying": "正在查询分享海报任务…",
      "share.starting": "正在启动分享海报任务…",
      "share.running": "生成分享海报：{stage}",
      "share.queued": "分享海报排队中：第 {position} 位",
      "share.succeeded": "分享海报已保存微信草稿",
      "share.submitted": "分享海报已提交微信发布，等待发布结果",
      "share.publishId": "微信发布任务 ID",
      "share.needsAttention": "请核对分享海报微信草稿",
      "share.attentionHint": "请先检查微信公众号草稿箱，确认分享海报是否已保存，避免重复创建。",
      "share.failed": "分享海报任务失败",
      "share.retry": "重试生成分享海报",
      "share.queryRetry": "重新查询海报任务",
      "share.requestError": "无法确认分享海报任务状态",
      "share.uncertain": "启动结果尚未确认，请先查询海报任务状态。",
      "share.lastKnown": "已保留最近一次海报任务状态；查询恢复后会继续更新。",
      "share.invalid": "分享海报任务响应无效，请重试查询。",
      "share.missing": "查询未返回已有海报任务，请重试查询。",
      "share.model": "海报任务模型",
      "share.session": "海报任务会话 ID",
      "share.mediaId": "海报微信草稿 media_id",
      "share.posterPath": "分享海报路径",
      "share.captionPath": "分享文案路径",
      "share.notReady": "完整正文尚未就绪，请等待提取完成或重新提取正文。",
      "share.stage.preparing": "准备海报任务",
      "share.stage.evidence": "核对全文素材",
      "share.stage.writing": "撰写分享文案",
      "share.stage.images": "生成 HD-2D 分享图",
      "share.stage.validation": "校验海报与文案",
      "share.stage.wechat_draft": "保存图片消息草稿",
      "publication.create": "创作并保存微信草稿",
      "publication.querying": "正在查询微信草稿任务…",
      "publication.starting": "正在启动微信草稿任务…",
      "publication.running": "创建微信草稿：{stage}",
      "publication.queued": "微信草稿排队中：第 {position} 位",
      "publication.succeeded": "已保存微信草稿",
      "publication.submitted": "已提交微信发布，等待发布结果",
      "publication.publishId": "微信发布任务 ID",
      "publication.needsAttention": "请核对微信草稿箱",
      "publication.attentionHint": "任务需要核对，请先检查微信公众号草稿箱，避免重复创建。",
      "publication.failed": "微信草稿任务失败",
      "publication.retry": "重试创建微信草稿",
      "publication.queryRetry": "重试查询任务",
      "publication.requestError": "无法确认微信草稿任务状态",
      "publication.uncertain": "启动结果尚未确认，请先查询任务状态。",
      "publication.lastKnown": "已保留最近一次任务状态；查询恢复后会继续更新。",
      "publication.invalid": "微信草稿任务响应无效，请重试查询。",
      "publication.missing": "查询未返回已有任务，请重试查询。",
      "publication.model": "任务模型",
      "publication.session": "任务会话 ID",
      "publication.mediaId": "微信草稿 media_id",
      "publication.articlePath": "生成文章路径",
      "publication.stage.preparing": "准备任务",
      "publication.stage.evidence": "分析素材",
      "publication.stage.writing": "撰写文章",
      "publication.stage.images": "生成配图",
      "publication.stage.validation": "校验文章",
      "publication.stage.wechat_draft": "保存微信草稿",
      "dashboard.workspace": "订阅阅读工作台",
      "dashboard.unread": "未读文章",
      "dashboard.articles": "文章列表",
      "dashboard.results": "显示 {visible} / {total} 篇",
      "dashboard.navigate": "标签导航",
      "navigation.topics": "主题",
      "navigation.formats": "内容类型",
      "navigation.legacy": "历史标签",
      "navigation.empty": "暂无标签",
      "sources.title": "订阅来源",
      "sources.all": "全部来源",
      "sources.expand": "展开{category}的来源",
      "sources.collapse": "收起{category}的来源",
      "dashboard.all": "全部文章",
      "dashboard.total": "{count} 篇文章",
      "dashboard.source": "来源与时间",
      "view.latest": "最新文章",
      "view.compact": "紧凑模式",
      "latest.hint": "抓取后即可阅读 · 按主题和内容类型浏览",
      "latest.more": "加载更多",
      "latest.loading": "正在加载…",
      "latest.empty": "还没有抓取到文章",
      "latest.emptyHint": "点击「立即抓取」获取订阅源的最新文章。",
      "latest.lastFetch": "最近抓取 {time}",
      "list.newest": "最新发布在前",
      "list.categoryEmpty": "该分类暂无文章",
      "list.categoryEmptyHint": "可以切换其他分类，或查看全部文章。",
    };

    const EN = {
      "panel.title": "RSS Reader",
      "action.refresh": "Refresh",
      "action.sync": "Fetch now",
      "action.read": "Read",
      "action.source": "Source",
      "action.settings": "Settings",
      "subscriptions.title": "Manage subscriptions",
      "subscriptions.subtitle": "Add sources, edit addresses and categories, or remove subscriptions.",
      "subscriptions.count": "{count} subscriptions",
      "subscriptions.search": "Search subscription name, address or category",
      "subscriptions.add": "Add subscription",
      "subscriptions.edit": "Edit",
      "subscriptions.editTitle": "Edit subscription",
      "subscriptions.delete": "Remove subscription",
      "subscriptions.confirmDelete": "Remove the subscription to “{title}”? Existing articles and reading history will be kept.",
      "subscriptions.confirm": "Confirm removal",
      "subscriptions.cancel": "Cancel",
      "subscriptions.name": "Name",
      "subscriptions.feedUrl": "RSS / Atom URL",
      "subscriptions.homeUrl": "Website URL (optional)",
      "subscriptions.group": "Category",
      "subscriptions.groupHint": "Choose a category or enter a new one",
      "subscriptions.required": "Enter a name, a valid RSS / Atom URL and a category.",
      "subscriptions.homeInvalid": "The website URL must start with http:// or https://.",
      "subscriptions.duplicate": "This subscription URL already exists. Edit the existing subscription.",
      "subscriptions.empty": "No subscriptions yet. Add a source to start reading.",
      "subscriptions.noMatches": "No matching subscriptions.",
      "subscriptions.reload": "Reload subscriptions",
      "subscriptions.conflict": "Subscriptions have changed. Reload before saving again. Your input has been kept.",
      "subscriptions.saved": "Subscription saved",
      "subscriptions.removed": "Subscription removed",
      "subscriptions.ungrouped": "Uncategorized",
      "subscriptions.invalidResponse": "Unable to read subscription data. Reload and try again.",
      "settings.title": "Reading settings",
      "settings.subtitle": "Adjust your reading and creation preferences",
      "settings.fetchTab": "Fetching",
      "settings.analysisTab": "Reading analysis",
      "settings.creationTab": "Article creation",
      "settings.creationHint": "Used for WeChat articles and share posters.",
      "settings.saveCreation": "Save creation settings",
      "settings.unsaved": "Unsaved changes",
      "settings.discardPrompt": "Leaving settings will discard unsaved changes.",
      "settings.discard": "Discard and leave",
      "settings.keepEditing": "Keep editing",
      "settings.savedHint": "Each section saves separately",
      "schedule.presets": "Common intervals",
      "schedule.halfHour": "30 minutes",
      "schedule.hour": "1 hour",
      "schedule.sixHours": "6 hours",
      "schedule.day": "Daily",
      "settings.modelTitle": "Article creation model",
      "assessment.title": "AI reading assessment",
      "assessment.score": "Score {score}/100",
      "assessment.highQuality": "High quality",
      "assessment.filter": "High quality only",
      "assessment.empty": "No high quality articles yet",
      "assessment.emptyHint": "Articles appear here after a full assessment with a score of at least 60.",
      "assessment.showAll": "Show all quality levels",
      "assessment.pending": "Assessment pending",
      "assessment.failed": "Assessment unavailable",
      "assessment.recommended": "Read in depth",
      "assessment.optional": "Read as needed",
      "assessment.skip": "Can skip",
      "assessment.provisional": "Provisional assessment",
      "assessment.stale": "Assessment outdated; awaiting an update",
      "assessment.disclaimer": "AI assessment is a reading aid.",
      "assessment.excerpt": "Based on the excerpt only. Results may change with the full article; excluded from the high quality filter.",
      "assessment.sampled": "Based on a sample of the article. The full text was not assessed; excluded from the high quality filter.",
      "assessment.information": "Information",
      "assessment.evidence": "Evidence",
      "assessment.depth": "Depth",
      "assessment.utility": "Utility",
      "assessment.clarity": "Clarity",
      "analysis.title": "Automatic reading analysis",
      "analysis.hint": "Assess article quality after fetching. Analysis and article creation models are saved separately.",
      "analysis.enabled": "Enable automatic analysis",
      "analysis.perSync": "Maximum articles analyzed per fetch",
      "analysis.limitHint": "Enabled by default, with up to 40 articles per fetch. Choose 1–200 articles.",
      "analysis.inherit": "Use article creation model",
      "analysis.modelTitle": "Analysis model",
      "analysis.save": "Save analysis settings",
      "analysis.saved": "Analysis settings saved. Applies to subsequent fetches.",
      "analysis.error": "Could not load analysis settings",
      "analysis.invalid": "Enter a whole number between 1 and 200, and select both a provider and a model.",
      "analysis.pinned": "The analysis model is pinned by config. Automatic analysis and the article limit remain editable.",
      "settings.source.inherited": "Uses article creation model",
      "schedule.title": "Fetch settings",
      "schedule.hint": "Fetches every 1 hour (60 minutes) by default. Choose 5–10080 minutes; changes take effect immediately.",
      "schedule.minutes": "Fetch interval (minutes)",
      "schedule.loading": "Loading fetch settings…",
      "schedule.error": "Could not load fetch settings",
      "schedule.invalid": "Enter a whole number of minutes between 5 and 10080.",
      "schedule.invalidResponse": "Invalid fetch settings response. Please retry.",
      "schedule.saveError": "Could not save fetch settings",
      "schedule.save": "Save fetch settings",
      "schedule.saved": "Fetch settings saved and effective immediately. The next fetch time has been updated.",
      "settings.follow": "Follow default model",
      "settings.followHint": "Use the current Harness default model",
      "settings.custom": "Pick a model",
      "settings.customHint": "Used for this plugin's individual article creation",
      "settings.provider": "Provider",
      "settings.model": "Model",
      "settings.effective": "Effective now",
      "settings.source.default": "Default",
      "settings.source.custom": "Custom",
      "settings.source.config": "Pinned by config",
      "settings.pinned": "The model is pinned by the plugin configuration and cannot be changed here.",
      "settings.pinnedHint": "Edit provider / model in the bundle config, or remove both and reload the plugin.",
      "settings.saved": "Saved. Applies to the next article creation task.",
      "settings.save": "Save",
      "settings.saving": "Saving…",
      "settings.cancel": "Cancel",
      "settings.close": "Close",
      "settings.reset": "Reset to default",
      "settings.loading": "Loading available models…",
      "settings.error": "Could not load model settings",
      "settings.retry": "Retry",
      "settings.empty": "No models available",
      "settings.emptyHint": "Configure a model provider in Harness first.",
      "settings.chooseProvider": "Select a provider",
      "settings.chooseModel": "Select a model",
      "settings.hint": "Used for this plugin's individual article creation; the Harness default model is untouched.",
      "settings.currentDefault": "Current default: {model}",
      "settings.modelCount": "{count} models",
      "search.placeholder": "Search title, source, or summary",
      "search.clear": "Clear search",
      "tags.filter": "Filter by topic",
      "tags.all": "All topics",
      "tags.clear": "Clear topic filter",
      "topics.select": "Filter by topic: {tag}",
      "formats.filter": "Filter by content type",
      "formats.all": "All content types",
      "formats.clear": "Clear content type filter",
      "formats.select": "Filter by content type: {format}",
      "tags.select": "Filter by tag: {tag}",
      "tags.count": "{tag} ({count})",
      "tags.more": "{count} more tags: {tags}",
      "search.results": "{count} matches for “{query}”",
      "search.empty": "No matching articles",
      "search.emptyHint": "Try another keyword, or clear the search to see everything.",
      "search.clearAction": "Clear search",
      "read.markRead": "Mark read",
      "read.all": "Mark all as read",
      "read.allPending": "Marking…",
      "read.allSuccess": "Marked {count} articles as read",
      "read.allError": "Could not mark all as read",
      "read.allInvalid": "Invalid bulk read response. Refresh the list.",
      "read.markUnread": "Mark unread",
      "read.onlyUnread": "Unread only",
      "read.unreadSummary": "{count} unread",
      "read.empty": "No unread articles",
      "read.emptyHint": "Turn off “Unread only” to see all articles.",
      "read.showAll": "Show all",
      "state.error": "Could not read the article list",
      "state.retry": "Retry",
      "state.running": "Running {phase}",
      "phase.start": "the task",
      "phase.opml": "the OPML",
      "phase.feeds": "RSS fetches",
      "phase.content": "article extraction",
      "phase.ai": "AI summaries",
      "phase.analysis": "reading value assessment",
      "phase.queued": "analysis (waiting in queue)",
      "badge.fallback": "Fallback",
      "badge.cached": "Cached",
      "meta.relevance": "Relevance {score}",
      "section.jump": "Categories",
      "section.empty": "No categories",
      "section.feedErrors": "Fetch errors ({count})",
      "footer.nextSync": "Next fetch",
      "time.unknown": "Unknown time",
      "reader.back": "Back to articles",
      "reader.close": "Close reader",
      "reader.pane": "Article reader",
      "layout.navigationWidth": "Resize navigation",
      "layout.readerWidth": "Resize article list and reader",
      "layout.resizeHint": "Drag or use arrow keys to resize; double-click to reset",
      "reader.choose": "Select an article",
      "reader.chooseHint": "Choose an article from the list to read it here.",
      "reader.original": "Open source",
      "reader.loading": "Reading the article…",
      "reader.error": "Could not read this article",
      "reader.retry": "Try extraction again",
      "reader.empty": "No readable text is available",
      "reader.fallback": "Text comes from the feed summary",
      "reader.failed": "Article extraction failed",
      "reader.summary": "AI summary",
      "reader.minutes": "About {minutes} min read",
      "reader.at": "Published {date}",
      "reader.sourceNote": "Original structure is preserved. Images load from the source website.",
      "reader.fetching": "Fetching the full article…",
      "reader.cached": "Loading saved content…",
      "reader.source.web": "Web article",
      "reader.source.feed": "Feed content",
      "reader.source.feed-summary": "Feed excerpt",
      "reader.source.legacy": "Saved article",
      "reader.source.preview": "Article preview",
      "reader.refreshFailed": "Could not update this article. Saved content is still available.",
      "reader.truncated": "This long article is partially displayed. Open the source to continue reading.",
      "reader.imageFailed": "This image could not be loaded",
      "reader.imageOriginal": "Open image",
      "reader.video": "Video",
      "reader.videoOpen": "Play in new window",
      "reader.withVideo": "includes video",
      "reader.provider.bilibili": "Bilibili",
      "reader.provider.youtube": "YouTube",
      "reader.provider.vimeo": "Vimeo",
      "reader.provider.qq": "Tencent Video",
      "reader.provider.youku": "Youku",
      "reader.provider.native": "Video file",
      "reader.prev": "Previous",
      "reader.next": "Next",
      "reader.prevHint": "Previous article ([)",
      "reader.nextHint": "Next article (])",
      "reader.keys": "Esc back · [ previous · ] next",
      "share.create": "Create poster and save WeChat draft",
      "share.querying": "Checking sharing poster task…",
      "share.starting": "Starting sharing poster task…",
      "share.running": "Creating sharing poster: {stage}",
      "share.queued": "Share poster queued: position {position}",
      "share.succeeded": "Sharing poster saved to WeChat drafts",
      "share.submitted": "Poster submitted to WeChat; awaiting publication result",
      "share.publishId": "WeChat publication job ID",
      "share.needsAttention": "Check the sharing poster in WeChat drafts",
      "share.attentionHint": "Check the official account drafts to confirm whether the sharing poster was saved before creating another.",
      "share.failed": "Sharing poster task failed",
      "share.retry": "Retry sharing poster generation",
      "share.queryRetry": "Query poster task again",
      "share.requestError": "Could not confirm the sharing poster task status",
      "share.uncertain": "The start result is unconfirmed. Query the poster task status first.",
      "share.lastKnown": "The last known poster task status is retained and will update when queries recover.",
      "share.invalid": "Invalid sharing poster task response. Retry the query.",
      "share.missing": "The query did not return the existing poster task. Retry the query.",
      "share.model": "Poster task model",
      "share.session": "Poster task session ID",
      "share.mediaId": "Poster WeChat draft media_id",
      "share.posterPath": "Sharing poster path",
      "share.captionPath": "Sharing caption path",
      "share.notReady": "The full article is not ready. Wait for extraction or extract the article again.",
      "share.stage.preparing": "Preparing poster task",
      "share.stage.evidence": "Checking full article sources",
      "share.stage.writing": "Writing sharing caption",
      "share.stage.images": "Generating HD-2D sharing images",
      "share.stage.validation": "Validating poster and caption",
      "share.stage.wechat_draft": "Saving image message draft",
      "publication.create": "Create and save WeChat draft",
      "publication.querying": "Checking WeChat draft task…",
      "publication.starting": "Starting WeChat draft task…",
      "publication.running": "Creating WeChat draft: {stage}",
      "publication.queued": "WeChat draft queued: position {position}",
      "publication.succeeded": "WeChat draft saved",
      "publication.submitted": "Submitted to WeChat; awaiting publication result",
      "publication.publishId": "WeChat publication job ID",
      "publication.needsAttention": "Check WeChat drafts",
      "publication.attentionHint": "This task needs attention. Check the WeChat official account drafts before creating another draft.",
      "publication.failed": "WeChat draft task failed",
      "publication.retry": "Retry creating WeChat draft",
      "publication.queryRetry": "Retry task query",
      "publication.requestError": "Could not confirm the WeChat draft task status",
      "publication.uncertain": "The start result is unconfirmed. Query the task status first.",
      "publication.lastKnown": "The last known task status is retained and will update when queries recover.",
      "publication.invalid": "Invalid WeChat draft task response. Retry the query.",
      "publication.missing": "The query did not return the existing task. Retry the query.",
      "publication.model": "Task model",
      "publication.session": "Task session ID",
      "publication.mediaId": "WeChat draft media_id",
      "publication.articlePath": "Generated article path",
      "publication.stage.preparing": "Preparing task",
      "publication.stage.evidence": "Analyzing sources",
      "publication.stage.writing": "Writing article",
      "publication.stage.images": "Generating images",
      "publication.stage.validation": "Validating article",
      "publication.stage.wechat_draft": "Saving WeChat draft",
      "dashboard.workspace": "Subscription reading workspace",
      "dashboard.unread": "Unread articles",
      "dashboard.articles": "Articles",
      "dashboard.results": "Showing {visible} of {total}",
      "dashboard.navigate": "Tag navigation",
      "navigation.topics": "Topics",
      "navigation.formats": "Content types",
      "navigation.legacy": "Historical tags",
      "navigation.empty": "No tags yet",
      "sources.title": "Subscriptions",
      "sources.all": "All sources",
      "sources.expand": "Expand sources in {category}",
      "sources.collapse": "Collapse sources in {category}",
      "dashboard.all": "All articles",
      "dashboard.total": "{count} articles",
      "dashboard.source": "Source and time",
      "view.latest": "Latest articles",
      "view.compact": "Compact mode",
      "latest.hint": "Read after fetching · Browse by topic and content type",
      "latest.more": "Load more",
      "latest.loading": "Loading…",
      "latest.empty": "No articles fetched yet",
      "latest.emptyHint": "Choose Fetch now to get the latest articles from your subscriptions.",
      "latest.lastFetch": "Last fetched {time}",
      "list.newest": "Newest first",
      "list.categoryEmpty": "No articles in this category",
      "list.categoryEmptyHint": "Choose another category or view all articles.",
    };

    const CSS = String.raw`
/* ===== Tokens ===== */
.rsb-root {
  --rsb-border: var(--dsw-alias-border-l1);
  --rsb-border-strong: var(--dsw-alias-border-l2);
  --rsb-canvas: var(--dsw-alias-bg-base);
  --rsb-surface: var(--dsw-alias-bg-layer-1);
  --rsb-surface-2: var(--dsw-alias-bg-layer-2);
  --rsb-sidebar: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1));
  --rsb-muted: var(--dsw-alias-label-secondary);
  --rsb-fg: var(--dsw-alias-label-primary);
  --rsb-brand: var(--dsw-alias-brand-primary);
  --rsb-error: var(--dsw-alias-state-error-primary);
  --rsb-success: var(--dsw-alias-state-success-primary);
  --rsb-accent: var(--rsb-brand);
  --rsb-accent-hover: color-mix(in srgb, var(--rsb-brand) 85%, var(--rsb-fg));
  --rsb-accent-text: color-mix(in srgb, var(--rsb-accent) 78%, var(--rsb-fg));
  --rsb-accent-soft: color-mix(in srgb, var(--rsb-accent) 13%, transparent);
  --rsb-hover: color-mix(in srgb, var(--rsb-fg) 6%, transparent);
  --rsb-active: color-mix(in srgb, var(--rsb-fg) 10%, transparent);
  --rsb-fill: color-mix(in srgb, var(--rsb-fg) 7%, transparent);
  --rsb-divider: color-mix(in srgb, var(--rsb-border) 65%, transparent);
  --rsb-focus: var(--rsb-brand);
  --rsb-radius-sm: 6px;
  --rsb-radius: 8px;
  --rsb-radius-lg: 12px;
  --rsb-shadow-pop: 0 12px 32px rgba(0, 0, 0, .22), 0 2px 6px rgba(0, 0, 0, .08);
  --rsb-mono: ui-monospace, "Cascadia Code", Consolas, monospace;
  --rsb-ease: .14s ease;
  container-type: inline-size;
  position: relative;
  display: flex;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: var(--rsb-sidebar);
  color: var(--rsb-fg);
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
}
.rsb-root, .rsb-root * { box-sizing: border-box; }
.rsb-root button, .rsb-root input, .rsb-root select { font-family: inherit; }
.rsb-root button:disabled { cursor: default; opacity: .5; }
.rsb-root :is(button, a, summary, select):focus-visible { outline: 2px solid var(--rsb-focus); outline-offset: 2px; }
.rsb-root ::-webkit-scrollbar { width: 8px; height: 8px; }
.rsb-root ::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--rsb-fg) 16%, transparent); border-radius: 8px; }
.rsb-root ::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--rsb-fg) 26%, transparent); }
.rsb-icon { display: block; flex: none; }
.rsb-spin { animation: rsb-spin 1s linear infinite; }
@keyframes rsb-spin { to { transform: rotate(360deg); } }

/* Disclosure chevron shared by rail groups and collapsible details. */
.rsb-tagNavGroup > summary, .rsb-sourcesNavigation > summary, .rsb-details > summary:not(.rsb-assessmentSummary) { display: flex; align-items: center; gap: 6px; list-style: none; cursor: pointer; user-select: none; }
:is(.rsb-tagNavGroup, .rsb-sourcesNavigation, .rsb-details) > summary::-webkit-details-marker { display: none; }
.rsb-tagNavGroup > summary::before, .rsb-sourcesNavigation > summary::before, .rsb-details > summary:not(.rsb-assessmentSummary)::before { content: ""; flex: none; width: 5px; height: 5px; margin: 0 2px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; opacity: .7; transform: rotate(-45deg); transition: transform var(--rsb-ease); }
:is(.rsb-tagNavGroup, .rsb-sourcesNavigation, .rsb-details)[open] > summary::before { transform: rotate(45deg); }

/* ===== Rail ===== */
.rsb-rail { display: flex; flex-direction: column; flex: 0 0 208px; width: 208px; min-height: 0; padding: 12px 8px 8px; gap: 12px; }
.rsb-brand { display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 0 6px; }
.rsb-brandMark { display: flex; align-items: center; justify-content: center; flex: none; width: 28px; height: 28px; border-radius: var(--rsb-radius); background: var(--rsb-accent); color: var(--rsb-canvas); }
.rsb-brandName { display: block; font-size: 15px; font-weight: 700; line-height: 1.3; }
.rsb-brandCaption { display: block; font-size: 12px; color: var(--rsb-muted); }
.rsb-rail > .rsb-btn { width: 100%; height: 34px; justify-content: flex-start; padding-left: 12px; background: var(--rsb-fill); color: var(--rsb-fg); font-weight: 600; }
.rsb-rail > .rsb-btn:hover:not(:disabled) { background: var(--rsb-hover); }
.rsb-railNavigation { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 2px; scrollbar-width: thin; }
.rsb-railList { display: flex; flex-direction: column; gap: 1px; }
.rsb-railTitle { margin: 0 0 4px; padding: 5px 10px 5px 6px; border-radius: var(--rsb-radius-sm); color: var(--rsb-muted); font-size: 12px; font-weight: 600; letter-spacing: .04em; }
.rsb-railTitle:hover { color: var(--rsb-fg); }
.rsb-railItem { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 32px; padding: 5px 10px; border: 0; border-radius: var(--rsb-radius); background: transparent; color: color-mix(in srgb, var(--rsb-fg) 80%, transparent); font: inherit; font-size: 14px; text-align: left; cursor: pointer; transition: background-color var(--rsb-ease), color var(--rsb-ease); }
.rsb-railItem:hover { background: var(--rsb-hover); color: var(--rsb-fg); }
.rsb-railItem[data-active="true"] { background: var(--rsb-accent-soft); color: var(--rsb-fg); font-weight: 600; }
.rsb-railItem > .rsb-icon { opacity: .7; }
.rsb-railItem[data-active="true"] > .rsb-icon { color: var(--rsb-accent); opacity: 1; }
.rsb-railItem:focus-visible { outline-offset: -2px; }
.rsb-railLabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rsb-railCount { flex: none; color: var(--rsb-muted); font-size: 12px; font-weight: 400; font-variant-numeric: tabular-nums; }
.rsb-railItem[data-active="true"] .rsb-railCount { color: var(--rsb-accent-text); font-weight: 600; }
.rsb-railEmpty { margin: 0; padding: 6px 10px; color: var(--rsb-muted); font-size: 13px; }
.rsb-tagNavGroup { min-width: 0; margin-top: 14px; }
.rsb-tagNavItem { padding-left: 22px; }
.rsb-sourcesNavigation { margin-top: 16px; padding-top: 10px; border-top: 1px solid var(--rsb-border); }
.rsb-sourcesNavigation > summary { padding: 5px 6px; border-radius: var(--rsb-radius-sm); color: var(--rsb-muted); font-size: 12px; font-weight: 600; letter-spacing: .04em; }
.rsb-sourcesNavigation > summary:hover { color: var(--rsb-fg); }
.rsb-sourcesNavigation > .rsb-railList { margin-top: 4px; }
.rsb-categoryGroup { min-width: 0; }
.rsb-categoryRow { display: flex; align-items: center; min-width: 0; }
.rsb-categoryRow > .rsb-railItem { flex: 1; min-width: 0; padding-left: 4px; }
.rsb-categoryToggle { display: flex; align-items: center; justify-content: center; flex: 0 0 20px; width: 20px; height: 30px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--rsb-muted); cursor: pointer; }
.rsb-categoryToggle:hover { background: var(--rsb-hover); color: var(--rsb-fg); }
.rsb-categoryToggle:disabled { opacity: .25; }
.rsb-categoryToggle > svg { transition: transform var(--rsb-ease); }
.rsb-categoryToggle[aria-expanded="true"] > svg { transform: rotate(90deg); }
.rsb-categoryToggle:focus-visible { outline-offset: -2px; }
.rsb-categoryRow[data-current="true"] > .rsb-categoryToggle { color: var(--rsb-fg); }
.rsb-sourceList { margin: 2px 0 5px 18px; padding-left: 7px; border-left: 1px solid var(--rsb-divider); }
.rsb-railItem.rsb-sourceItem { min-height: 29px; gap: 7px; font-size: 12.5px; }
.rsb-sourceItem .rsb-feedIcon { flex: 0 0 16px; width: 16px; height: 18px; }
.rsb-sourceItem .rsb-feedIcon img { width: 14px; height: 14px; }
.rsb-sourceItem .rsb-feedInitial { width: 14px; height: 14px; font-size: 10px; }
.rsb-railFooter { flex: none; max-height: 45%; overflow-y: auto; padding: 10px 6px 0; border-top: 1px solid var(--rsb-border); scrollbar-width: thin; }
.rsb-schedule { display: flex; align-items: center; gap: 8px; color: var(--rsb-muted); font-size: 12px; }
.rsb-scheduleText { display: flex; flex-direction: column; min-width: 0; }
.rsb-scheduleText strong { color: var(--rsb-fg); font-weight: 500; font-variant-numeric: tabular-nums; }

/* ===== Workspace chrome ===== */
.rsb-workspace { display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; border-left: 1px solid var(--rsb-border); background: var(--rsb-canvas); overflow: hidden; }
.rsb-listPane { display: flex; flex-direction: column; flex: 0 0 44%; min-width: 300px; min-height: 0; container: rsb-list / inline-size; }
.rsb-readingPane { display: flex; flex-direction: column; flex: 1 1 0; min-width: 0; min-height: 0; border-left: 1px solid var(--rsb-border); }
.rsb-readerPlaceholder { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 32px; color: var(--rsb-muted); }
.rsb-readerPlaceholder > .rsb-icon { margin-bottom: 4px; opacity: .45; }
.rsb-readerPlaceholder .rsb-emptyHint { margin-bottom: 0; }
.rsb-listPane .rsb-header { padding-inline: 14px; }
.rsb-listPane .rsb-navRow { gap: 8px; padding: 10px 14px; }
.rsb-listPane .rsb-search { width: 100%; }
.rsb-listPane .rsb-navFilters { width: 100%; margin-left: 0; gap: 8px 14px; }
.rsb-listPane .rsb-tagFilter { flex: 1 1 100px; }
.rsb-listPane .rsb-tagFilter .rsb-select { width: 100%; }
.rsb-listPane .rsb-listHeading { padding: 10px 14px; gap: 6px; }
.rsb-listPane .rsb-listTitle { flex: 1; min-width: 0; overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
.rsb-listPane .rsb-listHeading > .rsb-actions { gap: 8px; }
.rsb-listPane .rsb-listCount { font-size: 11px; }
.rsb-listPane .rsb-footer { padding-inline: 14px; font-size: 11px; }
.rsb-header { display: flex; align-items: center; justify-content: space-between; flex: none; gap: 16px; min-height: 48px; padding: 6px 20px; border-bottom: 1px solid var(--rsb-border); }
.rsb-titleRow { display: flex; align-items: center; gap: 12px; min-width: 0; }
.rsb-titleRow > .rsb-icon { display: none; }
.rsb-title { margin: 0; font-size: 16px; font-weight: 700; line-height: 1.5; }
.rsb-actions { display: flex; align-items: center; flex: none; gap: 8px; }
.rsb-navRow { display: flex; align-items: center; flex: none; flex-wrap: wrap; gap: 8px 12px; padding: 8px 20px; border-bottom: 1px solid var(--rsb-border); }
.rsb-latestHint { color: var(--rsb-muted); font-size: 12.5px; }
.rsb-navFilters { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 14px; min-width: 0; margin-left: auto; }

/* Buttons */
.rsb-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 12px; border: 1px solid transparent; border-radius: var(--rsb-radius); background: transparent; color: var(--rsb-fg); font: inherit; font-size: 13px; font-weight: 500; white-space: nowrap; text-decoration: none; cursor: pointer; transition: background-color var(--rsb-ease), border-color var(--rsb-ease), color var(--rsb-ease); }
.rsb-btn--outline { border-color: var(--rsb-border); background: var(--rsb-canvas); }
.rsb-btn--outline:hover:not(:disabled) { border-color: var(--rsb-border-strong); background: var(--rsb-hover); }
.rsb-btn--ghost { color: var(--rsb-muted); }
.rsb-btn--ghost:hover:not(:disabled) { background: var(--rsb-hover); color: var(--rsb-fg); }
.rsb-btn--default { background: var(--rsb-fg); color: var(--rsb-canvas); }
.rsb-btn--default:hover:not(:disabled) { background: color-mix(in srgb, var(--rsb-fg) 86%, var(--rsb-canvas)); }
.rsb-btn--sm { height: 28px; padding: 0 10px; font-size: 12.5px; }
.rsb-btn--icon { width: 32px; padding: 0; }
.rsb-btn--icon.rsb-btn--sm { width: 28px; }

/* Inputs */
.rsb-search { position: relative; display: flex; align-items: center; width: 260px; min-width: 150px; max-width: 100%; }
.rsb-searchIcon { position: absolute; left: 10px; color: var(--rsb-muted); pointer-events: none; }
.rsb-input { width: 100%; height: 32px; padding: 0 30px; border: 1px solid transparent; border-radius: var(--rsb-radius); background: var(--rsb-fill); color: var(--rsb-fg); font: inherit; font-size: 13px; transition: background-color var(--rsb-ease), border-color var(--rsb-ease); }
.rsb-input:hover { background: color-mix(in srgb, var(--rsb-fg) 9%, transparent); }
.rsb-input:focus { outline: 0; border-color: var(--rsb-border-strong); background: var(--rsb-canvas); box-shadow: 0 0 0 3px color-mix(in srgb, var(--rsb-focus) 18%, transparent); }
.rsb-input::placeholder { color: var(--rsb-muted); }
.rsb-input::-webkit-search-cancel-button { display: none; }
.rsb-searchClear { position: absolute; right: 5px; display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--rsb-muted); cursor: pointer; }
.rsb-searchClear:hover { background: var(--rsb-active); color: var(--rsb-fg); }
.rsb-select { height: 32px; padding: 0 8px; border: 1px solid var(--rsb-border); border-radius: var(--rsb-radius); background: var(--rsb-canvas); color: var(--rsb-fg); font: inherit; font-size: 13px; }
select.rsb-select { cursor: pointer; }
.rsb-select:hover:not(:disabled) { border-color: var(--rsb-border-strong); }
.rsb-select:disabled { opacity: .55; cursor: default; }
.rsb-tagFilter { display: flex; align-items: center; gap: 2px; min-width: 0; max-width: 100%; }
.rsb-tagFilter .rsb-select { width: 180px; min-width: 0; max-width: 100%; text-overflow: ellipsis; }

/* Switch */
.rsb-switch { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0; border: 0; background: transparent; color: var(--rsb-muted); font: inherit; font-size: 13px; white-space: nowrap; cursor: pointer; transition: color var(--rsb-ease); }
.rsb-switch:hover, .rsb-switch[aria-checked="true"] { color: var(--rsb-fg); }
.rsb-switchTrack { position: relative; flex: none; width: 28px; height: 16px; border-radius: 999px; background: var(--rsb-border-strong); transition: background-color var(--rsb-ease); }
.rsb-switch[aria-checked="true"] .rsb-switchTrack { background: var(--rsb-accent); }
.rsb-switchThumb { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--rsb-canvas); box-shadow: 0 1px 2px rgba(0, 0, 0, .25); transition: transform var(--rsb-ease); }
.rsb-switch[aria-checked="true"] .rsb-switchThumb { transform: translateX(12px); }
.rsb-switchCount { padding: 0 6px; border-radius: 999px; background: var(--rsb-fill); color: var(--rsb-muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.rsb-switch[aria-checked="true"] .rsb-switchCount { background: var(--rsb-accent-soft); color: var(--rsb-accent-text); }

/* ===== List ===== */
.rsb-content { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; }
.rsb-content > .rsb-banner { margin: 12px 20px 0; }
.rsb-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 0 16px; scrollbar-width: thin; }
.rsb-report > :is(.rsb-banner, .rsb-running, .rsb-warning, .rsb-feedErrors) { margin-left: 20px; margin-right: 20px; }
.rsb-report > :is(.rsb-banner, .rsb-running):first-child { margin-top: 14px; }
.rsb-listHeading { position: sticky; top: 0; z-index: 3; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin: 0; padding: 12px 20px; border-bottom: 1px solid var(--rsb-border); background: color-mix(in srgb, var(--rsb-canvas) 90%, transparent); backdrop-filter: saturate(1.4) blur(10px); }
.rsb-listHeading > .rsb-actions { flex-wrap: wrap; }
.rsb-listTitle { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -.01em; }
.rsb-listCount { color: var(--rsb-muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
.rsb-section { margin: 0; scroll-margin-top: 16px; }
.rsb-sectionHead { display: none; }
.rsb-sortLabel { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; color: var(--rsb-muted); font-size: 12px; white-space: nowrap; }
.rsb-loadMore { display: flex; justify-content: center; padding: 16px 0 24px; }

.rsb-item { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 18px; row-gap: 4px; padding: 14px 20px 14px 34px; transition: background-color var(--rsb-ease); }
.rsb-item::after { content: ""; position: absolute; left: 34px; right: 20px; bottom: 0; border-bottom: 1px solid var(--rsb-divider); pointer-events: none; }
.rsb-item:hover { background: color-mix(in srgb, var(--rsb-fg) 4%, transparent); }
.rsb-item[data-read="false"]::before { content: ""; position: absolute; top: 23px; left: 17px; width: 7px; height: 7px; border-radius: 50%; background: var(--rsb-accent); }
.rsb-itemTitle { grid-column: 1; margin: 0; }
.rsb-itemTitleButton { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 0; border: 0; background: none; color: var(--rsb-fg); font: inherit; font-size: 15px; font-weight: 600; line-height: 1.45; text-align: left; cursor: pointer; overflow-wrap: anywhere; transition: color var(--rsb-ease); }
.rsb-itemTitleButton:hover:not(:disabled) { color: var(--rsb-accent-text); }
.rsb-itemTitleText { flex: 1; min-width: 0; }
.rsb-feedIcon { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 20px; width: 20px; height: 22px; }
.rsb-feedIcon img { display: block; width: 18px; height: 18px; border-radius: 4px; object-fit: contain; }
.rsb-feedInitial { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 5px; background: var(--rsb-fill); color: var(--rsb-muted); font-size: 11px; font-weight: 600; line-height: 1; }
.rsb-feedName { display: none; }
.rsb-summary { grid-column: 1; max-width: 90ch; margin: 2px 0 0 30px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--rsb-muted); font-size: 13.5px; line-height: 1.6; overflow-wrap: anywhere; }
.rsb-meta { grid-column: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 2px; color: var(--rsb-muted); font-size: 12px; line-height: 1.6; }
.rsb-item > .rsb-meta, .rsb-item > .rsb-tags { margin-left: 30px; }
.rsb-metaItem { display: inline-flex; align-items: center; gap: 4px; }
.rsb-item[data-read="true"] .rsb-itemTitleButton { color: var(--rsb-muted); font-weight: 500; }
.rsb-item[data-read="true"] .rsb-itemTitleButton:hover:not(:disabled) { color: var(--rsb-fg); }
.rsb-item[data-read="true"] .rsb-summary { opacity: .65; }
.rsb-itemActions { grid-column: 2; grid-row: 1 / span 4; display: flex; align-items: flex-start; gap: 6px; padding-top: 1px; opacity: 0; transition: opacity var(--rsb-ease); }
.rsb-item:hover .rsb-itemActions, .rsb-item:focus-within .rsb-itemActions { opacity: 1; }
@media (hover: none) { .rsb-itemActions { opacity: 1; } }
.rsb-readToggle { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: var(--rsb-radius-sm); background: transparent; color: var(--rsb-muted); cursor: pointer; }
.rsb-readToggle:hover:not(:disabled) { background: var(--rsb-hover); color: var(--rsb-fg); }
.rsb-readToggle[aria-pressed="true"] { color: var(--rsb-success); }

/* Pills: badges, tags and chips share one shape. */
.rsb-badge, .rsb-readerChip, .rsb-readerSource { display: inline-flex; align-items: center; padding: 0 8px; border: 0; border-radius: 999px; background: var(--rsb-fill); color: var(--rsb-muted); font-size: 12px; line-height: 1.7; white-space: nowrap; }
.rsb-readerChip--brand { background: var(--rsb-accent-soft); color: var(--rsb-accent-text); font-weight: 500; }
.rsb-score { color: var(--rsb-fg); font-variant-numeric: tabular-nums; }
.rsb-qualityBadge { background: color-mix(in srgb, var(--rsb-success) 13%, transparent); color: var(--rsb-success); font-weight: 500; }
.rsb-tags { grid-column: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
.rsb-tag { max-width: 100%; padding: 1px 8px; border: 1px solid transparent; border-radius: 999px; background: var(--rsb-fill); color: var(--rsb-muted); font: inherit; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; cursor: pointer; transition: background-color var(--rsb-ease), color var(--rsb-ease); }
.rsb-tag:hover { background: var(--rsb-accent-soft); color: var(--rsb-accent-text); }
.rsb-tag[data-kind="format"] { border-color: var(--rsb-border-strong); border-style: dashed; background: transparent; color: var(--rsb-fg); }
.rsb-tag[data-kind="format"]:hover { border-color: var(--rsb-accent); }
.rsb-tagMore { flex: none; color: var(--rsb-muted); font-size: 12px; }

.rsb-inline { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: transparent; color: var(--rsb-muted); font: inherit; font-size: 13px; text-decoration: none; cursor: pointer; transition: color var(--rsb-ease); }
.rsb-inline:hover:not(:disabled) { color: var(--rsb-fg); }
.rsb-inline--brand { color: var(--rsb-accent-text); font-weight: 500; }
.rsb-inline--brand:hover:not(:disabled) { color: var(--rsb-accent); }

/* Status surfaces */
.rsb-running, .rsb-banner { margin-bottom: 14px; padding: 11px 14px; border: 1px solid var(--rsb-border); border-radius: var(--rsb-radius); background: var(--rsb-surface); font-size: 13px; }
.rsb-banner[role="alert"] { border-color: color-mix(in srgb, var(--rsb-error) 35%, var(--rsb-border)); background: color-mix(in srgb, var(--rsb-error) 6%, var(--rsb-canvas)); }
.rsb-banner[role="alert"] .rsb-bannerTitle { color: var(--rsb-error); }
.rsb-runningText { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 8px; color: var(--rsb-muted); }
.rsb-progress { height: 3px; border-radius: 3px; background: var(--rsb-fill); overflow: hidden; }
.rsb-progressBar { height: 100%; background: var(--rsb-accent); transition: width .2s; }
.rsb-bannerTitle { display: block; margin-bottom: 4px; font-weight: 600; }
.rsb-warning { margin: 0 0 12px; padding-left: 10px; border-left: 2px solid var(--rsb-border-strong); color: var(--rsb-muted); font-size: 13px; line-height: 1.65; }
.rsb-empty { padding: 72px 20px; color: var(--rsb-muted); text-align: center; }
.rsb-emptyGlyph { display: inline-flex; align-items: center; justify-content: center; width: 72px; height: 72px; margin-bottom: 16px; border-radius: 50%; background: var(--rsb-fill); color: var(--rsb-muted); }
.rsb-emptyGlyph > .rsb-icon { width: 30px; height: 30px; }
.rsb-emptyTitle { margin: 0 0 6px; color: var(--rsb-fg); font-size: 15px; font-weight: 600; }
.rsb-emptyHint { max-width: 46ch; margin: 0 auto 18px; font-size: 13px; line-height: 1.65; }
.rsb-emptyActions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.rsb-feedErrors { margin: 20px 0; color: var(--rsb-muted); font-size: 13px; }
.rsb-feedErrors summary { cursor: pointer; }
.rsb-feedErrors summary svg { display: inline-block; margin-right: 4px; vertical-align: -2px; }
.rsb-feedErrors ul { padding: 0; list-style: none; }
.rsb-feedErrors li { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.rsb-feedErrors a { color: inherit; }
.rsb-loading, .rsb-readerLoading { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 60px 0; color: var(--rsb-muted); }
.rsb-footer { display: flex; align-items: center; justify-content: space-between; flex: none; gap: 12px; padding: 6px 20px; border-top: 1px solid var(--rsb-border); color: var(--rsb-muted); font-size: 12px; font-variant-numeric: tabular-nums; }

/* Assessment details */
.rsb-details { margin-top: 12px; color: var(--rsb-muted); font-size: 13px; }
.rsb-details dl { margin: 10px 0 0; }
.rsb-details dt { margin-top: 8px; font-weight: 600; }
.rsb-details dd { margin: 3px 0 0; overflow-wrap: anywhere; }
.rsb-compactScore { flex: 0 0 36px; color: var(--rsb-muted); font-size: 12px; font-weight: 400; text-align: right; font-variant-numeric: tabular-nums; }
.rsb-compactScore[data-high="true"] { color: var(--rsb-success); font-weight: 650; }
.rsb-assessment { margin: 0 0 18px; padding: 0; }
.rsb-assessment > .rsb-details { margin: 0; }
.rsb-assessment > .rsb-details[open] { padding: 4px 14px 12px; border-radius: var(--rsb-radius); background: color-mix(in srgb, var(--rsb-fg) 3%, transparent); }
.rsb-assessmentSummary { display: flex; align-items: center; gap: 8px; min-height: 28px; list-style: none; cursor: pointer; }
.rsb-assessmentSummary::-webkit-details-marker { display: none; }
.rsb-assessmentSummary > .rsb-meta { margin: 0; font-size: 12px; }
.rsb-assessmentExpand { display: inline-flex; color: var(--rsb-muted); transition: transform var(--rsb-ease); }
.rsb-assessment .rsb-details[open] .rsb-assessmentExpand { transform: rotate(90deg); }
.rsb-assessmentReason { margin: 10px 0 0; color: var(--rsb-fg); font-size: 14px; line-height: 1.75; overflow-wrap: anywhere; }
.rsb-assessment .rsb-details p { margin: 8px 0; overflow-wrap: anywhere; }
.rsb-dimensions { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 16px; }
.rsb-details .rsb-dimensions :is(dt, dd) { margin: 0; }
.rsb-dimensions dd { font-variant-numeric: tabular-nums; }

/* Compact mode: one dense row per article. */
.rsb-root[data-compact="true"] .rsb-item { grid-template-columns: minmax(0, 1fr) auto; column-gap: 0; row-gap: 0; padding: 0; }
.rsb-root[data-compact="true"] .rsb-item::before { display: none; }
.rsb-root[data-compact="true"] .rsb-item::after { left: 12px; right: 12px; }
.rsb-root[data-compact="true"] .rsb-item:hover, .rsb-root[data-compact="true"] .rsb-item:focus-within { background: color-mix(in srgb, var(--rsb-fg) 5%, transparent); }
.rsb-root[data-compact="true"] .rsb-itemTitle { min-width: 0; }
.rsb-root[data-compact="true"] .rsb-itemTitleButton { align-items: center; gap: 8px; height: 36px; padding: 0 12px; font-size: 13px; font-weight: 500; line-height: 1.4; white-space: nowrap; overflow: hidden; }
.rsb-root[data-compact="true"] .rsb-item::after { display: none; }
.rsb-root[data-compact="true"] .rsb-item[data-selected="true"] { background: var(--rsb-active); box-shadow: inset 2px 0 var(--rsb-accent); }
.rsb-root[data-compact="true"] .rsb-item[data-selected="true"] .rsb-itemTitleText { color: var(--rsb-fg); font-weight: 600; }
.rsb-root[data-compact="true"] .rsb-itemTitleButton:hover:not(:disabled) { color: var(--rsb-fg); }
.rsb-root[data-compact="true"] .rsb-itemTitleButton:focus-visible { outline-offset: -2px; border-radius: 0; }
.rsb-root[data-compact="true"] .rsb-feedIcon { height: 20px; }
.rsb-root[data-compact="true"] .rsb-feedName { display: block; flex: 0 0 auto; max-width: 150px; overflow: hidden; text-overflow: ellipsis; color: var(--rsb-fg); font-weight: 650; }
.rsb-root[data-compact="true"] .rsb-itemTitleText { flex: 0 1 auto; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.rsb-root[data-compact="true"] .rsb-item[data-read="true"] .rsb-itemTitleButton { font-weight: 400; }
.rsb-root[data-compact="true"] .rsb-item[data-read="true"] :is(.rsb-feedName, .rsb-itemTitleText) { color: var(--rsb-muted); font-weight: 400; }
.rsb-root[data-compact="true"] .rsb-item > :is(.rsb-summary, .rsb-meta, .rsb-itemActions) { display: none; }
.rsb-root[data-compact="true"] .rsb-item > .rsb-tags { grid-column: 2; grid-row: 1; flex-wrap: nowrap; max-width: min(32cqw, 240px); margin-left: 0; padding-right: 14px; }
.rsb-root[data-compact="true"] .rsb-tag { min-width: 0; max-width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rsb-unreadDot { flex: 0 0 6px; width: 6px; height: 6px; border-radius: 50%; background: var(--rsb-success); }
.rsb-item[data-read="true"] .rsb-unreadDot { visibility: hidden; }
.rsb-inlineSummary { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--rsb-muted); font-size: 13px; font-weight: 400; }
.rsb-inlineTime { flex: 0 0 56px; margin-left: auto; color: var(--rsb-muted); font-size: 12px; font-weight: 400; text-align: right; font-variant-numeric: tabular-nums; }

/* ===== Reader ===== */
.rsb-readerShell { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.rsb-readerHeader { position: relative; z-index: 5; flex: none; border-bottom: 1px solid var(--rsb-border); background: var(--rsb-canvas); }
.rsb-readerHeaderInner { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 6px 14px; }
.rsb-readerHeaderInner > .rsb-readerHeaderEnd { flex: 1; margin-left: auto; }
.rsb-readerHeaderEnd :is(.rsb-publicationButton, .rsb-readerButton) { width: 30px; height: 30px; justify-content: center; padding: 0; border-color: transparent; font-size: 0; }
.rsb-readerHeaderEnd .rsb-publicationButton:hover:not(:disabled) { background: var(--rsb-hover); }
.rsb-readerHeaderStart { justify-content: center; width: 28px; height: 30px; padding: 0; }
.rsb-readerHeaderEnd .rsb-shareControl { display: flex; }
.rsb-readerHeaderInner > :first-child { justify-self: start; }
.rsb-readerHeaderEnd { display: flex; align-items: center; justify-content: flex-end; justify-self: end; gap: 8px; min-width: 0; }
.rsb-readerHeaderEnd .rsb-btn { min-width: 0; }
.rsb-readerNav { display: flex; align-items: center; justify-self: center; gap: 2px; }
.rsb-readerNav .rsb-btn { color: var(--rsb-muted); }
.rsb-readerButton { display: inline-flex; align-items: center; flex: none; gap: 6px; padding: 5px 8px 5px 4px; border: 0; border-radius: var(--rsb-radius-sm); background: none; color: var(--rsb-muted); font: inherit; font-size: 13px; white-space: nowrap; text-decoration: none; cursor: pointer; transition: background-color var(--rsb-ease), color var(--rsb-ease); }
.rsb-readerButton:hover { background: var(--rsb-hover); color: var(--rsb-fg); }
.rsb-readerPosition { min-width: 52px; color: var(--rsb-muted); font-size: 12.5px; text-align: center; font-variant-numeric: tabular-nums; }
.rsb-readerProgress { flex: none; height: 2px; background: transparent; }
.rsb-readerProgressBar { height: 100%; background: var(--rsb-accent); }
.rsb-publicationButton { height: auto; min-height: 32px; white-space: nowrap; text-align: left; }
.rsb-publicationStatus { padding: 0 20px 10px; color: var(--rsb-muted); font-size: 13px; overflow-wrap: anywhere; }
.rsb-publicationStatus p { margin: 0 0 6px; }
.rsb-publicationStatus dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; margin: 6px 0 0; }
.rsb-publicationStatus dt { font-weight: 500; }
.rsb-publicationStatus dd { margin: 0; user-select: text; }
.rsb-publicationStatus .rsb-inline { margin-top: 4px; }
/* Share task details float under the share button. */
.rsb-shareControl { position: relative; min-width: 0; max-width: 100%; }
.rsb-shareControl .rsb-publicationStatus { position: absolute; top: calc(100% + 8px); right: 0; z-index: 20; width: min(440px, 70vw); padding: 12px 14px; border: 1px solid var(--rsb-border); border-radius: var(--rsb-radius-lg); background: var(--rsb-surface); box-shadow: var(--rsb-shadow-pop); font-size: 12px; line-height: 1.6; }
.rsb-shareControl .rsb-publicationStatus dl { gap: 3px 12px; }
.rsb-shareControl .rsb-publicationStatus dt { color: var(--rsb-muted); white-space: nowrap; }
.rsb-shareControl .rsb-publicationStatus dd { color: var(--rsb-fg); font-family: var(--rsb-mono); font-size: 11.5px; }
.rsb-shareControl:not(:hover):not(:focus-within) .rsb-publicationStatus:not(:has(.rsb-dialogError)) { display: none; }

.rsb-readerScroll { flex: 1; min-height: 0; overflow-y: auto; padding: 44px clamp(24px, 3.5cqw, 64px) 100px; scroll-behavior: smooth; scrollbar-width: thin; }
.rsb-reader { max-width: 760px; margin: 0 auto; }
.rsb-readerTitle { margin: 0 0 14px; font-size: 32px; font-weight: 700; line-height: 1.3; letter-spacing: -.022em; text-wrap: balance; }
.rsb-reader > .rsb-tags { margin-block: 10px 14px; }
.rsb-readerMeta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin-bottom: 20px; padding-bottom: 18px; border-bottom: 1px solid var(--rsb-border); color: var(--rsb-muted); font-size: 13px; }
.rsb-readerStatus { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 14px; color: var(--rsb-muted); font-size: 13px; }
.rsb-readerStatus .rsb-inline { margin-left: auto; }
.rsb-readerSummary { margin: 0 0 36px; padding: 14px 18px 16px; border-left: 3px solid var(--rsb-accent); border-radius: 0 var(--rsb-radius) var(--rsb-radius) 0; background: color-mix(in srgb, var(--rsb-accent) 5%, var(--rsb-canvas)); }
.rsb-readerSummary > summary { color: var(--rsb-accent-text); font-size: 12.5px; font-weight: 600; letter-spacing: .02em; cursor: pointer; }
.rsb-readerSummary[open] > summary { margin-bottom: 8px; }
.rsb-readerSummaryText { margin: 0; color: color-mix(in srgb, var(--rsb-fg) 88%, transparent); font-size: 15.5px; line-height: 1.85; }
.rsb-readerNote, .rsb-readerError { margin-bottom: 20px; padding: 12px 14px; border: 1px solid var(--rsb-border); border-radius: var(--rsb-radius); background: var(--rsb-surface); color: var(--rsb-muted); font-size: 13.5px; }
.rsb-readerNote > strong { color: var(--rsb-fg); }
.rsb-readerNote p, .rsb-readerError p { margin: 5px 0; }
.rsb-readerError { border-color: color-mix(in srgb, var(--rsb-error) 40%, var(--rsb-border)); background: color-mix(in srgb, var(--rsb-error) 5%, var(--rsb-canvas)); }
.rsb-readerErrorTitle { color: var(--rsb-error); }
.rsb-readerActions { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.rsb-readerEmpty { color: var(--rsb-muted); }
.rsb-readerPager { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--rsb-border); }
.rsb-readerKeys { color: var(--rsb-muted); font-size: 12px; }
.rsb-readerFooter { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-top: 20px; color: var(--rsb-muted); font-size: 12.5px; }
.rsb-readerFooter a { color: inherit; text-underline-offset: 3px; }
.rsb-readerFooter a:hover { color: var(--rsb-accent-text); }

/* Article prose */
.rsb-prose { color: color-mix(in srgb, var(--rsb-fg) 90%, transparent); font-size: 17px; line-height: 1.82; letter-spacing: .005em; overflow-wrap: anywhere; text-wrap: pretty; }
.rsb-prose p { margin: 0 0 1.25em; font-size: inherit; line-height: inherit; }
.rsb-prose--plain p { white-space: pre-wrap; }
.rsb-prose :is(h1,h2,h3,h4,h5,h6) { margin: 2em 0 .7em; color: var(--rsb-fg); font-weight: 600; line-height: 1.35; letter-spacing: -.01em; text-wrap: balance; }
.rsb-prose h1 { font-size: 1.6em; }
.rsb-prose h2 { font-size: 1.38em; font-weight: 700; }
.rsb-prose h3 { font-size: 1.17em; }
.rsb-prose :is(h4,h5,h6) { font-size: 1.05em; }
.rsb-prose :is(ul,ol) { margin: 0 0 1.15em; padding-left: 1.5em; }
.rsb-prose li { margin-bottom: .35em; }
.rsb-prose li::marker { color: var(--rsb-muted); }
.rsb-prose li > p { margin-bottom: .4em; }
.rsb-prose strong { color: var(--rsb-fg); }
.rsb-prose a { color: inherit; text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--rsb-accent) 55%, transparent); text-decoration-thickness: 1.5px; text-underline-offset: 4px; transition: color var(--rsb-ease), text-decoration-color var(--rsb-ease); }
.rsb-prose a:hover { color: var(--rsb-accent-text); text-decoration-color: currentColor; }
.rsb-prose blockquote { margin: 1.6em 0; padding: .2em 1.1em; border-left: 3px solid var(--rsb-accent); color: color-mix(in srgb, var(--rsb-fg) 75%, transparent); font-style: normal; }
.rsb-prose blockquote > :last-child { margin-bottom: 0; }
.rsb-prose pre { max-width: 100%; overflow-x: auto; padding: 16px; border-radius: 10px; background: color-mix(in srgb, var(--rsb-fg) 5%, transparent); font-size: 13.5px; line-height: 1.6; white-space: pre; overflow-wrap: normal; tab-size: 4; }
.rsb-prose code { padding: .1em .35em; border-radius: 4px; background: var(--rsb-fill); font-family: var(--rsb-mono); font-size: .86em; }
.rsb-prose pre code { padding: 0; background: transparent; font-size: inherit; }
.rsb-tableScroll { max-width: 100%; margin: 1.2em 0; overflow-x: auto; }
.rsb-prose table { min-width: 100%; border-collapse: collapse; font-size: 14.5px; line-height: 1.65; }
.rsb-prose :is(th,td) { min-width: 80px; padding: 8px 12px; border: 1px solid var(--rsb-border); vertical-align: top; }
.rsb-prose th { background: var(--rsb-surface); font-weight: 600; text-align: left; }
.rsb-prose figure { margin: 1.5em 0; }
.rsb-prose img { display: block; max-width: 100%; height: auto; margin: 1.4em auto; border-radius: 10px; }
.rsb-prose img.rsb-inlineImage { display: inline-block; width: auto; max-width: 1.25em; height: 1.25em; margin: 0 .1em; vertical-align: -.2em; border-radius: 0; }
.rsb-prose p:has(> img.rsb-inlineImage) { overflow-wrap: anywhere; }
.rsb-prose figcaption { color: var(--rsb-muted); font-size: 13px; line-height: 1.65; text-align: center; }
.rsb-prose hr { margin: 2em 0; border: 0; border-top: 1px solid var(--rsb-border); }
.rsb-prose ::selection, .rsb-readerTitle::selection { background: color-mix(in srgb, var(--rsb-accent) 35%, transparent); }
.rsb-imageFallback { display: block; margin: 12px 0; padding: 16px; border: 1px dashed var(--rsb-border); border-radius: var(--rsb-radius); color: var(--rsb-muted); font-size: 14px; }
.rsb-imageFallback a { margin-left: 8px; }
.rsb-videoCard { display: flex; align-items: center; gap: 14px; margin: 1.4em 0; padding: 10px; border: 1px solid var(--rsb-border); border-radius: var(--rsb-radius-lg); background: color-mix(in srgb, var(--rsb-fg) 4%, transparent); color: inherit; line-height: 1.5; text-decoration: none !important; transition: border-color var(--rsb-ease), background-color var(--rsb-ease); }
.rsb-videoCard:hover { border-color: var(--rsb-accent); background: color-mix(in srgb, var(--rsb-accent) 7%, transparent); color: inherit !important; }
.rsb-videoThumb { position: relative; display: grid; place-items: center; flex: none; width: 160px; aspect-ratio: 16 / 9; border-radius: var(--rsb-radius); background: color-mix(in srgb, var(--rsb-fg) 10%, transparent) center / cover no-repeat; }
.rsb-videoPlay { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 999px; background: rgba(0, 0, 0, .55); color: #fff; }
.rsb-videoText { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.rsb-videoTitle { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--rsb-fg); font-size: 15px; font-weight: 600; text-overflow: ellipsis; }
.rsb-videoMeta { display: inline-flex; align-items: center; gap: 5px; color: var(--rsb-muted); font-size: 13px; }

/* ===== Dialogs ===== */
.rsb-overlay { position: absolute; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; padding: 24px; background: color-mix(in srgb, #000 40%, transparent); backdrop-filter: blur(2px); }
.rsb-dialog { display: flex; flex-direction: column; width: min(440px, 100%); max-height: 100%; border: 1px solid var(--rsb-border); border-radius: var(--rsb-radius-lg); background: var(--rsb-canvas); box-shadow: 0 24px 60px rgba(0, 0, 0, .3); overflow: hidden; }
.rsb-dialogHead { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px 14px; border-bottom: 1px solid var(--rsb-border); }
.rsb-dialogHeadText { flex: 1; min-width: 0; }
.rsb-dialogTitle { margin: 0; font-size: 16px; font-weight: 650; line-height: 1.5; }
.rsb-dialogSubtitle { margin: 3px 0 0; color: var(--rsb-muted); font-size: 13px; }
.rsb-dialogBody { display: flex; flex-direction: column; gap: 12px; padding: 16px 20px; overflow-y: auto; }
.rsb-dialogFoot { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--rsb-border); background: var(--rsb-surface); }
.rsb-choice { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--rsb-border); border-radius: var(--rsb-radius); cursor: pointer; transition: border-color var(--rsb-ease), background-color var(--rsb-ease); }
.rsb-choice:hover { border-color: var(--rsb-border-strong); }
.rsb-choice[data-active="true"] { border-color: var(--rsb-accent); background: var(--rsb-accent-soft); }
.rsb-choice[data-disabled="true"] { cursor: default; opacity: .6; }
.rsb-choice input { margin: 3px 0 0; accent-color: var(--rsb-accent); }
.rsb-choiceText { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.rsb-choiceTitle { font-size: 14px; font-weight: 500; }
.rsb-choiceHint { color: var(--rsb-muted); font-size: 12px; }
.rsb-field { display: flex; flex-direction: column; gap: 5px; }
.rsb-fieldLabel { color: var(--rsb-muted); font-size: 13px; }
.rsb-dialog .rsb-input { padding-inline: 10px; border-color: var(--rsb-border); background: var(--rsb-canvas); }
.rsb-dialog .rsb-input:hover { border-color: var(--rsb-border-strong); }
.rsb-note { margin: 0; padding: 10px 12px; border-radius: var(--rsb-radius); background: color-mix(in srgb, var(--rsb-fg) 4%, transparent); color: var(--rsb-muted); font-size: 13px; }
.rsb-note strong { color: var(--rsb-fg); font-weight: 600; }
.rsb-dialogError { margin: 0; color: var(--rsb-error); font-size: 13px; }
.rsb-dialogOk { margin: 0; color: var(--rsb-success); font-size: 13px; }
.rsb-dialogLoading { display: flex; align-items: center; gap: 8px; color: var(--rsb-muted); font-size: 13px; }
.rsb-settingsSection { display: flex; flex-direction: column; gap: 10px; padding-block: 14px; border-block: 1px solid var(--rsb-border); }
.rsb-settingsSection h3 { margin: 0; }
.rsb-settingsSection .rsb-note { overflow-wrap: anywhere; }

/* Preferences */
.rsb-preferences { width: min(760px, 100%); height: min(680px, 100%); color: var(--rsb-fg); }
.rsb-preferences .rsb-dialogHead { flex-shrink: 0; padding: 20px 24px 16px; }
.rsb-preferencesLayout { display: grid; grid-template-columns: 172px minmax(0, 1fr); flex: 1; min-height: 0; }
.rsb-preferencesNav { display: flex; flex-direction: column; gap: 2px; padding: 16px 10px; border-right: 1px solid var(--rsb-border); background: var(--rsb-surface); }
.rsb-preferencesTab { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border: 0; border-radius: var(--rsb-radius); background: transparent; color: var(--rsb-muted); font: inherit; font-size: 13px; text-align: left; cursor: pointer; transition: background-color var(--rsb-ease), color var(--rsb-ease); }
.rsb-preferencesTab:hover { background: var(--rsb-hover); color: var(--rsb-fg); }
.rsb-preferencesTab[aria-current] { background: var(--rsb-accent-soft); color: var(--rsb-fg); font-weight: 600; }
.rsb-preferencesTab:disabled { cursor: default; opacity: .6; }
.rsb-subscriptionsLink { margin-top: auto; padding-top: 14px; border-top: 1px solid var(--rsb-border); border-radius: 0; }
.rsb-dirtyDot { margin-left: auto; color: var(--rsb-accent); }
.rsb-preferencesContent { min-width: 0; overflow-y: auto; padding: 24px; scrollbar-gutter: stable; }
.rsb-preferencesContent [hidden] { display: none !important; }
.rsb-preferencesContent .rsb-settingsSection, .rsb-preferencesContent form.rsb-field, .rsb-creationFields { display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 0; border: 0; }
.rsb-preferencesContent .rsb-choiceTitle { margin: 0; font-size: 15px; font-weight: 600; }
.rsb-preferencesContent .rsb-choiceHint { margin: 0; line-height: 1.65; overflow-wrap: anywhere; }
.rsb-preferencesContent .rsb-field { gap: 7px; }
.rsb-preferencesContent .rsb-select { width: 100%; min-width: 0; min-height: 38px; padding-inline: 10px; }
.rsb-preferencesContent .rsb-input { height: 38px; }
.rsb-preferencesContent input[type="number"] { max-width: 180px; }
.rsb-preferencesContent .rsb-note { line-height: 1.65; overflow-wrap: anywhere; }
.rsb-preferencesContent form > button[type="submit"], .rsb-settingsActions { align-self: flex-end; margin-top: 8px; }
.rsb-preferencesContent button[type="submit"], .rsb-settingsActions > button { min-height: 36px; padding-inline: 16px; }
.rsb-preferencesFoot { flex-shrink: 0; min-height: 60px; padding: 12px 24px; }
.rsb-saveHint { margin-right: auto; color: var(--rsb-muted); font-size: 12px; }
.rsb-leavePrompt { flex-basis: 100%; font-size: 13px; }
.rsb-modelGrid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.rsb-modelGrid > p { grid-column: 1 / -1; }
.rsb-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.rsb-presets button[aria-pressed="true"] { border-color: var(--rsb-accent); background: var(--rsb-accent-soft); color: var(--rsb-fg); }

/* Subscriptions */
.rsb-subscriptionsDialog { width: min(760px, 100%); }
.rsb-subscriptionsBody { min-height: 0; }
.rsb-subscriptionToolbar { display: flex; align-items: center; gap: 8px; }
.rsb-subscriptionToolbar > input { flex: 1; min-width: 0; }
.rsb-subscriptionEditor { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 14px; border: 1px solid var(--rsb-border); border-radius: var(--rsb-radius); background: var(--rsb-surface); }
.rsb-subscriptionEditor > h3, .rsb-subscriptionEditor > .rsb-actions { grid-column: 1 / -1; margin: 0; }
.rsb-subscriptionRemoval { padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--rsb-error) 35%, var(--rsb-border)); border-radius: var(--rsb-radius); background: color-mix(in srgb, var(--rsb-error) 5%, var(--rsb-canvas)); }
.rsb-subscriptionRemoval p { margin: 0 0 10px; line-height: 1.6; }
.rsb-subscriptionList { display: flex; flex-direction: column; }
.rsb-subscriptionRow { display: flex; align-items: center; gap: 10px; padding: 10px 4px; border-bottom: 1px solid var(--rsb-divider); }
.rsb-subscriptionRow:last-child { border-bottom: 0; }
.rsb-subscriptionInfo { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
.rsb-subscriptionInfo > strong { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.rsb-subscriptionInfo > span { overflow: hidden; color: var(--rsb-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.rsb-subscriptionRow > button { flex-shrink: 0; }

/* ===== Responsive ===== */
@container (max-width: 1100px) {
  .rsb-rail { flex-basis: 184px; width: 184px; }
  .rsb-item { grid-template-columns: minmax(0, 1fr); }
  .rsb-itemActions { grid-column: 1; grid-row: auto; align-items: center; margin-left: 30px; padding-top: 4px; }
}
@container (max-width: 800px) {
  .rsb-rail { flex-basis: 184px; width: 184px; }
  .rsb-brand { gap: 7px; padding-inline: 2px; }
  .rsb-brandCaption { display: none; }
  .rsb-railItem { gap: 6px; padding-inline: 8px; font-size: 13px; }
  .rsb-header, .rsb-navRow { padding-inline: 16px; }
  .rsb-latestHint { display: none; }
  .rsb-navFilters { flex: 1; margin-left: 0; }
  .rsb-search { flex: 1; width: auto; }
  .rsb-root[data-compact="true"] .rsb-feedName { max-width: 90px; }
  .rsb-readerHeaderInner { grid-template-columns: auto auto minmax(0, 1fr); gap: 8px; padding-inline: 14px; }
  .rsb-readerHeaderEnd .rsb-btn { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rsb-readerScroll { padding: 28px 22px 80px; }
  .rsb-readerTitle { font-size: 25px; }
  .rsb-readerKeys { display: none; }
  .rsb-prose { font-size: 16.5px; }
  .rsb-footer { padding-inline: 16px; }
}
@container (max-width: 700px) {
  .rsb-root[data-compact="true"] .rsb-inlineSummary { display: none; }
  .rsb-root[data-compact="true"] .rsb-itemTitleText { flex: 1; max-width: none; }
  .rsb-root[data-compact="true"] .rsb-item { grid-template-columns: minmax(0, 1fr); }
  .rsb-root[data-compact="true"] .rsb-item > .rsb-tags { grid-column: 1; grid-row: 2; max-width: 100%; padding: 0 14px 8px; }
}
@container (max-width: 680px) {
  .rsb-overlay:has(.rsb-preferences) { padding: 12px; }
  .rsb-preferences { height: min(760px, 100%); }
  .rsb-preferencesLayout { display: flex; flex-direction: column; }
  .rsb-preferencesNav { flex-direction: row; flex-wrap: wrap; gap: 4px; padding: 10px 14px; border-right: 0; border-bottom: 1px solid var(--rsb-border); }
  .rsb-subscriptionsLink { margin-top: 0; border: 0; }
  .rsb-preferencesContent { flex: 1; padding: 20px; }
  .rsb-preferences .rsb-dialogHead { padding: 16px 20px; }
  .rsb-preferencesFoot { padding: 10px 20px; }
}
@container (max-width: 560px) {
  .rsb-rail { flex-basis: 132px; width: 132px; gap: 12px; padding-inline: 6px; }
  .rsb-brandMark { display: none; }
  .rsb-brandName { font-size: 14px; }
  .rsb-railItem > .rsb-icon { display: none; }
  .rsb-railItem { gap: 3px; padding-inline: 6px; }
  .rsb-tagNavItem { padding-left: 6px; }
  .rsb-railLabel { white-space: normal; }
  .rsb-rail > .rsb-btn { padding: 0 6px; font-size: 13px; }
  .rsb-railFooter { padding-inline: 4px; }
  .rsb-header { flex-wrap: wrap; gap: 8px; padding: 10px 12px; }
  .rsb-actions { margin-left: auto; }
  .rsb-navRow { padding: 10px 12px; }
  .rsb-search { flex-basis: 100%; }
  .rsb-listHeading { padding-inline: 12px; }
  .rsb-report > :is(.rsb-banner, .rsb-running, .rsb-warning, .rsb-feedErrors) { margin-inline: 12px; }
  .rsb-item { padding: 12px 12px 12px 26px; }
  .rsb-item::after { left: 26px; right: 12px; }
  .rsb-item[data-read="false"]::before { top: 21px; left: 11px; }
  .rsb-item > :is(.rsb-summary, .rsb-meta, .rsb-tags, .rsb-itemActions) { margin-left: 0; }
  .rsb-root[data-compact="true"] .rsb-feedName { display: none; }
  .rsb-readerHeaderInner { display: flex; flex-wrap: wrap; }
  .rsb-readerHeaderEnd { flex-wrap: wrap; }
  .rsb-readerScroll { padding: 20px 14px 50px; }
  .rsb-readerTitle { font-size: 22px; }
  .rsb-footer { flex-wrap: wrap; gap: 4px; padding-inline: 12px; }
  .rsb-modelGrid { grid-template-columns: minmax(0, 1fr); }
  .rsb-subscriptionToolbar { flex-wrap: wrap; }
  .rsb-subscriptionToolbar > input { flex-basis: 100%; }
  .rsb-subscriptionEditor { grid-template-columns: minmax(0, 1fr); }
  .rsb-subscriptionRow { flex-wrap: wrap; }
  .rsb-subscriptionInfo { flex-basis: calc(100% - 40px); }
}
.rsb-columnDivider { position: relative; z-index: 6; flex: 0 0 6px; width: 6px; min-height: 0; outline-offset: -2px; cursor: col-resize; touch-action: none; user-select: none; background: var(--rsb-canvas); }
.rsb-columnDivider::before { content: ""; position: absolute; top: 0; bottom: 0; left: 2px; width: 1px; background: var(--rsb-border); }
.rsb-columnDivider::after { content: ""; position: absolute; top: calc(50% - 14px); left: 1px; width: 3px; height: 28px; border-radius: 3px; background: var(--rsb-border-strong); }
.rsb-columnDivider:is(:hover, :focus-visible, :active) { background: var(--rsb-hover); }
.rsb-columnDivider:is(:hover, :focus-visible, :active)::after { background: var(--rsb-accent); }
@container (min-width: 901px) {
  .rsb-rail { flex-basis: clamp(132px, var(--rsb-rail-width, 208px), 30cqw); width: clamp(132px, var(--rsb-rail-width, 208px), 30cqw); }
  .rsb-listPane { flex-basis: clamp(240px, var(--rsb-list-width, 44%), calc(100% - 286px)); min-width: 0; }
  .rsb-workspace, .rsb-readingPane { border-left: 0; }
}
@container (max-width: 900px) {
  .rsb-columnDivider { display: none; }
  .rsb-root[data-reading="true"] > .rsb-rail { display: none; }
  .rsb-root[data-reading="true"] .rsb-listPane { display: none; }
  .rsb-root[data-reading="false"] .rsb-readingPane { display: none; }
  .rsb-listPane { flex: 1 1 0; min-width: 0; }
  .rsb-readingPane { border-left: 0; }
}
@container rsb-list (max-width: 760px) {
  .rsb-root[data-compact="true"] .rsb-item { grid-template-columns: minmax(0, 1fr); }
  .rsb-root[data-compact="true"] .rsb-item > .rsb-tags { display: none; }
  .rsb-root[data-compact="true"] .rsb-feedName { display: none; }
  .rsb-root[data-compact="true"] .rsb-itemTitleText { flex: 1 1 auto; max-width: none; }
  .rsb-root[data-compact="true"] .rsb-inlineSummary { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .rsb-root * { transition: none !important; scroll-behavior: auto !important; }
  .rsb-spin { animation: none !important; }
}
`;

    /** Format `{name}` placeholders. */
    function format(template, params) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) =>
        params && params[key] !== undefined ? String(params[key]) : match,
      );
    }

    /** Clock time of an ISO instant, or empty text. */
    function clock(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      return new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(date);
    }

    /** Article date plus clock time. */
    function articleWhen(article) {
      const date = article && article.publishedDate ? article.publishedDate : "";
      const time = article ? clock(article.publishedAt) : "";
      return [date, time].filter(Boolean).join(" ");
    }

    /** Short local date-time, used for schedule footers. */
    function shortDateTime(value) {
      if (typeof value !== "string" || value === "" || value === "尽快") return value ?? "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .format(date)
        .replace(/\//g, "-");
    }

    /** Only render http(s) links coming from stored article URLs. */
    function safeUrl(value) {
      return typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;
    }

    /** Compact publication age, using the same time zone as the full timestamp. */
    function articleAge(article) {
      const timestamp = Date.parse(article.publishedAt);
      if (!Number.isFinite(timestamp)) return "—";
      const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
      if (seconds < 60) return "刚刚";
      if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
      if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时`;
      if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} 天`;
      return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(timestamp);
    }

    /** Estimate reading time for mixed Chinese and Latin text. */
    function readingMinutes(text) {
      const source = String(text ?? "");
      const cjk = (source.match(/[\u3400-\u9fff]/g) ?? []).length;
      const words = (source.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9]+/g) ?? []).length;
      return Math.max(1, Math.round(cjk / 450 + words / 220));
    }

    /** Split stored body text into paragraphs, tolerating older single-newline rows. */
    function splitParagraphs(text) {
      const source = String(text ?? "").replace(/\r\n?/g, "\n").trim();
      if (source === "") return [];
      const blocks = source
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean);
      if (blocks.length > 1) return blocks;
      return source
        .split(/\n+/)
        .map((block) => block.trim())
        .filter(Boolean);
    }

    /**
     * Self-contained stroke icon set. Paths are hand-drawn for this plugin, so
     * the bundle needs no icon package or network asset.
     */
    const ICON_NODES = {
      layout: [
        ["rect", { x: 3, y: 4, width: 18, height: 16, rx: 2 }],
        ["path", { d: "M9 4v16" }],
      ],
      layers: [
        ["path", { d: "m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" }],
      ],
      rss: [
        ["circle", { cx: 5, cy: 19, r: 1.6, fill: "currentColor", stroke: "none" }],
        ["path", { d: "M4 11a9 9 0 0 1 9 9" }],
        ["path", { d: "M4 4a16 16 0 0 1 16 16" }],
      ],
      refresh: [
        ["path", { d: "M4.5 12a7.5 7.5 0 0 1 12.8-5.3L20 9.4M20 4.6v4.8h-4.8" }],
        ["path", { d: "M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4 14.6M4 19.4v-4.8h4.8" }],
      ],
      "arrow-left": [
        ["path", { d: "M19 12H5" }],
        ["path", { d: "M11 6l-6 6 6 6" }],
      ],
      "chevron-left": [["path", { d: "M14.5 5.5 8 12l6.5 6.5" }]],
      "chevron-right": [["path", { d: "M9.5 5.5 16 12l-6.5 6.5" }]],
      external: [
        ["path", { d: "M14 5h5v5M19 5l-7 7" }],
        ["path", { d: "M18 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5" }],
      ],
      search: [
        ["circle", { cx: 11, cy: 11, r: 6.5 }],
        ["path", { d: "M16 16l4.5 4.5" }],
      ],
      x: [["path", { d: "M6 6l12 12M18 6L6 18" }]],
      check: [["path", { d: "M5 12.5l4.5 4.5L19 7.5" }]],
      circle: [["circle", { cx: 12, cy: 12, r: 7.5 }]],
      book: [
        ["path", { d: "M12 7c-2.2-1.4-5-2-8-2v12c3 0 5.8.6 8 2" }],
        ["path", { d: "M12 7c2.2-1.4 5-2 8-2v12c-3 0-5.8.6-8 2" }],
        ["path", { d: "M12 7v12" }],
      ],
      play: [["path", { d: "M8 5.5v13l10.5-6.5z", fill: "currentColor" }]],
      sparkles: [
        ["path", { d: "M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" }],
        ["path", { d: "M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" }],
      ],
      gear: [
        ["circle", { cx: 12, cy: 12, r: 3 }],
        ["path", { d: "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" }],
      ],
      clock: [
        ["circle", { cx: 12, cy: 12, r: 8 }],
        ["path", { d: "M12 8v4l3 2" }],
      ],
      calendar: [
        ["rect", { x: 4, y: 5, width: 16, height: 15, rx: 2 }],
        ["path", { d: "M8 3v4M16 3v4M4 10h16" }],
      ],
      alert: [
        ["path", { d: "M12 4 3 20h18z" }],
        ["path", { d: "M12 10v4" }],
        ["circle", { cx: 12, cy: 17.2, r: 0.8, fill: "currentColor", stroke: "none" }],
      ],
      loader: [["path", { d: "M12 3a9 9 0 1 0 9 9" }]],
      retry: [
        ["path", { d: "M4 10a8 8 0 1 1 2.3 5.7" }],
        ["path", { d: "M4 4v6h6" }],
      ],
      file: [
        ["path", { d: "M6 3h8l4 4v14H6z" }],
        ["path", { d: "M14 3v4h4M9 12h6M9 16h6" }],
      ],
    };

    /** Render one named stroke icon. */
    function Icon({ name, size = 16, spin = false, className }) {
      const nodes = ICON_NODES[name] ?? ICON_NODES.rss;
      return h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.8,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
          className: ["rsb-icon", spin ? "rsb-spin" : null, className]
            .filter(Boolean)
            .join(" "),
        },
        nodes.map(([tag, attributes], index) => h(tag, { key: index, ...attributes })),
      );
    }

    /** Sidebar entry icon: the host owns geometry, color, and focus. */
    function SidebarIcon({ size }) {
      return h(Icon, { name: "rss", size: typeof size === "number" ? size : 18 });
    }

    /** Load icons directly from the source site without a third-party icon service. */
    function FeedIcon({ article }) {
      let iconUrl = null;
      let hostname = "";
      try {
        const site = new URL(safeUrl(article.feedUrl) ?? safeUrl(article.url));
        hostname = site.hostname;
        iconUrl = new URL("/favicon.ico", site.origin).href;
      } catch { /* Invalid or missing source URLs use the source initial. */ }
      const [failedUrl, setFailedUrl] = React.useState(null);
      const label = article.feed || hostname || "RSS";
      return h("span", { className: "rsb-feedIcon", title: label, "aria-hidden": "true" },
        iconUrl !== null && failedUrl !== iconUrl
          ? h("img", {
              src: iconUrl, alt: "", width: 18, height: 18, loading: "lazy", decoding: "async",
              referrerPolicy: "no-referrer", onError: () => setFailedUrl(iconUrl),
            })
          : h("span", { className: "rsb-feedInitial" }, Array.from(label.trim())[0]?.toUpperCase() || "R"),
      );
    }

    function AssessmentMeta({ assessment, tr, compact = false }) {
      const value = assessment ?? { status: "pending" };
      const scored = typeof value.score === "number" && Number.isFinite(value.score);
      if (compact) return h("span", {
        className: "rsb-compactScore", "data-high": String(Boolean(value.highQuality)),
        title: [tr("assessment.title"), scored ? tr("assessment.score", { score: value.score }) : tr(`assessment.${value.status === "failed" ? "failed" : "pending"}`),
          value.provisional ? tr("assessment.provisional") : "", value.stale ? tr("assessment.stale") : ""].filter(Boolean).join(" · "),
      }, scored ? `${value.score}${value.provisional || value.stale ? "*" : ""}` : "—");
      return h(React.Fragment, null,
        scored ? h("span", { className: "rsb-badge rsb-score" }, tr("assessment.score", { score: value.score })) : null,
        value.highQuality ? h("span", { className: "rsb-badge rsb-qualityBadge" }, tr("assessment.highQuality")) : null,
        h("span", { className: "rsb-metaItem" }, tr(`assessment.${value.status === "failed" ? "failed" : scored && ["recommended", "optional", "skip"].includes(value.recommendation) ? value.recommendation : "pending"}`)),
        value.provisional ? h("span", { className: "rsb-badge" }, tr("assessment.provisional")) : null,
        value.stale ? h("span", { className: "rsb-badge" }, tr("assessment.stale")) : null,
        typeof value.minutes === "number" && value.minutes > 0 ? h("span", { className: "rsb-metaItem" },
          h(Icon, { name: "clock", size: 12 }), tr("reader.minutes", { minutes: value.minutes })) : null,
      );
    }

    function AssessmentDetails({ assessment, tr }) {
      const value = assessment ?? { status: "pending" };
      const dimensions = [["information", 25], ["evidence", 25], ["depth", 20], ["utility", 20], ["clarity", 10]];
      return h("section", { className: "rsb-assessment", "aria-label": tr("assessment.title") },
        h("details", { key: `${value.status}:${value.analyzedAt ?? "pending"}`, className: "rsb-details" },
          h("summary", { className: "rsb-assessmentSummary", title: tr("assessment.title") },
            h("span", { className: "rsb-meta" }, h(AssessmentMeta, { assessment: value, tr })),
            h("span", { className: "rsb-assessmentExpand" }, h(Icon, { name: "chevron-right", size: 13 })),
          ),
          value.reason ? h("p", { className: "rsb-assessmentReason" }, value.reason) : null,
          value.provisional ? h("p", null, tr(value.basis === "sampled" ? "assessment.sampled" : "assessment.excerpt")) : null,
          value.stale ? h("p", null, tr("assessment.stale")) : null,
          value.dimensions ? h("dl", { className: "rsb-dimensions" }, dimensions.map(([key, max]) =>
            h(React.Fragment, { key }, h("dt", null, tr(`assessment.${key}`)),
              h("dd", null, typeof value.dimensions[key] === "number" ? `${value.dimensions[key]} / ${max}` : "—")))) : null,
          value.error ? h("p", null, value.error) : null,
          h("p", null, tr("assessment.disclaimer")),
        ),
      );
    }

    /** Save several visible anchors so an auto-read removal still has a neighbor. */
    function captureListPosition(element) {
      if (!element) return { top: 0, anchors: [] };
      const viewport = element.getBoundingClientRect();
      const anchors = [];
      for (const row of element.querySelectorAll("[data-article-id]")) {
        const bounds = row.getBoundingClientRect();
        if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) continue;
        anchors.push({ id: row.getAttribute("data-article-id"), offset: bounds.top - viewport.top });
        if (anchors.length === 3) break;
      }
      return { top: element.scrollTop, anchors };
    }

    /** Restore after layout, preferring article identity over a raw pixel offset. */
    function restoreListPosition(element, position) {
      if (!element || !position) return;
      const rows = Array.from(element.querySelectorAll("[data-article-id]"));
      for (const anchor of position.anchors) {
        const row = rows.find((entry) => entry.getAttribute("data-article-id") === anchor.id);
        if (!row) continue;
        element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.offset;
        return;
      }
      element.scrollTop = position.top;
    }

    /** Tags share the same filter action in lists and the reader. */
    function ArticleTags({ tags, topics = [], format = null, tr, onSelectTag, onSelectFormat, compact = false }) {
      if (tags.length === 0) return null;
      const visibleTags = compact ? (format && tags.includes(format)
        ? [...tags.filter((tag) => tag !== format).slice(0, 1), format] : tags.slice(0, 2)) : tags;
      const remainingTags = compact ? tags.filter((tag) => !visibleTags.includes(tag)) : [];
      return h("div", { className: "rsb-tags", title: compact ? tags.join(" · ") : undefined },
        visibleTags.map((tag) => h("button", {
          key: tag, type: "button", className: "rsb-tag", title: tag,
          "data-kind": tag === format ? "format" : topics.includes(tag) ? "topic" : "legacy",
          "aria-label": tag === format ? tr("formats.select", { format: tag }) : tr(topics.includes(tag) ? "topics.select" : "tags.select", { tag }),
          onClick: () => tag === format ? onSelectFormat(tag) : onSelectTag(tag),
        }, tag)),
        remainingTags.length ? h("span", {
          className: "rsb-tagMore", title: tags.join(" · "),
          "aria-label": tr("tags.more", { count: remainingTags.length, tags: remainingTags.join(" · ") }),
        }, `+${remainingTags.length}`) : null,
      );
    }

    /** One article row with aligned metadata, summary, and explicit reading actions. */
    function ArticleRow({ article, fallback, tr, onOpen, onToggleRead, onSelectTag, onSelectFormat, readBusy, compactMode = true, selected = false }) {
      const url = safeUrl(article.url);
      const canRead = Number.isInteger(article.id) && article.id > 0;
      const read = Boolean(article.read);
      const readPending = readBusy === article.id;
      const readLabel = tr(read ? "read.markUnread" : "read.markRead");
      return h(
        "article",
        { className: "rsb-item", "data-article-id": article.id, "data-read": read ? "true" : "false", "data-selected": String(selected) },
        h("h4", { className: "rsb-itemTitle" },
          h("button", {
            type: "button", className: "rsb-itemTitleButton", title: `${article.feed || ""}${article.feed ? " · " : ""}${article.title}`,
            onClick: () => onOpen(article.id), disabled: !canRead, "aria-current": selected ? "true" : undefined,
            "aria-label": `${tr("action.read")}：${article.title}${article.feed ? ` · ${article.feed}` : ""}`,
          },
            compactMode ? h("span", { className: "rsb-unreadDot", "aria-hidden": "true" }) : null,
            h(FeedIcon, { article }),
            compactMode ? h("span", { className: "rsb-feedName", "aria-hidden": "true" }, article.feed || "") : null,
            h("span", { className: "rsb-itemTitleText" }, article.title),
            compactMode ? h("span", { className: "rsb-inlineSummary", "aria-hidden": "true" }, article.summary || "") : null,
            compactMode ? h(AssessmentMeta, { assessment: article.assessment, tr, compact: true }) : null,
            compactMode ? h("time", { className: "rsb-inlineTime", dateTime: article.publishedAt || undefined, title: article.publishedAt ? articleWhen(article) : tr("time.unknown") }, articleAge(article)) : null,
          ),
        ),
        h(ArticleTags, { tags: article.tags ?? [], topics: article.topics, format: article.format, tr, onSelectTag, onSelectFormat, compact: compactMode }),
        article.summary ? h("p", { className: "rsb-summary" }, article.summary) : null,
        h("div", { className: "rsb-meta" },
          h(AssessmentMeta, { assessment: article.assessment, tr }),
          article.categoryLabel ? h("span", { className: "rsb-badge" }, article.categoryLabel) : null,
          h("span", null, article.feed ?? ""),
          article.publishedAt ? h("time", { dateTime: article.publishedAt, title: article.publishedAt }, articleWhen(article)) : null,
          article.relevance !== null && article.relevance !== undefined
            ? h("span", { className: "rsb-badge" }, tr("meta.relevance", { score: article.relevance })) : null,
          fallback ? h("span", { className: "rsb-badge" }, tr("badge.fallback")) : null,
        ),
        h("div", { className: "rsb-itemActions" },
          canRead ? h("button", {
            type: "button", className: "rsb-readToggle", disabled: readBusy !== null,
            onClick: () => onToggleRead(article), title: readLabel,
            "aria-label": `${readLabel}：${article.title}`, "aria-pressed": read,
          }, h(Icon, { name: readPending ? "loader" : read ? "check" : "circle", size: 14, spin: readPending })) : null,
          canRead ? h("button", {
            type: "button", className: "rsb-btn rsb-btn--outline rsb-btn--sm",
            onClick: () => onOpen(article.id),
          }, h(Icon, { name: "book", size: 13 }), tr("action.read")) : null,
          url ? h("a", {
            className: "rsb-btn rsb-btn--ghost rsb-btn--icon rsb-btn--sm",
            href: url, target: "_blank", rel: "noreferrer noopener",
            title: tr("action.source"), "aria-label": `${tr("action.source")}：${article.title}`,
          }, h(Icon, { name: "external", size: 14 })) : null,
        ),
      );
    }

    /** Pure article selection: global publication order and composable category/search/read filters. */
    function buildArticleList(groups, { category = null, query = "", unreadOnly = false } = {}) {
      const normalized = query.trim().toLowerCase();
      const searchArticles = [];
      const categories = groups.map((group, index) => {
        const key = String(group.id ?? group.label ?? index);
        const items = (Array.isArray(group.items) ? group.items : []).filter((article) =>
          normalized === "" || [article.title, article.feed, article.summary].some((value) =>
            String(value ?? "").toLowerCase().includes(normalized),
          ),
        );
        for (const article of items) {
          searchArticles.push({ ...article, tags: article.tags ?? [], categoryLabel: group.label, listCategory: key });
        }
        return { key, label: group.label, count: items.filter((article) => !unreadOnly || !article.read).length };
      });
      const selected = categories.find((entry) => entry.key === category) ?? null;
      const time = (article) => {
        const value = Date.parse(article.publishedAt ?? "");
        return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
      };
      const readerArticles = searchArticles
        .filter((article) => selected === null || article.listCategory === selected.key)
        .sort((left, right) => {
          const a = time(left), b = time(right);
          return a === b ? (Number(right.id) || 0) - (Number(left.id) || 0) : a > b ? -1 : 1;
        });
      return {
        categories,
        category: selected?.key ?? null,
        categoryLabel: selected?.label ?? null,
        totalCount: categories.reduce((sum, entry) => sum + entry.count, 0),
        articles: readerArticles.filter((article) => !unreadOnly || !article.read),
        // Keep the current article in reader navigation when it has just been marked read.
        readerArticles,
      };
    }

    /** Update read marks without discarding loaded pages or moving the list. */
    function patchReadState(data, id, read, unreadOnly) {
      if (!data?.report?.groups) return data;
      const original = data.report.groups.flatMap((group) => group.items || []).find((item) => item.id === id);
      if (!original || Boolean(original.read) === read) return data;
      const delta = read ? -1 : 1;
      const report = { ...data.report, groups: data.report.groups.map((group) => ({ ...group,
        items: (group.items || []).map((item) => item.id === id ? { ...item, read } : item),
      })) };
      if (!data.latest) return { ...data, report };
      const latest = { ...data.latest, unread: Math.max(0, data.latest.unread + delta),
        total: Math.max(0, data.latest.total + (unreadOnly ? delta : 0)),
        ...(data.latest.navigation ? { navigation: { ...data.latest.navigation,
          total: Math.max(0, data.latest.navigation.total + (unreadOnly ? delta : 0)),
        } } : {}),
        categories: data.latest.categories.map((category) => category.key === `opml:${original.opmlGroup}` && unreadOnly
          ? { ...category, count: Math.max(0, category.count + delta) } : category),
        ...(Array.isArray(data.latest.sources) ? { sources: data.latest.sources.map((source) => source.id === original.feedId && unreadOnly
          ? { ...source, count: Math.max(0, source.count + delta) } : source) } : {}),
        ...(Array.isArray(data.latest.tags) ? { tags: data.latest.tags.map((tag) => unreadOnly && (original.tags ?? []).includes(tag.name)
          ? { ...tag, count: Math.max(0, tag.count + delta) } : tag) } : {}),
        ...(data.latest.tagGroups ? { tagGroups: { ...data.latest.tagGroups,
          ...(Array.isArray(data.latest.tagGroups.topics) ? { topics: data.latest.tagGroups.topics.map((topic) => unreadOnly && (original.topics ?? []).includes(topic.name)
            ? { ...topic, count: Math.max(0, topic.count + delta) } : topic) } : {}),
          ...(Array.isArray(data.latest.tagGroups.formats) ? { formats: data.latest.tagGroups.formats.map((format) => unreadOnly && original.format === format.name
            ? { ...format, count: Math.max(0, format.count + delta) } : format) } : {}),
        } } : {}),
      };
      const pagination = unreadOnly ? { ...data.pagination,
        total: Math.max(0, data.pagination.total + delta),
        nextOffset: data.pagination.nextOffset === null ? null : Math.max(0, data.pagination.nextOffset + delta),
      } : data.pagination;
      return { ...data, report, latest, pagination };
    }

    /** Patch only identified read flags; server counts are refreshed independently. */
    function patchReadIds(data, ids, overrides = null) {
      if (!data?.report?.groups) return data;
      return { ...data, report: { ...data.report, groups: data.report.groups.map((group) => ({ ...group,
        items: (group.items || []).map((article) => overrides?.has(article.id)
          ? { ...article, read: overrides.get(article.id) }
          : ids.has(article.id) ? { ...article, read: true } : article),
      })) } };
    }

    /** Append a server page without duplicating article IDs across refreshes. */
    function mergeLatestPages(previous, incoming) {
      const items = new Map();
      const labels = new Map();
      for (const payload of [previous, incoming]) {
        for (const group of payload.report?.groups ?? []) {
          labels.set(group.id, group.label);
          for (const article of group.items ?? []) items.set(article.id, { groupId: group.id, article });
        }
      }
      const buckets = new Map();
      for (const { groupId, article } of items.values()) {
        if (!buckets.has(groupId)) buckets.set(groupId, []);
        buckets.get(groupId).push(article);
      }
      const groups = [...buckets].map(([id, articles]) => ({ id, label: labels.get(id), items: articles }));
      return { ...incoming, report: { ...incoming.report, groups } };
    }

    /** Images fail independently so a missing image never hides the article. */
    function ReaderImage({ node, tr, inline, articleId }) {
      // direct → proxy (sites that reject requests without their own Referer) → failed.
      const [stage, setStage] = React.useState("direct");
      const failed = stage === "failed";
      // Emoji and icon images (e.g. a link emoji inside a caption) stay in the text line.
      const [loadedSmall, setLoadedSmall] = React.useState(false);
      const small = inline || loadedSmall || (node.width && node.height ? node.width <= 64 && node.height <= 64 : false);
      const src = safeUrl(node.src);
      if (!src) return null;
      if (failed) return h("span", { className: "rsb-imageFallback" },
        node.alt || tr("reader.imageFailed"),
        h("a", { href: src, target: "_blank", rel: "noopener noreferrer" }, tr("reader.imageOriginal")),
      );
      const proxied = new URL(IMAGE_ENDPOINT, document.baseURI);
      proxied.searchParams.set("id", String(articleId));
      proxied.searchParams.set("src", node.src);
      return h("img", { src: stage === "proxy" ? proxied.href : src, alt: node.alt || "", title: node.title || undefined,
        width: node.width || undefined, height: node.height || undefined,
        className: small ? "rsb-inlineImage" : undefined,
        loading: "lazy", decoding: "async", referrerPolicy: "no-referrer",
        onError: () => setStage(stage === "direct" && Number.isSafeInteger(articleId) ? "proxy" : "failed"),
        onLoad: (event) => setLoadedSmall(event.currentTarget.naturalWidth <= 64 && event.currentTarget.naturalHeight <= 64) });
    }

    /** Embedded players never load here; the card links to the provider's watch page. */
    function ReaderVideo({ node, tr }) {
      const url = safeUrl(node.url);
      if (!url) return null;
      const poster = safeUrl(node.poster);
      const provider = ["bilibili", "youtube", "vimeo", "qq", "youku", "native"].includes(node.provider) ? tr(`reader.provider.${node.provider}`) : "";
      // Inline elements only: the card may sit inside a source paragraph.
      return h("a", { className: "rsb-videoCard", href: url, target: "_blank", rel: "noopener noreferrer", title: tr("reader.videoOpen") },
        h("span", { className: "rsb-videoThumb", style: poster ? { backgroundImage: `url("${poster.replace(/["\\\n]/g, "")}")` } : undefined },
          h("span", { className: "rsb-videoPlay" }, h(Icon, { name: "play", size: 22 }))),
        h("span", { className: "rsb-videoText" },
          h("span", { className: "rsb-videoTitle" }, node.title || tr("reader.video")),
          h("span", { className: "rsb-videoMeta" }, [provider, tr("reader.videoOpen")].filter(Boolean).join(" · "),
            h(Icon, { name: "external", size: 12 }))),
      );
    }

    /** Render only explicitly supported document nodes, never external HTML. */
    function ArticleDocument({ document: content, tr, articleId }) {
      let remaining = 10000;
      const allowed = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li", "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "strong", "em", "a", "img", "figure", "figcaption", "br", "hr", "video"]);
      function render(node, key, depth = 0, inline = false) {
        if (!node || --remaining < 0 || depth > 32) return null;
        if (node.type === "text") return typeof node.text === "string" ? node.text : null;
        if (!allowed.has(node.type)) return null;
        if (node.type === "img") return h(ReaderImage, { key: `${key}:${node.src}`, node, tr, inline, articleId });
        if (node.type === "video") return h(ReaderVideo, { key: `${key}:${node.url}`, node, tr });
        const kids = Array.isArray(node.children) ? node.children : [];
        // An image sitting among text in the same block is an inline icon, not a figure.
        const hasText = kids.some((child) => child?.type === "text" && typeof child.text === "string" && child.text.trim() !== "");
        const children = kids.map((child, i) => render(child, `${key}:${i}`, depth + 1, hasText));
        const attributes = { key };
        if (node.type === "a") {
          const href = safeUrl(node.href) || (/^mailto:[^\s]+$/i.test(node.href || "") ? node.href : null);
          if (!href) return h(React.Fragment, { key }, children);
          Object.assign(attributes, { href, title: node.title || undefined, target: "_blank", rel: "noopener noreferrer" });
        }
        if (node.type === "ol" && Number.isInteger(node.start)) attributes.start = node.start;
        if (["th", "td"].includes(node.type)) {
          if (Number.isInteger(node.colSpan)) attributes.colSpan = Math.max(1, Math.min(100, node.colSpan));
          if (Number.isInteger(node.rowSpan)) attributes.rowSpan = Math.max(1, Math.min(100, node.rowSpan));
        }
        const element = h(node.type, attributes, ...(["br", "hr"].includes(node.type) ? [] : children));
        return node.type === "table" ? h("div", { key, className: "rsb-tableScroll", tabIndex: 0 }, element) : element;
      }
      return h("div", { className: "rsb-prose" }, content.children.map((node, i) => render(node, String(i))));
    }

    /** Reader-scoped task lifecycle: queries never start work; only an explicit click posts. */
    function PublicationControl({ id, tr, url, children, kind = "publication", ready = true, extraAction }) {
      const t = (key, params) => tr(key.replace(/^publication\./, `${kind}.`), params);
      const readyRef = React.useRef(ready);
      readyRef.current = ready;
      const [state, setState] = React.useState({ id, task: null, pending: "query", error: null, queried: false, uncertain: false });
      const scopeRef = React.useRef(null);
      React.useEffect(() => {
        const scope = { active: true, task: null, pending: null, error: null, queried: false, uncertain: false, timer: null, controller: null };
        scopeRef.current = scope;
        const update = () => {
          if (scope.active) setState({ id, task: scope.task, pending: scope.pending, error: scope.error, queried: scope.queried, uncertain: scope.uncertain });
        };
        const request = async (start = false) => {
          if (!scope.active || scope.pending !== null) return;
          if (start && (!readyRef.current || !scope.queried || scope.error || scope.uncertain || (scope.task !== null && scope.task.status !== "failed"))) return;
          if (scope.timer !== null) clearTimeout(scope.timer);
          scope.timer = null;
          const controller = new AbortController();
          scope.controller = controller;
          scope.pending = start ? "start" : "query";
          scope.error = null;
          if (start) scope.uncertain = true;
          update();
          try {
            const task = await requestPublication(id, start, controller.signal, tr, kind);
            if (!scope.active || controller.signal.aborted) return;
            if (task === null && scope.task !== null) throw new Error(t("publication.missing"));
            scope.task = task;
            scope.queried = true;
            scope.uncertain = false;
          } catch (cause) {
            if (!scope.active || controller.signal.aborted) return;
            scope.error = cause instanceof Error ? cause.message : String(cause);
          } finally {
            if (scope.active && !controller.signal.aborted) {
              scope.pending = null;
              scope.controller = null;
              update();
              if (["queued", "running"].includes(scope.task?.status)) scope.timer = setTimeout(() => void request(), POLL_RUNNING_MS);
            }
          }
        };
        scope.request = request;
        void request();
        return () => {
          scope.active = false;
          scope.controller?.abort();
          if (scope.timer !== null) clearTimeout(scope.timer);
          if (scopeRef.current === scope) scopeRef.current = null;
        };
      }, [id, tr, kind]);

      // A changed article must never render the previous article's task before effects run.
      const current = state.id === id ? state : { task: null, pending: "query", error: null, queried: false, uncertain: false };
      const { task, pending, error, queried, uncertain } = current;
      const running = task?.status === "running";
      const queued = task?.status === "queued";
      const stage = t(`publication.stage.${["evidence", "writing", "images", "validation", "wechat_draft"].includes(task?.stage) ? task.stage : "preparing"}`);
      const taskLabel = queued ? t("publication.queued", { position: Number.isInteger(task.queuePosition) ? task.queuePosition : "?" })
        : running ? t("publication.running", { stage })
        : task?.status === "succeeded" ? t(task.publishStatus === "submitted" ? "publication.submitted" : "publication.succeeded")
        : task?.status === "needs_attention" ? t("publication.needsAttention")
        : task?.status === "failed" ? t("publication.failed") : null;
      const buttonLabel = pending === "start" ? t("publication.starting") : taskLabel && task?.status !== "failed" ? taskLabel
        : pending === "query" && !queried ? t("publication.querying")
        : t(task?.status === "failed" ? "publication.retry" : "publication.create");
      const locked = !ready || pending !== null || !queried || error !== null || uncertain || (task !== null && task.status !== "failed");
      const taskError = typeof task?.error === "string" ? task.error : typeof task?.error?.message === "string" ? task.error.message : null;
      const model = task?.model;
      const source = ["default", "custom", "config"].includes(model?.source) ? tr(`settings.source.${model.source}`) : "";
      const details = [
        ["publication.model", model?.provider && model?.model ? `${model.provider}/${model.model}${source ? ` (${source})` : ""}` : null],
        ["publication.session", task?.sessionId],
        ["publication.mediaId", task?.mediaId],
        ["publication.publishId", task?.publishId],
        ...(kind === "share" ? [["share.posterPath", task?.posterPath], ["share.captionPath", task?.captionPath]] : [["publication.articlePath", task?.articlePath]]),
      ].filter(([, value]) => typeof value === "string" && value !== "");
      const button = h("button", {
        type: "button", className: "rsb-btn rsb-btn--outline rsb-btn--sm rsb-publicationButton",
        disabled: locked, title: kind === "share" && !ready ? t("publication.notReady") : buttonLabel, "aria-label": buttonLabel,
        onClick: () => void scopeRef.current?.request(true),
      }, h(Icon, {
        name: queued ? "clock" : pending !== null || running ? "loader" : task?.status === "succeeded" ? "check" : task?.status === "needs_attention" ? "alert" : "sparkles",
        size: 14, spin: pending !== null || running,
      }), buttonLabel);
      return h(React.Fragment, null,
        kind === "share" ? button : h("div", { className: "rsb-readerHeaderInner" }, children,
          h("div", { className: "rsb-readerHeaderEnd" }, button, extraAction,
            url ? h("a", { className: "rsb-readerButton", href: url, target: "_blank", rel: "noreferrer noopener", title: tr("reader.original"), "aria-label": tr("reader.original") },
              tr("reader.original"), h(Icon, { name: "external", size: 13 })) : null,
          ),
        ),
        taskLabel || taskError || error || details.length > 0 ? h("div", { className: "rsb-publicationStatus", role: "status", "aria-live": "polite", "aria-atomic": "true" },
          taskLabel ? h("p", null, taskLabel) : null,
          task?.status === "needs_attention" ? h("p", null, t("publication.attentionHint")) : null,
          taskError ? h("p", { className: "rsb-dialogError" }, taskError) : null,
          error ? h(React.Fragment, null,
            h("p", { className: "rsb-dialogError" }, t("publication.requestError"), ": ", error),
            uncertain ? h("p", null, t("publication.uncertain")) : task ? h("p", null, t("publication.lastKnown")) : null,
            h("button", { type: "button", className: "rsb-inline rsb-inline--brand", disabled: pending !== null,
              onClick: () => void scopeRef.current?.request() }, h(Icon, { name: "retry", size: 13 }), t("publication.queryRetry")),
          ) : null,
          details.length > 0 ? h("dl", null, details.map(([label, value]) => h(React.Fragment, { key: label },
            h("dt", null, t(label)), h("dd", null, value)))) : null,
        ) : null,
      );
    }

    /** A preview or incomplete extraction must never enable poster generation. */
    function shareArticleReady(reader) {
      const article = reader?.article;
      return Boolean(article && article.id === reader.id && reader.pending === false && !reader.readingBodyPending && !reader.error
        && !article.readingBodyPending && !article.extracting && !article.needsExtraction && !article.truncated && !article.contentTruncated && !article.contentDocument?.truncated
        && !article.refreshError && !article.contentError && !article.discarded && article.contentStatus === "ok"
        && ["web", "feed", "legacy"].includes(article.contentSource)
        && typeof article.contentText === "string" && article.contentText.trim());
    }
    /** Dedicated reading view with progress, source, and article navigation. */
    function ReaderView({ reader, articles, tr, onBack, onRetry, onNavigate, onToggleRead, onSelectTag, onSelectFormat, readBusy, positions }) {
      const scrollRef = React.useRef(null);
      const [progress, setProgress] = React.useState(0);
      const article = reader.article;
      const url = article ? safeUrl(article.url) : null;
      const position = articles.findIndex((entry) => entry.id === reader.id);
      const previous = position > 0 ? articles[position - 1] : null;
      const next = position >= 0 && position < articles.length - 1 ? articles[position + 1] : null;

      React.useEffect(() => {
        const onKey = (event) => {
          const target = event.target;
          if (event.defaultPrevented || target?.closest?.("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
          if (event.key === "Escape") {
            onBack();
            return;
          }
          if (event.key === "[" && previous !== null) {
            onNavigate(previous.id);
            return;
          }
          if (event.key === "]" && next !== null) {
            onNavigate(next.id);
          }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [onBack, onNavigate, previous, next]);

      const restoredId = React.useRef(null);
      const userMoved = React.useRef(false);
      React.useLayoutEffect(() => {
        if (restoredId.current !== reader.id) {
          restoredId.current = reader.id;
          userMoved.current = false;
          setProgress(0);
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
        }
        if (!reader.pending && !userMoved.current && scrollRef.current) {
          scrollRef.current.scrollTop = positions.current.get(reader.id) || 0;
        }
      }, [reader.id, reader.pending]);

      const onScroll = (event) => {
        const element = event.currentTarget;
        if (userMoved.current || !reader.pending) positions.current.set(reader.id, element.scrollTop);
        const max = element.scrollHeight - element.clientHeight;
        setProgress(max > 0 ? Math.min(100, Math.max(0, (element.scrollTop / max) * 100)) : 0);
      };

      const nav = h(
        "div",
        { className: "rsb-readerNav" },
        h(
          "button",
          {
            type: "button",
            className: "rsb-btn rsb-btn--ghost rsb-btn--icon rsb-btn--sm",
            onClick: () => previous !== null && onNavigate(previous.id),
            disabled: previous === null,
            title: tr("reader.prevHint"),
            "aria-label": tr("reader.prev"),
          },
          h(Icon, { name: "chevron-left", size: 16 }),
        ),
        h(
          "span",
          { className: "rsb-readerPosition" },
          position >= 0 ? `${position + 1} / ${articles.length}` : "",
        ),
        h(
          "button",
          {
            type: "button",
            className: "rsb-btn rsb-btn--ghost rsb-btn--icon rsb-btn--sm",
            onClick: () => next !== null && onNavigate(next.id),
            disabled: next === null,
            title: tr("reader.nextHint"),
            "aria-label": tr("reader.next"),
          },
          h(Icon, { name: "chevron-right", size: 16 }),
        ),
      );

      let content;
      if (reader.pending && article === null) {
        content = h(
          "div",
          { className: "rsb-readerLoading", role: "status" },
          h(Icon, { name: "loader", size: 16, spin: true }),
          tr("reader.loading"),
        );
      } else if (article === null) {
        content = h(
          "div",
          { className: "rsb-readerError", role: "alert" },
          h("span", { className: "rsb-readerErrorTitle" }, tr("reader.error")),
          h("p", null, reader.error ?? tr("reader.error")),
          h(
            "div",
            { className: "rsb-readerActions" },
            h(
              "button",
              { type: "button", className: "rsb-btn rsb-btn--outline rsb-btn--sm", onClick: onRetry },
              h(Icon, { name: "retry", size: 13 }),
              tr("reader.retry"),
            ),
            url
              ? h(
                  "a",
                  {
                    className: "rsb-btn rsb-btn--ghost rsb-btn--sm",
                    href: url,
                    target: "_blank",
                    rel: "noreferrer noopener",
                  },
                  h(Icon, { name: "external", size: 13 }),
                  tr("reader.original"),
                )
              : null,
          ),
        );
      } else {
        const paragraphs = splitParagraphs(article.contentText);
        const problem = reader.error || article.refreshError || article.contentError;
        const note = problem && !reader.pending ? h("div", { className: "rsb-readerNote", role: "status" },
          h("strong", null, tr("reader.refreshFailed")), h("p", null, problem),
        ) : null;

        content = h(
          React.Fragment,
          null,
          h("h1", { className: "rsb-readerTitle" }, article.title),
          h(ArticleTags, { tags: article.tags ?? [], topics: article.topics, format: article.format, tr, onSelectTag, onSelectFormat }),
          h(
            "div",
            { className: "rsb-readerMeta" },
            article.categoryLabel
              ? h("span", { className: "rsb-readerChip rsb-readerChip--brand" }, article.categoryLabel)
              : null,
            h("span", null, article.feed ?? ""),
            article.publishedAt
              ? h(
                  "span",
                  { className: "rsb-metaItem" },
                  h(Icon, { name: "calendar", size: 12 }),
                  tr("reader.at", { date: articleWhen(article) }),
                )
              : null,
            article.relevance !== null && article.relevance !== undefined
              ? h("span", { className: "rsb-readerChip" }, tr("meta.relevance", { score: article.relevance }))
              : null,
            h(
              "span",
              { className: "rsb-metaItem" },
              h(Icon, { name: "clock", size: 12 }),
              tr("reader.minutes", { minutes: article.assessment?.minutes || readingMinutes(article.contentText) }),
              /\[视频：\w+ https?:\/\//.test(article.contentText || "") ? ` · ${tr("reader.withVideo")}` : null,
            ),
            article.id
              ? h(
                  "button",
                  {
                    type: "button",
                    className: "rsb-inline rsb-inline--brand",
                    onClick: () => onToggleRead(article),
                    disabled: readBusy !== null,
                    title: article.read ? tr("read.markUnread") : tr("read.markRead"),
                  },
                  h(Icon, {
                    name:
                      readBusy === article.id
                        ? "loader"
                        : article.read
                          ? "check"
                          : "circle",
                    size: 12,
                    spin: readBusy === article.id,
                  }),
                  article.read ? tr("read.markUnread") : tr("read.markRead"),
                )
              : null,
          ),
          h("div", { className: "rsb-readerStatus", role: "status" },
            h("span", { className: "rsb-readerSource" }, tr(`reader.source.${article.contentSource || "feed-summary"}`)),
            reader.pending ? h(React.Fragment, null,
              h(Icon, { name: "loader", size: 13, spin: true }),
              tr(reader.stage === "cache" ? "reader.cached" : "reader.fetching"),
            ) : null,
            h("button", { type: "button", className: "rsb-inline", disabled: reader.pending, onClick: onRetry },
              h(Icon, { name: "retry", size: 13 }), tr("reader.retry")),
          ),
          h(AssessmentDetails, { assessment: article.assessment, tr }),
          article.summary ? h("details", { key: `${reader.id}:${article.contentSource === "preview"}`, className: "rsb-readerSummary", open: true },
            h("summary", null, tr("reader.summary")),
            h("p", { className: "rsb-readerSummaryText" }, article.summary),
          ) : null,
          note,
          article.truncated ? h("p", { className: "rsb-readerNote" }, tr("reader.truncated")) : null,
          article.contentDocument?.version === 1 && Array.isArray(article.contentDocument.children) && article.contentDocument.children.length > 0
            ? h(ArticleDocument, { document: article.contentDocument, tr, articleId: article.id })
            : paragraphs.length > 0
              ? h("div", { className: "rsb-prose rsb-prose--plain" }, paragraphs.map((paragraph, index) => h("p", { key: `p:${index}` }, paragraph)))
              : !reader.pending && !article.summary ? h("p", { className: "rsb-readerEmpty" }, tr("reader.empty")) : null,
          position >= 0
            ? h(
                "div",
                { className: "rsb-readerPager" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "rsb-btn rsb-btn--outline rsb-btn--sm",
                    onClick: () => previous !== null && onNavigate(previous.id),
                    disabled: previous === null,
                  },
                  h(Icon, { name: "chevron-left", size: 14 }),
                  tr("reader.prev"),
                ),
                h("span", { className: "rsb-readerKeys" }, tr("reader.keys")),
                h(
                  "button",
                  {
                    type: "button",
                    className: "rsb-btn rsb-btn--outline rsb-btn--sm",
                    onClick: () => next !== null && onNavigate(next.id),
                    disabled: next === null,
                  },
                  tr("reader.next"),
                  h(Icon, { name: "chevron-right", size: 14 }),
                ),
              )
            : null,
          h(
            "div",
            { className: "rsb-readerFooter" },
            h("span", null, tr("reader.sourceNote")),
            url
              ? h(
                  "a",
                  { href: url, target: "_blank", rel: "noreferrer noopener" },
                  tr("reader.original"),
                )
              : null,
          ),
        );
      }

      return h(
        "div",
        { className: "rsb-readerShell" },
        h(
          "header",
          { className: "rsb-readerHeader" },
          h(
            PublicationControl,
            {
              key: reader.id, id: reader.id, tr, url,
              extraAction: h("div", { className: "rsb-shareControl" }, h(PublicationControl, {
                key: `share:${reader.id}`, id: reader.id, tr, kind: "share", ready: shareArticleReady(reader),
              })),
            },
            h(
              "button",
              {
                type: "button",
                className: "rsb-readerButton rsb-readerHeaderStart",
                onClick: onBack,
                title: `${tr("reader.close")} (Esc)`, "aria-label": tr("reader.close"),
              },
              h(Icon, { name: "x", size: 14 }),
            ),
            nav,
          ),
        ),
        h(
          "div",
          { className: "rsb-readerProgress", "aria-hidden": "true" },
          h("div", { className: "rsb-readerProgressBar", style: { width: `${progress}%` } }),
        ),
        h(
          "div",
          { className: "rsb-readerScroll", ref: scrollRef, onScroll,
            onWheel: () => { userMoved.current = true; }, onTouchStart: () => { userMoved.current = true; },
            onPointerDown: () => { userMoved.current = true; },
            onKeyDown: (event) => { if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) userMoved.current = true; },
          },
          h("article", { className: "rsb-reader" }, content),
        ),
      );
    }

    /** Load the latest article list and its pagination state. */
    async function loadState(signal, latest) {
      const url = new URL(LATEST_ENDPOINT, document.baseURI);
      url.searchParams.set("limit", "100");
      url.searchParams.set("offset", String(latest.offset));
      if (latest.query !== "") url.searchParams.set("q", latest.query);
      if (latest.category !== null) url.searchParams.set("category", latest.category);
      if (latest.feed != null) url.searchParams.set("feed", String(latest.feed));
      if (latest.tag != null) url.searchParams.set("tag", latest.tag);
      if (latest.format != null) url.searchParams.set("format", latest.format);
      if (latest.unreadOnly) url.searchParams.set("unread", "1");
      if (latest.highQualityOnly) url.searchParams.set("quality", "high");
      if (latest.offset > 0 && latest.snapshot !== null) url.searchParams.set("snapshot", String(latest.snapshot));
      const response = await fetch(url.href, {
        signal,
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }

    /** Load one article body, optionally forcing extraction again. */
    async function loadArticle(id, refresh, signal, cacheOnly = false) {
      const url = new URL(ARTICLE_ENDPOINT, document.baseURI);
      url.searchParams.set("id", String(id));
      if (refresh) url.searchParams.set("refresh", "1");
      if (cacheOnly) url.searchParams.set("cacheOnly", "1");
      const response = await fetch(url.href, {
        signal,
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error((body && (body.error || body.message)) || `HTTP ${response.status}`);
      }
      return body;
    }

    /** Query or explicitly start the current article's WeChat draft task. */
    async function requestPublication(id, start, signal, tr, kind = "publication") {
      const url = new URL(kind === "share" ? "plugin/rss-brief/share" : PUBLICATION_ENDPOINT, document.baseURI);
      if (!start) url.searchParams.set("id", String(id));
      const response = await fetch(url.href, {
        method: start ? "POST" : "GET",
        signal,
        credentials: "same-origin",
        headers: start ? { accept: "application/json", "content-type": "application/json" } : { accept: "application/json" },
        ...(start ? { body: JSON.stringify({ id }) } : {}),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.ok === false) {
        const message = typeof body?.message === "string" ? body.message : `HTTP ${response.status}`;
        throw new Error(typeof body?.code === "string" ? `${body.code}: ${message}` : message);
      }
      const task = body?.task;
      if (body?.ok !== true || (task === null ? start : !task || (kind === "share" && (task.articleType !== "newspic" || !Number.isInteger(task.imageCount) || task.imageCount < 1 || task.imageCount > 3)) || task.articleId !== id || typeof task.taskId !== "string" || !["queued", "running", "succeeded", "failed", "needs_attention"].includes(task.status))) {
        throw new Error(tr(`${kind}.invalid`));
      }
      return task;
    }

    /** Post one action and return the parsed result. */
    async function postAction(path, body) {
      const response = await fetch(new URL(path, document.baseURI).href, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result === null || result.ok === false) {
        throw new Error((result && result.message) || `HTTP ${response.status}`);
      }
      return result;
    }

    /** Fetch preferences stay available independently of the model catalog. */
    function FetchSettings({ tr, onSaved, onSavingChange, onDirtyChange }) {
      const [loading, setLoading] = React.useState(true);
      const [data, setData] = React.useState(null);
      const [minutes, setMinutes] = React.useState("60");
      const [error, setError] = React.useState(null);
      const [saveError, setSaveError] = React.useState(null);
      const [saved, setSaved] = React.useState(false);
      const [saving, setSaving] = React.useState(false);
      const [attempt, setAttempt] = React.useState(0);
      const submitting = React.useRef(false);
      const value = Number(minutes);
      const valid = minutes.trim() !== "" && Number.isInteger(value) && value >= 5 && value <= 10080;
      const dirty = data !== null && value !== data.fetchIntervalMinutes;
      React.useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

      const checkResponse = async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || body?.ok !== true) {
          throw new Error(body?.message || body?.error || `HTTP ${response.status}`);
        }
        if (!Number.isInteger(body.fetchIntervalMinutes) || body.fetchIntervalMinutes < 5 || body.fetchIntervalMinutes > 10080) {
          throw new Error(tr("schedule.invalidResponse"));
        }
        return body;
      };

      React.useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        fetch(new URL(SCHEDULE_ENDPOINT, document.baseURI).href, {
          signal: controller.signal, credentials: "same-origin", headers: { accept: "application/json" },
        }).then(checkResponse).then((body) => {
          if (controller.signal.aborted) return;
          setData(body);
          setMinutes(String(body.fetchIntervalMinutes));
          setLoading(false);
        }).catch((cause) => {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : String(cause));
          setLoading(false);
        });
        return () => controller.abort();
      }, [attempt]);

      const submit = async (event) => {
        event.preventDefault();
        if (submitting.current || loading || data === null || !valid || !dirty) return;
        submitting.current = true;
        setSaving(true);
        onSavingChange(true);
        setSaved(false);
        setSaveError(null);
        try {
          const body = await checkResponse(await fetch(new URL(SCHEDULE_ENDPOINT, document.baseURI).href, {
            method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
            body: JSON.stringify({ fetchIntervalMinutes: value }),
          }));
          setData(body);
          setMinutes(String(body.fetchIntervalMinutes));
          setSaved(true);
          onSaved();
        } catch (cause) {
          setSaveError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          submitting.current = false;
          setSaving(false);
          onSavingChange(false);
        }
      };

      return h("form", { className: "rsb-field", onSubmit: submit, noValidate: true, "aria-busy": loading || saving },
        h("h3", { className: "rsb-choiceTitle" }, tr("schedule.title")),
        h("p", { className: "rsb-choiceHint", id: "rsb-fetch-hint" }, tr("schedule.hint")),
        loading ? h("div", { className: "rsb-dialogLoading", role: "status" }, tr("schedule.loading"))
          : error !== null ? h(React.Fragment, null,
            h("p", { className: "rsb-dialogError", role: "alert" }, tr("schedule.error"), "：", error),
            h("button", { type: "button", className: "rsb-btn rsb-btn--outline rsb-btn--sm", onClick: () => setAttempt((current) => current + 1) }, tr("settings.retry")))
          : h(React.Fragment, null,
            h("div", { className: "rsb-presets", role: "group", "aria-label": tr("schedule.presets") },
              [[30, "halfHour"], [60, "hour"], [360, "sixHours"], [1440, "day"]].map(([interval, label]) =>
                h("button", { key: interval, type: "button", className: "rsb-btn rsb-btn--outline rsb-btn--sm",
                  disabled: saving, "aria-pressed": value === interval,
                  onClick: () => { setMinutes(String(interval)); setSaved(false); setSaveError(null); },
                }, tr(`schedule.${label}`)))),
            h("label", { className: "rsb-fieldLabel", htmlFor: "rsb-fetch-minutes" }, tr("schedule.minutes")),
            h("input", {
              id: "rsb-fetch-minutes", className: "rsb-select", type: "number", min: 5, max: 10080, step: 1, required: true,
              value: minutes, disabled: saving, "aria-describedby": "rsb-fetch-hint", "aria-invalid": !valid,
              onChange: (event) => { setMinutes(event.target.value); setSaved(false); setSaveError(null); },
            }),
            !valid ? h("p", { className: "rsb-dialogError", role: "alert" }, tr("schedule.invalid")) : null,
            saveError !== null ? h("p", { className: "rsb-dialogError", role: "alert" }, tr("schedule.saveError"), "：", saveError) : null,
            saved ? h("p", { className: "rsb-dialogOk", role: "status" }, tr("schedule.saved")) : null,
            h("button", { type: "submit", className: "rsb-btn rsb-btn--outline", disabled: saving || !valid || !dirty },
              tr(saving ? "settings.saving" : "schedule.save"))));
    }

    /** Analysis preferences use their own endpoint and never write the creation route. */
    function AnalysisSettings({ tr, onSavingChange, onDirtyChange }) {
      const [data, setData] = React.useState(null);
      const [loading, setLoading] = React.useState(true);
      const [error, setError] = React.useState(null);
      const [attempt, setAttempt] = React.useState(0);
      const [custom, setCustom] = React.useState(false);
      const [provider, setProvider] = React.useState("");
      const [model, setModel] = React.useState("");
      const [enabled, setEnabled] = React.useState(true);
      const [perSync, setPerSync] = React.useState("40");
      const [saving, setSaving] = React.useState(false);
      const [saved, setSaved] = React.useState(false);
      const [saveError, setSaveError] = React.useState(null);
      const submitting = React.useRef(false);
      const accept = (body) => {
        if (body?.ok !== true || typeof body.enabled !== "boolean" || !Number.isInteger(body.perSync)
          || body.perSync < 1 || body.perSync > 200) throw new Error(tr("analysis.error"));
        setData((previous) => ({ ...previous, ...body, providers: Array.isArray(body.providers) ? body.providers : previous?.providers ?? [] }));
        const route = body.pinned ?? body.saved;
        setCustom(Boolean(route));
        setProvider(route?.provider ?? "");
        setModel(route?.model ?? "");
        setEnabled(body.enabled);
        setPerSync(String(body.perSync));
      };
      React.useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        fetch(new URL(ANALYSIS_SETTINGS_ENDPOINT, document.baseURI).href, {
          credentials: "same-origin", signal: controller.signal, headers: { accept: "application/json" },
        }).then(async (response) => {
          const body = await response.json().catch(() => null);
          if (!response.ok) throw new Error(body?.message || body?.error || `HTTP ${response.status}`);
          if (!controller.signal.aborted) { accept(body); setLoading(false); }
        }).catch((cause) => {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : String(cause));
          setLoading(false);
        });
        return () => controller.abort();
      }, [attempt]);
      const providers = data?.providers ?? [];
      const group = providers.find((entry) => entry.id === provider);
      const models = group?.models ?? [];
      const pinned = data?.pinned != null;
      const limit = Number(perSync);
      const valid = perSync.trim() !== "" && Number.isInteger(limit) && limit >= 1 && limit <= 200
        && (!custom || (provider !== "" && model !== ""));
      const original = data?.pinned ?? data?.saved;
      const dirty = data !== null && (enabled !== data.enabled || limit !== data.perSync
        || custom !== Boolean(original) || (custom && (provider !== original?.provider || model !== original?.model)));
      React.useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
      const change = (setter, value) => { setter(value); setSaved(false); setSaveError(null); };
      const submit = async (event) => {
        event.preventDefault();
        if (!data || loading || submitting.current || !valid) return;
        submitting.current = true;
        setSaving(true);
        onSavingChange(true);
        setSaved(false);
        setSaveError(null);
        try {
          const result = await postAction(ANALYSIS_SETTINGS_ENDPOINT, {
            provider: custom ? provider : "", model: custom ? model : "", enabled, perSync: limit,
          });
          accept(result);
          setSaved(true);
        } catch (cause) {
          setSaveError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          submitting.current = false;
          setSaving(false);
          onSavingChange(false);
        }
      };
      return h("form", { className: "rsb-settingsSection", onSubmit: submit, noValidate: true, "aria-busy": saving || loading },
        h("h3", { className: "rsb-choiceTitle" }, tr("analysis.title")),
        h("p", { className: "rsb-choiceHint" }, tr("analysis.hint")),
        loading ? h("div", { className: "rsb-dialogLoading", role: "status" }, tr("settings.loading"))
          : error !== null ? h(React.Fragment, null,
            h("p", { className: "rsb-dialogError", role: "alert" }, tr("analysis.error"), "：", error),
            h("button", { type: "button", className: "rsb-btn rsb-btn--outline", onClick: () => setAttempt((value) => value + 1) }, tr("settings.retry")))
          : h(React.Fragment, null,
            h("label", { className: "rsb-choice" },
              h("input", { type: "checkbox", checked: enabled, disabled: saving, onChange: (event) => change(setEnabled, event.target.checked) }),
              h("span", { className: "rsb-choiceTitle" }, tr("analysis.enabled"))),
            h("label", { className: "rsb-field", htmlFor: "rsb-analysis-limit" },
              h("span", { className: "rsb-fieldLabel" }, tr("analysis.perSync")),
              h("input", { id: "rsb-analysis-limit", className: "rsb-select", type: "number", min: 1, max: 200, step: 1, required: true,
                value: perSync, disabled: saving, "aria-describedby": "rsb-analysis-limit-hint", onChange: (event) => change(setPerSync, event.target.value) })),
            h("p", { className: "rsb-choiceHint", id: "rsb-analysis-limit-hint" }, tr("analysis.limitHint")),
            h("label", { className: "rsb-field", htmlFor: "rsb-analysis-mode" },
              h("span", { className: "rsb-fieldLabel" }, tr("analysis.modelTitle")),
              h("select", { id: "rsb-analysis-mode", className: "rsb-select", value: custom ? "custom" : "inherit", disabled: saving || pinned,
                onChange: (event) => change(setCustom, event.target.value === "custom") },
                h("option", { value: "inherit" }, tr("analysis.inherit")), h("option", { value: "custom" }, tr("settings.custom")))),
            pinned ? h("p", { className: "rsb-note" }, tr("analysis.pinned")) : null,
            custom ? h("div", { className: "rsb-modelGrid" },
              h("label", { className: "rsb-field", htmlFor: "rsb-analysis-provider" },
                h("span", { className: "rsb-fieldLabel" }, tr("settings.provider")),
                h("select", { id: "rsb-analysis-provider", className: "rsb-select", value: provider, disabled: saving || pinned,
                  onChange: (event) => { change(setProvider, event.target.value); setModel(""); } },
                  h("option", { value: "" }, tr("settings.chooseProvider")),
                  provider && !group ? h("option", { value: provider }, provider) : null,
                  providers.map((entry) => h("option", { key: entry.id, value: entry.id }, entry.name || entry.id)))),
              h("label", { className: "rsb-field", htmlFor: "rsb-analysis-model" },
                h("span", { className: "rsb-fieldLabel" }, tr("settings.model")),
                h("select", { id: "rsb-analysis-model", className: "rsb-select", value: model, disabled: saving || pinned || !provider,
                  onChange: (event) => change(setModel, event.target.value) },
                  h("option", { value: "" }, tr("settings.chooseModel")),
                  model && !models.some((entry) => entry.id === model) ? h("option", { value: model }, model) : null,
                  models.map((entry) => h("option", { key: entry.id, value: entry.id }, entry.name || entry.id)))),
              group?.error ? h("p", { className: "rsb-choiceHint" }, group.error) : null) : null,
            h("p", { className: "rsb-note" }, tr("settings.effective"), "：",
              data?.effective ? `${data.effective.provider}/${data.effective.model}` : "—",
              data?.effective?.source ? `（${tr(`settings.source.${data.effective.source}`)}）` : ""),
            data?.catalogError || data?.error ? h("p", { className: "rsb-choiceHint", role: "status" }, data.error || data.catalogError) : null,
            !valid ? h("p", { className: "rsb-dialogError", role: "alert" }, tr("analysis.invalid")) : null,
            saveError ? h("p", { className: "rsb-dialogError", role: "alert" }, saveError) : null,
            saved ? h("p", { className: "rsb-dialogOk", role: "status" }, tr("analysis.saved")) : null,
            h("button", { type: "submit", className: "rsb-btn rsb-btn--outline", disabled: saving || !valid || !dirty }, tr(saving ? "settings.saving" : "analysis.save")),
          ),
      );
    }

    function validSubscriptionSnapshot(body) {
      return typeof body?.revision === "string" && Array.isArray(body.categories)
        && body.categories.every((group) => typeof group === "string") && Array.isArray(body.feeds)
        && body.feeds.every((feed) => feed && ["title", "xmlUrl", "htmlUrl", "group"].every((key) => typeof feed[key] === "string"));
    }

    /** Subscription editor is independent of article filters and model catalogs. */
    function SubscriptionSettings({ tr, onClose, onSaved }) {
      const [data, setData] = React.useState(null);
      const [loading, setLoading] = React.useState(true);
      const [saving, setSaving] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      const [search, setSearch] = React.useState("");
      const [editor, setEditor] = React.useState(null);
      const [removal, setRemoval] = React.useState(null);
      const request = React.useRef(null);
      const busy = React.useRef(false);
      const dialogRef = React.useRef(null);

      const load = React.useCallback(() => {
        if (busy.current) return;
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        setLoading(true);
        setError(null);
        fetch(new URL(SUBSCRIPTIONS_ENDPOINT, document.baseURI).href, {
          signal: controller.signal, credentials: "same-origin", headers: { accept: "application/json" },
        }).then(async (response) => {
          const body = await response.json().catch(() => null);
          if (!response.ok || body?.ok !== true) throw new Error(body?.message || body?.error || `HTTP ${response.status}`);
          if (controller.signal.aborted) return;
          if (!validSubscriptionSnapshot(body)) throw new Error(tr("subscriptions.invalidResponse"));
          setData(body);
        }).catch((cause) => {
          if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
        }).finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
      }, []);
      React.useEffect(() => { load(); return () => request.current?.abort(); }, [load]);
      React.useEffect(() => {
        const previous = document.activeElement;
        dialogRef.current?.focus();
        return () => previous?.focus?.();
      }, []);
      React.useEffect(() => {
        const keydown = (event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            if (busy.current) return;
            if (removal !== null) setRemoval(null);
            else if (editor !== null) setEditor(null);
            else onClose();
          }
          if (event.key === "Tab" && dialogRef.current) {
            const fields = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
            const first = fields[0], last = fields[fields.length - 1];
            if (first && (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)
              || !event.shiftKey && document.activeElement === last)) {
              event.preventDefault(); (event.shiftKey ? last : first).focus();
            }
          }
        };
        document.addEventListener("keydown", keydown);
        return () => document.removeEventListener("keydown", keydown);
      }, [onClose, editor, removal]);

      const beginEdit = (feed = null) => {
        setEditor({ originalUrl: feed?.xmlUrl ?? null, feed: feed ? { ...feed } : {
          title: "", xmlUrl: "", htmlUrl: "", group: data.categories[0] ?? tr("subscriptions.ungrouped"),
        } });
        setRemoval(null); setError(null); setNotice(null);
      };
      React.useEffect(() => {
        if (editor === null && removal === null) return;
        const dialog = dialogRef.current;
        const body = dialog?.querySelector(".rsb-dialogBody");
        if (body) body.scrollTop = 0;
        dialog?.querySelector(editor !== null ? "#rsb-subscription-title" : ".rsb-subscriptionRemoval button")?.focus();
      }, [editor?.originalUrl, editor !== null, removal?.xmlUrl]);
      const changeField = (key, value) => {
        setEditor((previous) => ({ ...previous, feed: { ...previous.feed, [key]: value } }));
        setError(null); setNotice(null);
      };
      const mutate = async (action) => {
        if (busy.current || loading || data === null) return;
        const payload = { action, revision: data.revision };
        if (action === "delete") payload.originalUrl = removal.xmlUrl;
        else {
          const feed = Object.fromEntries(Object.entries(editor.feed).map(([key, value]) => [key, value.trim()]));
          if (!feed.title || !feed.xmlUrl || !feed.group) { setError(tr("subscriptions.required")); return; }
          for (const key of ["xmlUrl", "htmlUrl"]) {
            if (key === "htmlUrl" && feed[key] === "") continue;
            try {
              const url = new URL(feed[key]);
              if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid URL");
              feed[key] = url.href;
            } catch {
              setError(tr(key === "xmlUrl" ? "subscriptions.required" : "subscriptions.homeInvalid")); return;
            }
          }
          if (data.feeds.some((other) => other.xmlUrl !== editor.originalUrl && other.xmlUrl === feed.xmlUrl)) {
            setError(tr("subscriptions.duplicate")); return;
          }
          payload.feed = feed;
          if (action === "update") payload.originalUrl = editor.originalUrl;
        }
        busy.current = true;
        setSaving(true); setError(null); setNotice(null);
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        try {
          const response = await fetch(new URL(SUBSCRIPTIONS_ENDPOINT, document.baseURI).href, {
            method: "POST", signal: controller.signal, credentials: "same-origin",
            headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(payload),
          });
          const body = await response.json().catch(() => null);
          if (controller.signal.aborted) return;
          if (response.status === 409) throw new Error(tr("subscriptions.conflict"));
          if (!response.ok || body?.ok !== true) throw new Error(body?.message || body?.error || `HTTP ${response.status}`);
          if (!validSubscriptionSnapshot(body)) throw new Error(tr("subscriptions.invalidResponse"));
          setData(body); setEditor(null); setRemoval(null);
          setNotice(tr(action === "delete" ? "subscriptions.removed" : "subscriptions.saved"));
          onSaved?.();
        } catch (cause) {
          if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          busy.current = false;
          if (!controller.signal.aborted) setSaving(false);
        }
      };
      const matches = data?.feeds.filter((feed) => [feed.title, feed.xmlUrl, feed.group].some((value) => value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))) ?? [];
      const fields = [["title", "subscriptions.name", "text", 300], ["xmlUrl", "subscriptions.feedUrl", "url", 2048],
        ["htmlUrl", "subscriptions.homeUrl", "url", 2048], ["group", "subscriptions.group", "text", 120]];
      return h("div", { className: "rsb-overlay", onMouseDown: (event) => {
        if (event.target === event.currentTarget && !busy.current && editor === null && removal === null) onClose();
      } },
        h("div", { className: "rsb-dialog rsb-subscriptionsDialog", role: "dialog", "aria-modal": "true",
          "aria-label": tr("subscriptions.title"), tabIndex: -1, ref: dialogRef },
          h("div", { className: "rsb-dialogHead" },
            h("div", { className: "rsb-dialogHeadText" },
              h("h2", { className: "rsb-dialogTitle" }, tr("subscriptions.title")),
              h("p", { className: "rsb-dialogSubtitle" }, tr("subscriptions.subtitle"))),
            h("button", { type: "button", className: "rsb-btn rsb-btn--ghost rsb-btn--icon", disabled: saving,
              "aria-label": tr("settings.close"), onClick: onClose }, h(Icon, { name: "x", size: 15 }))),
          h("div", { className: "rsb-dialogBody rsb-subscriptionsBody" },
            h("div", { className: "rsb-subscriptionToolbar" },
              h("input", { className: "rsb-input", type: "search", value: search, "aria-label": tr("subscriptions.search"),
                placeholder: tr("subscriptions.search"), onChange: (event) => setSearch(event.target.value) }),
              h("button", { type: "button", className: "rsb-btn rsb-btn--outline", disabled: saving || loading || data === null,
                onClick: () => beginEdit() }, tr("subscriptions.add")),
              h("button", { type: "button", className: "rsb-btn rsb-btn--ghost rsb-btn--icon", disabled: saving || loading,
                title: tr("subscriptions.reload"), "aria-label": tr("subscriptions.reload"), onClick: load }, h(Icon, { name: "refresh", size: 15 }))),
            loading ? h("p", { role: "status", className: "rsb-note" }, tr("settings.loading")) : null,
            error ? h("p", { role: "alert", className: "rsb-dialogError" }, error) : null,
            notice ? h("p", { role: "status", className: "rsb-dialogOk" }, notice) : null,
            editor ? h("form", { className: "rsb-subscriptionEditor", noValidate: true, "aria-busy": saving,
              onSubmit: (event) => { event.preventDefault(); void mutate(editor.originalUrl === null ? "add" : "update"); } },
              h("h3", { className: "rsb-choiceTitle" }, tr(editor.originalUrl === null ? "subscriptions.add" : "subscriptions.editTitle")),
              fields.map(([key, label, type, maxLength]) => h("div", { className: "rsb-field", key },
                h("label", { className: "rsb-fieldLabel", htmlFor: `rsb-subscription-${key}` }, tr(label)),
                h("input", { id: `rsb-subscription-${key}`, type, className: "rsb-input", value: editor.feed[key], disabled: saving,
                  maxLength, required: key !== "htmlUrl", list: key === "group" ? "rsb-subscription-groups" : undefined,
                  placeholder: key === "group" ? tr("subscriptions.groupHint") : undefined,
                  onChange: (event) => changeField(key, event.target.value) }))),
              h("datalist", { id: "rsb-subscription-groups" }, data.categories.map((group) => h("option", { key: group, value: group }))),
              h("div", { className: "rsb-actions" },
                h("button", { type: "button", className: "rsb-btn rsb-btn--ghost", disabled: saving, onClick: () => { setEditor(null); setError(null); } }, tr("subscriptions.cancel")),
                h("button", { type: "submit", className: "rsb-btn rsb-btn--outline", disabled: saving || loading }, tr(saving ? "settings.saving" : "settings.save")))) : null,
            removal ? h("div", { className: "rsb-subscriptionRemoval", role: "group", "aria-label": tr("subscriptions.delete") },
              h("p", null, tr("subscriptions.confirmDelete", { title: removal.title })),
              h("div", { className: "rsb-actions" },
                h("button", { type: "button", className: "rsb-btn rsb-btn--ghost", disabled: saving, onClick: () => { setRemoval(null); setError(null); } }, tr("subscriptions.cancel")),
                h("button", { type: "button", className: "rsb-btn rsb-btn--outline", disabled: saving || loading, onClick: () => void mutate("delete") }, tr("subscriptions.confirm")))) : null,
            data ? h("p", { className: "rsb-choiceHint" }, tr("subscriptions.count", { count: data.feeds.length })) : null,
            data && matches.length === 0 ? h("p", { className: "rsb-note" }, tr(data.feeds.length === 0 ? "subscriptions.empty" : "subscriptions.noMatches")) : null,
            h("div", { className: "rsb-subscriptionList" }, matches.map((feed) => h("div", { key: feed.xmlUrl, className: "rsb-subscriptionRow" },
              h(FeedIcon, { article: { feed: feed.title, feedUrl: feed.htmlUrl || feed.xmlUrl } }),
              h("div", { className: "rsb-subscriptionInfo" }, h("strong", null, feed.title),
                h("span", { className: "rsb-choiceHint" }, feed.group),
                h("span", { className: "rsb-choiceHint", title: feed.xmlUrl }, feed.xmlUrl)),
              h("button", { type: "button", className: "rsb-btn rsb-btn--ghost rsb-btn--sm", disabled: saving || loading,
                "aria-label": `${tr("subscriptions.edit")} ${feed.title}`, onClick: () => beginEdit(feed) }, tr("subscriptions.edit")),
              h("button", { type: "button", className: "rsb-btn rsb-btn--ghost rsb-btn--sm", disabled: saving || loading,
                "aria-label": `${tr("subscriptions.delete")} ${feed.title}`, onClick: () => { setRemoval(feed); setEditor(null); setError(null); setNotice(null); } }, tr("subscriptions.delete")),
            ))),
          ),
          h("div", { className: "rsb-dialogFoot" }, h("button", { type: "button", className: "rsb-btn rsb-btn--ghost", disabled: saving, onClick: onClose }, tr("settings.close"))),
        ),
      );
    }

    /** Reading settings with independent fetch and article creation preferences. */
    function ModelSettings({ tr, onClose, onScheduleSaved, onManageSubscriptions }) {
      const [loading, setLoading] = React.useState(true);
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [mode, setMode] = React.useState("default");
      const [provider, setProvider] = React.useState("");
      const [model, setModel] = React.useState("");
      const [saving, setSaving] = React.useState(false);
      const [saveError, setSaveError] = React.useState(null);
      const [saved, setSaved] = React.useState(false);
      const [scheduleSaving, setScheduleSaving] = React.useState(false);
      const [analysisSaving, setAnalysisSaving] = React.useState(false);
      const busy = saving || scheduleSaving || analysisSaving;
      const [section, setSection] = React.useState("fetch");
      const [scheduleDirty, setScheduleDirty] = React.useState(false);
      const [analysisDirty, setAnalysisDirty] = React.useState(false);
      const [leaveAction, setLeaveAction] = React.useState(null);
      const initialRoute = data?.pinned ?? data?.saved;
      const modelDirty = data !== null && (mode !== (initialRoute ? "custom" : "default")
        || (mode === "custom" && (provider !== initialRoute?.provider || model !== initialRoute?.model)));
      const dirty = scheduleDirty || analysisDirty || modelDirty;
      const requestLeave = (action) => {
        if (busy) return;
        if (dirty) setLeaveAction(() => action);
        else action();
      };
      const dialogRef = React.useRef(null);
      const closeRef = React.useRef(null);
      closeRef.current = () => requestLeave(onClose);

      /** Read the catalog and the currently saved selection. */
      const load = React.useCallback(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        fetch(new URL(SETTINGS_ENDPOINT, document.baseURI).href, {
          signal: controller.signal,
          credentials: "same-origin",
          headers: { accept: "application/json" },
        })
          .then(async (response) => {
            const body = await response.json().catch(() => null);
            if (!response.ok) {
              throw new Error((body && (body.message || body.error)) || `HTTP ${response.status}`);
            }
            return body;
          })
          .then((body) => {
            const catalog = Array.isArray(body.providers) ? body.providers : [];
            const initial = body.pinned ?? body.saved ?? body.effective ?? null;
            const group = catalog.find((entry) => entry.id === initial?.provider) ?? catalog[0] ?? null;
            setData({ ...body, providers: catalog });
            setMode(body.pinned !== null || body.saved !== null ? "custom" : "default");
            setProvider(group?.id ?? "");
            setModel(initial?.model ?? group?.models?.[0]?.id ?? "");
            setLoading(false);
          })
          .catch((cause) => {
            if (cause && cause.name === "AbortError") return;
            setError(cause instanceof Error ? cause.message : String(cause));
            setLoading(false);
          });
        return () => controller.abort();
      }, []);

      React.useEffect(load, [load]);
      React.useEffect(() => {
        const previousFocus = document.activeElement;
        dialogRef.current?.focus();
        const onKeyDown = (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeRef.current();
          }
          if (event.key !== "Tab") return;
          const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
            .filter((element) => element.getClientRects().length > 0);
          const first = controls[0], last = controls[controls.length - 1];
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
            event.preventDefault(); first.focus();
          }
        };
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
          document.removeEventListener("keydown", onKeyDown, true);
          if (previousFocus?.isConnected) previousFocus.focus();
        };
      }, []);

      const pinned = data?.pinned ?? null;
      const providers = data?.providers ?? [];
      const group = providers.find((entry) => entry.id === provider) ?? null;
      const models = group?.models ?? [];
      const effective = data?.effective ?? null;
      const effectiveText = effective ? `${effective.provider}/${effective.model}` : "—";
      const sourceText = effective ? tr(`settings.source.${effective.source}`) : "";
      const locked = pinned !== null || saving;

      const chooseProvider = (nextProvider) => {
        const nextGroup = providers.find((entry) => entry.id === nextProvider) ?? null;
        setProvider(nextProvider);
        setModel(nextGroup?.models?.[0]?.id ?? "");
        setSaved(false);
      };

      const submit = async (override) => {
        const payload = override ?? (mode === "custom" ? { provider, model } : { provider: "", model: "" });
        if (payload.provider !== "" && payload.model === "") {
          setSaveError(tr("settings.chooseModel"));
          return;
        }
        setSaving(true);
        setSaveError(null);
        setSaved(false);
        try {
          const response = await fetch(new URL(SETTINGS_ENDPOINT, document.baseURI).href, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
          const body = await response.json().catch(() => null);
          if (!response.ok || body === null || body.ok === false) {
            throw new Error((body && (body.message || body.error)) || `HTTP ${response.status}`);
          }
          setData((previous) => previous === null
            ? previous
            : { ...previous, saved: body.saved ?? null, effective: body.effective ?? previous.effective });
          if (body.saved === null) setMode("default");
          setSaved(true);
        } catch (cause) {
          setSaveError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setSaving(false);
        }
      };

      let content;
      if (loading) {
        content = h("div", { className: "rsb-dialogLoading" },
          h(Icon, { name: "loader", size: 15, spin: true }),
          tr("settings.loading"));
      } else if (error !== null) {
        content = h(React.Fragment, null,
          h("p", { className: "rsb-dialogError" }, tr("settings.error"), "：", error),
          h("div", null,
            h("button", { type: "button", className: "rsb-btn rsb-btn--outline rsb-btn--sm", onClick: load },
              tr("settings.retry"))));
      } else if (providers.length === 0) {
        content = h(React.Fragment, null,
          h("p", { className: "rsb-note" }, tr("settings.empty")),
          h("p", { className: "rsb-choiceHint" },
            data?.catalogError ? `${tr("settings.emptyHint")}（${data.catalogError}）` : tr("settings.emptyHint")));
      } else {
        content = h(React.Fragment, null,
          pinned === null ? null : h("p", { className: "rsb-note" },
            h("strong", null, tr("settings.pinned")), " ", tr("settings.pinnedHint")),
          h("label", { className: "rsb-choice", "data-active": String(mode === "default"), "data-disabled": String(locked) },
            h("input", {
              type: "radio", name: "rsb-model-mode",
              checked: mode === "default", disabled: locked,
              onChange: () => { setMode("default"); setSaved(false); },
            }),
            h("span", { className: "rsb-choiceText" },
              h("span", { className: "rsb-choiceTitle" }, tr("settings.follow")),
              h("span", { className: "rsb-choiceHint" },
                data?.default
                  ? tr("settings.currentDefault", { model: `${data.default.provider}/${data.default.model}` })
                  : tr("settings.followHint")))),
          h("label", { className: "rsb-choice", "data-active": String(mode === "custom"), "data-disabled": String(locked) },
            h("input", {
              type: "radio", name: "rsb-model-mode",
              checked: mode === "custom", disabled: locked,
              onChange: () => { setMode("custom"); setSaved(false); },
            }),
            h("span", { className: "rsb-choiceText" },
              h("span", { className: "rsb-choiceTitle" }, tr("settings.custom")),
              h("span", { className: "rsb-choiceHint" }, tr("settings.customHint")))),
          h("div", { className: "rsb-field", hidden: mode !== "custom" },
            h("label", { className: "rsb-fieldLabel", htmlFor: "rsb-model-provider" }, tr("settings.provider")),
            h("select", {
              id: "rsb-model-provider", className: "rsb-select", value: provider,
              disabled: locked || mode !== "custom",
              onChange: (event) => chooseProvider(event.target.value),
            }, providers.map((entry) => h("option", { key: entry.id, value: entry.id }, entry.name)))),
          h("div", { className: "rsb-field", hidden: mode !== "custom" },
            h("label", { className: "rsb-fieldLabel", htmlFor: "rsb-model-id" }, tr("settings.model")),
            h("select", {
              id: "rsb-model-id", className: "rsb-select", value: model,
              disabled: locked || mode !== "custom" || models.length === 0,
              onChange: (event) => { setModel(event.target.value); setSaved(false); },
            }, models.length === 0
              ? h("option", { value: "" }, tr("settings.empty"))
              : models.map((entry) => h("option", { key: entry.id, value: entry.id }, entry.name)))),
          group?.error ? h("p", { className: "rsb-choiceHint" }, group.error) : null,
          saved ? h("p", { className: "rsb-dialogOk" }, tr("settings.saved")) : null,
          saveError !== null ? h("p", { className: "rsb-dialogError" }, saveError) : null,
          h("p", { className: "rsb-choiceHint" }, tr("settings.hint")));
      }

      const sections = [
        ["fetch", "settings.fetchTab", scheduleDirty],
        ["analysis", "settings.analysisTab", analysisDirty],
        ["creation", "settings.creationTab", modelDirty],
      ];
      return h("div", {
        className: "rsb-overlay",
        onMouseDown: (event) => { if (event.target === event.currentTarget) requestLeave(onClose); },
      },
        h("div", {
          className: "rsb-dialog rsb-preferences", role: "dialog", "aria-modal": "true",
          "aria-label": tr("settings.title"), tabIndex: -1, ref: dialogRef,
        },
          h("div", { className: "rsb-dialogHead" },
            h("div", { className: "rsb-dialogHeadText" },
              h("h2", { className: "rsb-dialogTitle" }, tr("settings.title")),
              h("p", { className: "rsb-dialogSubtitle" }, tr("settings.subtitle"))),
            h("button", {
              type: "button", className: "rsb-btn rsb-btn--ghost rsb-btn--icon",
              title: tr("settings.close"), "aria-label": tr("settings.close"), disabled: busy,
              onClick: () => requestLeave(onClose),
            }, h(Icon, { name: "x", size: 15 }))),
          h("div", { className: "rsb-preferencesLayout" },
            h("nav", { className: "rsb-preferencesNav", "aria-label": tr("settings.title") },
              sections.map(([id, label, changed]) => h("button", {
                key: id, type: "button", className: "rsb-preferencesTab",
                "aria-current": section === id ? "page" : undefined,
                "aria-controls": `rsb-preferences-${id}`, disabled: busy,
                onClick: () => { setSection(id); setLeaveAction(null); },
              }, tr(label), changed ? h("span", { className: "rsb-dirtyDot", "aria-label": tr("settings.unsaved") }, "•") : null)),
              onManageSubscriptions ? h("button", {
                type: "button", className: "rsb-preferencesTab rsb-subscriptionsLink", disabled: busy,
                onClick: () => requestLeave(onManageSubscriptions),
              }, h(Icon, { name: "rss", size: 15 }), tr("subscriptions.title")) : null),
            h("div", { className: "rsb-preferencesContent" },
              h("section", { id: "rsb-preferences-fetch", hidden: section !== "fetch", "aria-label": tr("settings.fetchTab") },
                h(FetchSettings, { tr, onSaved: onScheduleSaved, onSavingChange: setScheduleSaving, onDirtyChange: setScheduleDirty })),
              h("section", { id: "rsb-preferences-analysis", hidden: section !== "analysis", "aria-label": tr("settings.analysisTab") },
                h(AnalysisSettings, { tr, onSavingChange: setAnalysisSaving, onDirtyChange: setAnalysisDirty })),
              h("section", { id: "rsb-preferences-creation", hidden: section !== "creation", "aria-label": tr("settings.creationTab") },
                h("div", { className: "rsb-creationFields" },
                  h("h3", { className: "rsb-choiceTitle" }, tr("settings.modelTitle")),
                  h("p", { className: "rsb-choiceHint" }, tr("settings.creationHint")),
                  content,
                  h("p", { className: "rsb-note" }, tr("settings.effective"), "：", effectiveText, sourceText ? `（${sourceText}）` : ""),
                  h("div", { className: "rsb-settingsActions" },
                    h("button", {
                      type: "button", className: "rsb-btn rsb-btn--outline",
                      disabled: locked || loading || error !== null || !modelDirty || providers.length === 0 || (mode === "custom" && model === ""),
                      onClick: () => void submit(),
                    }, tr(saving ? "settings.saving" : "settings.saveCreation"))))))),
          h("div", { className: "rsb-dialogFoot rsb-preferencesFoot" },
            leaveAction ? h(React.Fragment, null,
              h("span", { className: "rsb-leavePrompt", role: "alert" }, tr("settings.discardPrompt")),
              h("button", { type: "button", className: "rsb-btn rsb-btn--ghost", onClick: () => { setLeaveAction(null); dialogRef.current?.focus(); } }, tr("settings.keepEditing")),
              h("button", { type: "button", className: "rsb-btn rsb-btn--outline", onClick: leaveAction }, tr("settings.discard")))
              : h(React.Fragment, null,
                h("span", { className: "rsb-saveHint", role: "status" }, tr(dirty ? "settings.unsaved" : "settings.savedHint")),
                h("button", { type: "button", className: "rsb-btn rsb-btn--ghost", disabled: busy, onClick: () => requestLeave(onClose) }, tr("settings.close"))))));
    }

    /** Boolean switch state remembered in browser storage. */
    function useStoredSwitch(key, fallback) {
      const [value, setValue] = React.useState(() => {
        try {
          const stored = window.localStorage.getItem(key);
          return stored === null ? fallback : stored === "true";
        } catch { return fallback; }
      });
      React.useEffect(() => {
        try { window.localStorage.setItem(key, String(value)); }
        catch { /* The switch still works when browser storage is unavailable. */ }
      }, [key, value]);
      return [value, setValue];
    }

    /** Keyboard and pointer resizing within the owning panel, with pointer-capture cleanup. */
    function ColumnDivider({ label, hint, value, minimum, maximum, defaultValue, percent = false, onChange }) {
      const drag = React.useRef(null);
      return h("div", {
        className: "rsb-columnDivider", role: "separator", tabIndex: 0,
        "aria-orientation": "vertical", "aria-label": label, title: `${label} · ${hint}`,
        "aria-valuenow": value, "aria-valuemin": minimum, "aria-valuemax": maximum,
        "aria-valuetext": `${value}${percent ? "%" : "px"}`,
        onPointerDown: (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          drag.current = { id: event.pointerId, x: event.clientX, value, width: event.currentTarget.parentElement.clientWidth };
          event.currentTarget.setPointerCapture(event.pointerId);
        },
        onPointerMove: (event) => {
          if (drag.current?.id !== event.pointerId) return;
          const change = (event.clientX - drag.current.x) * (percent ? 100 / drag.current.width : 1);
          onChange(Math.max(minimum, Math.min(maximum, Math.round(drag.current.value + change))));
        },
        onPointerUp: (event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        },
        onPointerCancel: () => { drag.current = null; },
        onLostPointerCapture: () => { drag.current = null; },
        onDoubleClick: () => onChange(defaultValue),
        onKeyDown: (event) => {
          const step = percent ? (event.shiftKey ? 5 : 1) : (event.shiftKey ? 32 : 8);
          const next = event.key === "ArrowLeft" ? value - step : event.key === "ArrowRight" ? value + step
            : event.key === "Home" ? minimum : event.key === "End" ? maximum : null;
          if (next === null) return;
          event.preventDefault();
          onChange(Math.max(minimum, Math.min(maximum, next)));
        },
      });
    }

    /** Main panel. */
    function RssBriefPage(props) {
      const injected = props && typeof props.t === "function" ? props.t : null;
      const compactMode = true;
      const [columnWidths, setColumnWidths] = React.useState(() => {
        try {
          const saved = JSON.parse(window.localStorage.getItem("dsh-rss-brief:columns:v1"));
          return {
            navigation: Number.isFinite(saved?.navigation) ? Math.max(132, Math.min(360, saved.navigation)) : 208,
            list: Number.isFinite(saved?.list) ? Math.max(25, Math.min(70, saved.list)) : 44,
          };
        } catch { return { navigation: 208, list: 44 }; }
      });
      React.useEffect(() => {
        try { window.localStorage.setItem("dsh-rss-brief:columns:v1", JSON.stringify(columnWidths)); }
        catch { /* Width controls still work without browser storage. */ }
      }, [columnWidths]);
      const [latestOffset, setLatestOffset] = React.useState(0);
      const [data, setData] = React.useState(null);
      const [failure, setFailure] = React.useState(null);
      const [pending, setPending] = React.useState(true);
      const [reload, setReload] = React.useState(0);
      const [actionError, setActionError] = React.useState(null);
      const [actionBusy, setActionBusy] = React.useState(null);
      const [unreadOnly, setUnreadOnly] = useStoredSwitch("dsh-rss-brief:unread-only:v1", true);
      const [highQualityOnly, setHighQualityOnly] = useStoredSwitch("dsh-rss-brief:high-quality-only:v1", false);
      const [readBusy, setReadBusy] = React.useState(null);
      const [readNotice, setReadNotice] = React.useState(null);
      const readMutation = React.useRef(null);
      const bulkController = React.useRef(null);
      const listController = React.useRef(null);
      const bulkContext = React.useRef(null);
      const refreshCurrent = React.useRef(null);
      const [reader, setReader] = React.useState(null);
      const [settingsOpen, setSettingsOpen] = React.useState(false);
      const [subscriptionsOpen, setSubscriptionsOpen] = React.useState(false);
      const [query, setQuery] = React.useState("");
      const [selectedCategory, setSelectedCategory] = React.useState(null);
      const [selectedFeed, setSelectedFeed] = React.useState(null);
      const [selectedTag, setSelectedTag] = React.useState(null);
      const [selectedFormat, setSelectedFormat] = React.useState(null);
      const [expandedCategories, setExpandedCategories] = React.useState({});
      const latestSnapshot = React.useRef(null);
      const readerQueue = React.useRef(null);
      const readerRequest = React.useRef(0);
      const readerController = React.useRef(null);
      const bodyRef = React.useRef(null);
      const searchRef = React.useRef(null);
      const articleCache = React.useRef(new Map());
      const readOverrides = React.useRef(new Map());
      const manualReadIntent = React.useRef(new Map());
      const readRevision = React.useRef(0);
      const readingPositions = React.useRef(new Map());
      const listScroll = React.useRef(0);
      const listPosition = React.useRef(null);
      const restoringList = React.useRef(false);
      const readerOpen = React.useRef(false);
      const attachListBody = React.useCallback((element) => {
        bodyRef.current = element;
        if (element && !restoringList.current) element.scrollTop = listScroll.current;
      }, []);
      React.useLayoutEffect(() => {
        if (reader !== null || !restoringList.current || !bodyRef.current) return;
        restoreListPosition(bodyRef.current, listPosition.current);
        listScroll.current = bodyRef.current.scrollTop;
        restoringList.current = false;
      }, [reader, data]);

      const tr = React.useCallback(
        (key, params) => {
          if (injected !== null) {
            const translated = injected(key, params);
            if (typeof translated === "string" && translated !== "" && translated !== key) {
              return translated;
            }
          }
          return format(ZH[key] ?? key, params);
        },
        [injected],
      );

      const serverQuery = query.trim();
      const serverCategory = selectedCategory;
      const serverUnread = unreadOnly;
      React.useEffect(() => {
        let active = true;
        let timer = null;
        let initial = true;
        const controller = new AbortController();
        listController.current = controller;
        const filterKey = JSON.stringify([serverQuery, serverCategory, serverUnread, highQualityOnly, selectedFeed, selectedTag, selectedFormat]);
        setPending(true);
        setFailure(null);
        const run = async () => {
          if (!active || controller.signal.aborted) return;
          if (readerOpen.current && !initial) {
            timer = setTimeout(run, POLL_IDLE_MS);
            return;
          }
          try {
            const versionAtStart = readRevision.current;
            const body = await loadState(controller.signal, {
              query: serverQuery, category: serverCategory, feed: selectedFeed, tag: selectedTag, format: selectedFormat, unreadOnly: serverUnread, highQualityOnly,
              offset: latestOffset, snapshot: latestSnapshot.current,
            });
            if (!active || controller.signal.aborted) return;
            if (readRevision.current !== versionAtStart) {
              timer = setTimeout(run, 250);
              return;
            }
            initial = false;
            if (body.ok !== false) latestSnapshot.current = body.pagination?.snapshot ?? null;
            setData((previous) => {
              const incoming = patchReadIds({ ...body, filterKey }, new Set(), readOverrides.current);
              if ((latestOffset > 0 || readerOpen.current) && previous?.view === "latest" && previous.filterKey === filterKey && body.ok !== false) {
                return mergeLatestPages(previous, incoming);
              }
              return incoming;
            });
            setFailure(body && body.ok === false
              ? { code: body.code, message: body.error || "state-failed" }
              : null);
            setPending(false);
            if (body && body.running) setActionError(null);
            timer = setTimeout(run, body && body.running ? POLL_RUNNING_MS : POLL_IDLE_MS);
          } catch (error) {
            if (!active || controller.signal.aborted || (error && error.name === "AbortError")) return;
            initial = false;
            setFailure({
              code: "request-failed",
              message: error instanceof Error ? error.message : String(error),
            });
            setPending(false);
            timer = setTimeout(run, 15000);
          }
        };
        run();
        return () => {
          active = false;
          controller.abort();
          if (timer !== null) clearTimeout(timer);
        };
      }, [reload, serverQuery, serverCategory, serverUnread, highQualityOnly, selectedFeed, selectedTag, selectedFormat, latestOffset]);

      React.useEffect(
        () => () => {
          if (readerController.current !== null) readerController.current.abort();
          bulkController.current?.abort();
        },
        [],
      );

      const closeReader = React.useCallback(() => {
        if (bodyRef.current && bodyRef.current.clientHeight !== 0) {
          listScroll.current = bodyRef.current.scrollTop;
          listPosition.current = captureListPosition(bodyRef.current);
        }
        readerRequest.current += 1;
        if (readerController.current !== null) {
          readerController.current.abort();
          readerController.current = null;
        }
        readerQueue.current = null;
        readerOpen.current = false;
        restoringList.current = true;
        setReader(null);
      }, []);

      const openArticle = (id, refresh = false) => {
        if (!Number.isInteger(id) || id <= 0) return;
        if (reader === null) {
          readerQueue.current = list.articles.slice();
          if (bodyRef.current) {
            listScroll.current = bodyRef.current.scrollTop;
            listPosition.current = captureListPosition(bodyRef.current);
          }
        } else {
          readerQueue.current = readerArticles.slice();
        }
        readerOpen.current = true;
        const request = ++readerRequest.current;
        if (readerController.current) readerController.current.abort();
        const controller = new AbortController();
        readerController.current = controller;
        const seed = (reader?.id === id ? reader.article : null) || articleCache.current.get(id)
          || [...(readerQueue.current || []), ...list.readerArticles].find((entry) => entry.id === id);
        setReader({ id, article: seed ? { ...seed, contentSource: seed.contentSource || "preview" } : null,
          pending: true, stage: refresh ? "extract" : "cache", error: null });
        let marked = refresh || Boolean(seed?.read);
        const intentAtOpen = manualReadIntent.current.get(id) || 0;
        const currentRequest = () => readerRequest.current === request && !controller.signal.aborted;
        const accept = (body, pending) => {
          if (!body?.ok || !body.article) throw new Error(body?.error || tr("reader.error"));
          const article = { ...body.article, tags: body.article.tags ?? [], read: readOverrides.current.has(id) ? readOverrides.current.get(id) : body.article.read };
          articleCache.current.set(id, article);
          if (articleCache.current.size > 100) articleCache.current.delete(articleCache.current.keys().next().value);
          setReader({ id, article, pending, stage: pending ? "extract" : null, error: null });
          if (!marked && (manualReadIntent.current.get(id) || 0) === intentAtOpen && (article.contentText?.trim() || article.contentDocument?.children?.length)) {
            marked = true;
            if (!article.read) void saveReadState(article, true);
          }
        };
        (async () => {
          try {
            if (!refresh) {
              const cached = await loadArticle(id, false, controller.signal, true);
              if (!currentRequest()) return;
              const complete = !cached.article?.needsExtraction;
              accept(cached, !complete);
              if (complete) return;
            }
            const result = await loadArticle(id, refresh, controller.signal);
            if (currentRequest()) accept(result, false);
          } catch (error) {
            if (!currentRequest() || error?.name === "AbortError") return;
            setReader((current) => current?.id === id ? { ...current, pending: false, stage: null,
              error: error instanceof Error ? error.message : String(error) } : current);
          }
        })();
      };

      // Both opening an unread article and the manual toggle persist through this path.
      const saveReadState = async (article, nextRead) => {
        if (readMutation.current !== null) return;
        readMutation.current = article.id;
        setReadNotice(null);
        setReadBusy(article.id);
        setActionError(null);
        try {
          await postAction(READ_ENDPOINT, { id: article.id, read: nextRead });
          readRevision.current += 1;
          readOverrides.current.set(article.id, nextRead);
          const saved = articleCache.current.get(article.id);
          if (saved) articleCache.current.set(article.id, { ...saved, read: nextRead });
          setData((current) => patchReadState(current, article.id, nextRead, unreadOnly));
          setReader((current) =>
            current !== null &&
            current.article !== null &&
            current.article.id === article.id
              ? { ...current, article: { ...current.article, read: nextRead } }
              : current,
          );
          if (readerQueue.current !== null) {
            readerQueue.current = readerQueue.current.map((entry) =>
              entry.id === article.id ? { ...entry, read: nextRead } : entry,
            );
          }
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error));
        } finally {
          readMutation.current = null;
          setReadBusy((current) => current === article.id ? null : current);
        }
      };

      const toggleRead = (article) => {
        if (readMutation.current !== null || readBusy !== null || article === null || article === undefined || !Number.isInteger(article.id)) return;
        manualReadIntent.current.set(article.id, (manualReadIntent.current.get(article.id) || 0) + 1);
        void saveReadState(article, !article.read);
      };

      const report = data && data.report ? data.report : null;
      const running = data && data.running ? data.running : null;
      const groups = report && Array.isArray(report.groups) ? report.groups : [];
      const warnings = report && Array.isArray(report.warnings) ? report.warnings : [];
      const feedErrors = Array.isArray(data?.feeds?.errors)
        ? data.feeds.errors
        : report && Array.isArray(report.feedErrors) ? report.feedErrors : [];
      const fallback = Boolean(report && report.fallback);
      const queryText = query.trim();
      const searching = queryText !== "";
      const latestList = buildArticleList(groups, { unreadOnly });
      const list = {
        ...latestList,
        categories: data?.latest?.categories ?? [],
        category: selectedCategory,
        categoryLabel: (selectedFeed !== null ? data?.latest?.sources?.find((entry) => entry.id === selectedFeed)?.title : null)
          ?? data?.latest?.categories?.find((entry) => entry.key === selectedCategory)?.label ?? null,
        totalCount: data?.latest?.total ?? 0,
      };
      const latestMatches = data?.filterKey === JSON.stringify([serverQuery, serverCategory, serverUnread, highQualityOnly, selectedFeed, selectedTag, selectedFormat]);
      const retainedIds = new Set(reader !== null ? readerQueue.current?.map((article) => article.id) : []);
      const visibleArticles = latestMatches ? list.readerArticles.filter((article) =>
        !unreadOnly || !article.read || retainedIds.has(article.id)) : [];
      const readerArticles = readerQueue.current !== null
        ? [...readerQueue.current, ...list.articles.filter((article) => !retainedIds.has(article.id))]
        : list.readerArticles;
      const categoryFiltered = list.category !== null;
      const listLabel = [selectedTag, selectedFormat, list.categoryLabel].filter(Boolean).join(" · ") || tr("dashboard.all");
      const unreadCount = data?.latest?.unread ?? 0;
      React.useEffect(() => {
        if (reader !== null) return undefined;
        const onKey = (event) => {
          if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
          const active = document.activeElement;
          if (
            active &&
            (active.tagName === "INPUT" ||
              active.tagName === "TEXTAREA" ||
              active.isContentEditable === true)
          ) {
            return;
          }
          event.preventDefault();
          if (searchRef.current !== null) searchRef.current.focus();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [reader !== null]);

      const resetLatestPage = () => {
        listPosition.current = null;
        listScroll.current = 0;
        restoringList.current = false;
        if (bodyRef.current) bodyRef.current.scrollTop = 0;
        bulkContext.current = null;
        latestSnapshot.current = null;
        setLatestOffset(0);
      };
      const changeQuery = (value) => {
        if (reader !== null) closeReader();
        resetLatestPage();
        setQuery(value);
        if (bodyRef.current !== null) bodyRef.current.scrollTop = 0;
      };

      const selectCategory = (key) => {
        if (reader !== null) closeReader();
        resetLatestPage();
        setSelectedCategory(key);
        setSelectedFeed(null);
        if (key !== null) setExpandedCategories((current) => ({ ...current, [key]: true }));
        if (bodyRef.current !== null) bodyRef.current.scrollTop = 0;
        window.requestAnimationFrame(() => {
          if (bodyRef.current !== null) bodyRef.current.scrollTop = 0;
        });
      };

      const selectFeed = (source) => {
        if (reader !== null) closeReader();
        resetLatestPage();
        setSelectedCategory(source.category);
        setSelectedFeed(source.id);
        setExpandedCategories((current) => ({ ...current, [source.category]: true }));
      };

      const selectTag = (tag) => {
        if (tag === selectedTag && reader === null) return;
        if (reader !== null) closeReader();
        resetLatestPage();
        setSelectedTag(tag);
        if (tag === selectedTag) setReload((value) => value + 1);
      };

      const selectFormat = (format) => {
        if (format === selectedFormat && reader === null) return;
        if (reader !== null) closeReader();
        resetLatestPage();
        setSelectedFormat(format);
        if (format === selectedFormat) setReload((value) => value + 1);
      };

      const selectAllArticles = () => {
        if (reader !== null) closeReader();
        resetLatestPage();
        setSelectedTag(null);
        setSelectedFormat(null);
        setSelectedCategory(null);
        setSelectedFeed(null);
        setReload((value) => value + 1);
      };

      const handleReaderBack = () => {
        closeReader();
      };
      const refreshView = () => {
        listController.current?.abort();
        setPending(true);
        resetLatestPage();
        setReload((value) => value + 1);
      };
      refreshCurrent.current = refreshView;

      const bulkReady = !pending && failure === null && report !== null && latestMatches
        && data?.view === "latest" && Number.isSafeInteger(data?.pagination?.snapshot)
        && latestSnapshot.current === data.pagination.snapshot;
      // The server unread count includes matching rows beyond the loaded pages.
      const hasUnreadMatches = (data?.latest?.unread ?? 0) > 0;
      bulkContext.current = bulkReady && hasUnreadMatches ? {
        view: "latest", q: queryText, category: serverCategory, unread: unreadOnly,
        ...(selectedFeed !== null ? { feed: selectedFeed } : {}),
        ...(selectedTag !== null ? { tag: selectedTag } : {}),
        ...(selectedFormat !== null ? { format: selectedFormat } : {}),
        ...(highQualityOnly ? { quality: "high" } : {}),
        snapshot: data.pagination.snapshot,
      } : null;
      const markAllRead = async () => {
        const payload = bulkContext.current;
        if (!payload || readMutation.current !== null) return;
        readMutation.current = "bulk";
        const controller = new AbortController();
        bulkController.current = controller;
        setReadBusy("bulk");
        setActionError(null);
        setReadNotice(null);
        try {
          const response = await fetch(new URL(READ_ALL_ENDPOINT, document.baseURI).href, {
            method: "POST", signal: controller.signal, credentials: "same-origin",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
          const result = await response.json().catch(() => null);
          if (controller.signal.aborted) return;
          if (!response.ok || result?.ok !== true) {
            throw new Error(result?.message || result?.error || `${tr("read.allError")} (HTTP ${response.status})`);
          }
          if (!Number.isSafeInteger(result.changed) || result.changed < 0 || !Array.isArray(result.ids)
            || result.ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
            || new Set(result.ids).size !== result.changed || result.ids.length !== result.changed) {
            throw new Error(tr("read.allInvalid"));
          }
          const ids = new Set(result.ids);
          readRevision.current += 1;
          for (const id of ids) {
            manualReadIntent.current.set(id, (manualReadIntent.current.get(id) || 0) + 1);
            readOverrides.current.set(id, true);
            const cached = articleCache.current.get(id);
            if (cached) articleCache.current.set(id, { ...cached, read: true });
          }
          setData((current) => patchReadIds(current, ids));
          if (readerQueue.current !== null) readerQueue.current = readerQueue.current.map((article) =>
            ids.has(article.id) ? { ...article, read: true } : article);
          setReader((current) => current?.article && ids.has(current.article.id)
            ? { ...current, article: { ...current.article, read: true } } : current);
          setReadNotice(tr("read.allSuccess", { count: result.changed }));
          refreshCurrent.current();
        } catch (error) {
          if (!controller.signal.aborted) setActionError(error instanceof Error ? error.message : String(error));
        } finally {
          if (!controller.signal.aborted) {
            bulkController.current = null;
            readMutation.current = null;
            setReadBusy(null);
          }
        }
      };

      const disabled = running !== null || actionBusy !== null;

      const runAction = async (kind, path, body) => {
        setActionBusy(kind);
        setActionError(null);
        try {
          await postAction(path, body);
          refreshView();
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error));
        } finally {
          setActionBusy(null);
        }
      };

      const totalGroups = latestMatches ? (data?.pagination?.total ?? 0)
        + (reader !== null && unreadOnly ? visibleArticles.filter((article) => article.read).length : 0) : 0;
      const topics = data?.latest?.tagGroups?.topics ?? data?.latest?.tags ?? [];
      const formats = data?.latest?.tagGroups?.formats ?? [];
      const classificationFilters = [
        ["tags", topics, selectedTag, selectTag],
        ["formats", formats, selectedFormat, selectFormat],
      ].map(([kind, options, selected, select]) => h("div", { key: kind, className: "rsb-tagFilter" },
        h("select", {
          className: "rsb-select", "aria-label": tr(`${kind}.filter`), value: selected ?? "",
          onChange: (event) => select(event.target.value || null),
        },
          h("option", { value: "" }, tr(`${kind}.all`)),
          selected !== null && !options.some((option) => option.name === selected)
            ? h("option", { value: selected }, tr("tags.count", { tag: selected, count: kind === "tags"
                ? data?.latest?.tags?.find((entry) => entry.name === selected)?.count ?? 0 : 0 })) : null,
          options.map((option) => h("option", { key: option.name, value: option.name }, tr("tags.count", { tag: option.name, count: option.count }))),
        ),
        selected !== null ? h("button", {
          type: "button", className: "rsb-btn rsb-btn--ghost rsb-btn--icon rsb-btn--sm",
          title: tr(`${kind}.clear`), "aria-label": tr(`${kind}.clear`), onClick: () => select(null),
        }, h(Icon, { name: "x", size: 13 })) : null,
      ));
      const qualitySwitch = h("button", {
        type: "button", role: "switch", className: "rsb-switch", "aria-checked": highQualityOnly,
        "aria-label": tr("assessment.filter"), onClick: () => {
          if (reader !== null) closeReader();
          resetLatestPage();
          setHighQualityOnly((value) => !value);
          if (bodyRef.current !== null) bodyRef.current.scrollTop = 0;
        },
      },
        h("span", { className: "rsb-switchTrack", "aria-hidden": "true" }, h("span", { className: "rsb-switchThumb" })),
        h("span", { className: "rsb-switchLabel" }, tr("assessment.filter")),
      );
      const readSwitch = report !== null
        ? h(
            "button",
            {
              type: "button",
              role: "switch",
              "aria-checked": unreadOnly ? "true" : "false",
              "aria-label": tr("read.onlyUnread"),
              className: "rsb-switch",
              onClick: () => {
                if (reader !== null) closeReader();
                resetLatestPage();
                setUnreadOnly((value) => !value);
                if (bodyRef.current !== null) bodyRef.current.scrollTop = 0;
              },
            },
            h("span", { className: "rsb-switchTrack" }, h("span", { className: "rsb-switchThumb" })),
            h("span", { className: "rsb-switchLabel" }, tr("read.onlyUnread")),
            h("span", { className: "rsb-switchCount" }, String(unreadCount)),
          )
        : null;

      const progress = running && running.total > 0
        ? Math.min(100, Math.round((running.done / running.total) * 100))
        : 0;

      const runningStrip = running
        ? h(
            "div",
            { className: "rsb-running", role: "status" },
            h(
              "div",
              { className: "rsb-runningText" },
              h(
                "span",
                { className: "rsb-metaItem" },
                h(Icon, { name: "loader", size: 13, spin: true }),
                format(tr("state.running"), { phase: tr(`phase.${running.phase}`) }),
              ),
              h("span", null, running.total > 0 ? `${running.done}/${running.total}` : ""),
            ),
            h(
              "div",
              { className: "rsb-progress" },
              h("div", { className: "rsb-progressBar", style: { width: `${progress}%` } }),
            ),
          )
        : null;

      const banner = failure
        ? h(
            "div",
            { className: "rsb-banner", role: "alert" },
            h("span", { className: "rsb-bannerTitle" }, tr("state.error")),
            failure.message ?? "",
          )
        : null;

      const actionBanner = actionError
        ? h("div", { className: "rsb-banner", role: "alert" }, actionError)
        : null;

      let body;
      const awaitingLatest = !latestMatches;
      if (awaitingLatest && failure !== null) {
        body = h("div", { className: "rsb-empty" },
          h("button", { type: "button", className: "rsb-btn rsb-btn--outline", onClick: refreshView },
            h(Icon, { name: "refresh", size: 14 }), tr("state.retry")),
        );
      } else if ((pending && data === null) || awaitingLatest) {
        body = h(
          "div",
          { className: "rsb-loading", role: "status" },
          h(Icon, { name: "loader", size: 16, spin: true }),
          tr("latest.loading"),
        );
      } else if (report === null) {
        body = h(
          "div",
          { className: "rsb-empty" },
          h("span", { className: "rsb-emptyGlyph" }, h(Icon, { name: "rss", size: 40 })),
          h("p", { className: "rsb-emptyTitle" }, tr("latest.empty")),
          h("p", { className: "rsb-emptyHint" }, tr("latest.emptyHint")),
          h(
            "div",
            { className: "rsb-emptyActions" },
            h(
              "button",
              {
                type: "button",
                className: "rsb-btn rsb-btn--default",
                disabled,
                onClick: () => runAction("sync", SYNC_ENDPOINT, {}),
              },
              h(Icon, { name: "rss", size: 14 }),
              tr("action.sync"),
            ),
          ),
        );
      } else {
        const sections = visibleArticles.length > 0
          ? h("section", { className: "rsb-section", "aria-label": listLabel },
              h("div", { className: "rsb-sectionHead" },
                h("h3", { className: "rsb-sectionTitle" }, listLabel),
                h("span", { className: "rsb-sectionCount" }, String(visibleArticles.length)),
                h("span", { className: "rsb-sortLabel" }, h(Icon, { name: "clock", size: 12 }), tr("list.newest")),
              ),
              visibleArticles.map((article) => h(ArticleRow, {
                key: article.id ?? article.url ?? `${article.listCategory}:${article.title}`,
                selected: reader?.id === article.id,
                article, fallback, tr, onOpen: openArticle, onToggleRead: toggleRead, onSelectTag: selectTag, onSelectFormat: selectFormat, readBusy, compactMode,
              })),
            )
          : searching
            ? h(
                "div",
                { className: "rsb-empty", role: "status" },
                h("span", { className: "rsb-emptyGlyph" }, h(Icon, { name: "search", size: 32 })),
                h("p", { className: "rsb-emptyTitle" }, tr("search.empty")),
                h("p", { className: "rsb-emptyHint" }, tr("search.emptyHint")),
                h(
                  "div",
                  { className: "rsb-emptyActions" },
                  h(
                    "button",
                    {
                      type: "button",
                      className: "rsb-btn rsb-btn--outline",
                      onClick: () => changeQuery(""),
                    },
                    h(Icon, { name: "x", size: 14 }),
                    tr("search.clearAction"),
                  ),
                ),
              )
            : highQualityOnly
              ? h("div", { className: "rsb-empty", role: "status" },
                  h("p", { className: "rsb-emptyTitle" }, tr("assessment.empty")),
                  h("p", { className: "rsb-emptyHint" }, tr("assessment.emptyHint")),
                  h("button", { type: "button", className: "rsb-btn rsb-btn--outline", onClick: () => {
                    resetLatestPage(); setHighQualityOnly(false);
                  } }, tr("assessment.showAll")),
                )
            : unreadOnly
              ? h(
                  "div",
                  { className: "rsb-empty", role: "status" },
                  h("span", { className: "rsb-emptyGlyph" }, h(Icon, { name: "check", size: 32 })),
                  h("p", { className: "rsb-emptyTitle" }, tr("read.empty")),
                  h("p", { className: "rsb-emptyHint" }, tr("read.emptyHint")),
                  h(
                    "div",
                    { className: "rsb-emptyActions" },
                    h(
                      "button",
                      {
                        type: "button",
                        className: "rsb-btn rsb-btn--outline",
                        onClick: () => { resetLatestPage(); setUnreadOnly(false); },
                      },
                      tr("read.showAll"),
                    ),
                  ),
                )
              : h(
                  "div",
                  { className: "rsb-empty", role: "status" },
                  h("p", { className: "rsb-emptyTitle" }, tr(categoryFiltered ? "list.categoryEmpty" : "latest.empty")),
                  h("p", { className: "rsb-emptyHint" }, tr(categoryFiltered ? "list.categoryEmptyHint" : "latest.emptyHint")),
                  categoryFiltered ? h("button", {
                    type: "button", className: "rsb-btn rsb-btn--outline", onClick: selectAllArticles,
                  }, tr("dashboard.all")) : null,
                );

        body = h(
          React.Fragment,
          null,
          !searching
            ? warnings.map((warning, index) =>
                h("p", { key: `warning:${index}`, className: "rsb-warning" }, warning),
              )
            : null,
          sections,
          feedErrors.length > 0
            ? h(
                "details",
                { className: "rsb-feedErrors" },
                h(
                  "summary",
                  null,
                  h(Icon, { name: "alert", size: 13 }),
                  tr("section.feedErrors", { count: feedErrors.length }),
                ),
                h(
                  "ul",
                  null,
                  feedErrors.map((feedError, index) =>
                    h(
                      "li",
                      { key: `feed:${index}` },
                      h(
                        "span",
                        null,
                        safeUrl(feedError.url)
                          ? h(
                              "a",
                              { href: feedError.url, target: "_blank", rel: "noreferrer noopener" },
                              feedError.title || feedError.url,
                            )
                          : feedError.title || "",
                      ),
                      h("span", null, feedError.error ?? ""),
                    ),
                  ),
                ),
              )
            : null,
        );
      }

      const directoryTopics = data?.latest?.tagGroups?.topics ?? [];
      const directoryFormats = data?.latest?.tagGroups?.formats ?? [];
      const classifiedNames = new Set([...directoryTopics, ...directoryFormats].map((entry) => entry.name.toLowerCase()));
      const historicalTags = (data?.latest?.tags ?? []).filter((entry) => !classifiedNames.has(entry.name.toLowerCase()));
      if (selectedTag !== null && !directoryTopics.some((entry) => entry.name === selectedTag) && !historicalTags.some((entry) => entry.name === selectedTag)) {
        historicalTags.push({ name: selectedTag, count: 0 });
      }
      const navigationFormats = selectedFormat !== null && !directoryFormats.some((entry) => entry.name === selectedFormat)
        ? [...directoryFormats, { name: selectedFormat, count: 0 }] : directoryFormats;
      const navigationGroups = [
        ["topics", directoryTopics, selectedTag, selectTag],
        ["formats", navigationFormats, selectedFormat, selectFormat],
        ["legacy", historicalTags, selectedTag, selectTag],
      ].map(([kind, entries, selected, select]) => ({ kind, entries: entries.filter((entry) => entry.count > 0 || entry.name === selected), selected, select }));
      const allArticlesActive = selectedTag === null && selectedFormat === null && selectedCategory === null && selectedFeed === null;
      const categoryIcons = { ai: "sparkles", engineering: "file", systems: "layers", product: "layout", business: "calendar", science: "search", culture: "book", other: "rss" };
      const sidebar = h("aside", { className: "rsb-rail", "aria-label": tr("dashboard.navigate") },
        h("div", { className: "rsb-brand" },
          h("span", { className: "rsb-brandMark" }, h(Icon, { name: "rss", size: 18 })),
          h("div", null,
            h("span", { className: "rsb-brandName" }, tr("panel.title")),
            h("span", { className: "rsb-brandCaption" }, tr("dashboard.workspace")),
          ),
        ),
        h("button", {
          type: "button", className: "rsb-btn rsb-btn--default", disabled,
          onClick: () => runAction("sync", SYNC_ENDPOINT, {}),
        }, h(Icon, { name: actionBusy === "sync" ? "loader" : "rss", size: 15, spin: actionBusy === "sync" }), tr("action.sync")),
        h("div", { className: "rsb-railNavigation" },
          h("nav", { className: "rsb-railList", "aria-label": tr("dashboard.navigate") },
            h("button", {
              type: "button", className: "rsb-railItem", "data-active": String(allArticlesActive),
              "aria-pressed": allArticlesActive, onClick: selectAllArticles,
            },
              h(Icon, { name: "layers", size: 15 }),
              h("span", { className: "rsb-railLabel" }, tr("dashboard.all")),
              h("span", { className: "rsb-railCount" }, String(data?.latest?.navigation?.total ?? list.totalCount)),
            ),
            navigationGroups.map(({ kind, entries, selected, select }) => entries.length > 0 ? h("details", {
              key: kind, className: "rsb-tagNavGroup", open: true, "aria-label": tr(`navigation.${kind}`),
            },
              h("summary", { className: "rsb-railTitle" }, tr(`navigation.${kind}`)),
              entries.map((entry) => h("button", {
                key: entry.name, type: "button", className: "rsb-railItem rsb-tagNavItem", "data-dimension": kind, "data-name": entry.name,
                "data-active": String(entry.name === selected), "aria-pressed": entry.name === selected,
                title: tr("tags.count", { tag: entry.name, count: entry.count }), onClick: () => select(entry.name),
              },
                h("span", { className: "rsb-railLabel" }, entry.name),
                h("span", { className: "rsb-railCount" }, String(entry.count)),
              )),
            ) : null),
            navigationGroups.every((group) => group.entries.length === 0)
              ? h("p", { className: "rsb-railEmpty" }, tr("navigation.empty")) : null,
          ),
          h("details", { className: "rsb-sourcesNavigation" },
            h("summary", null, tr("sources.title")),
            h("nav", { className: "rsb-railList", "aria-label": tr("sources.title") },
              h("button", {
                type: "button", className: "rsb-railItem", "data-active": String(selectedCategory === null && selectedFeed === null),
                "aria-pressed": selectedCategory === null && selectedFeed === null, onClick: () => selectCategory(null),
              },
                h(Icon, { name: "rss", size: 15 }),
                h("span", { className: "rsb-railLabel" }, tr("sources.all")),
              ),
            list.categories.filter((entry) => entry.count > 0).map((entry) => {
              const sources = (data?.latest?.sources ?? []).filter((source) => source.category === entry.key && source.count > 0);
              const expanded = Boolean(expandedCategories[entry.key]);
              const sourceListId = `rsb-sources-${encodeURIComponent(entry.key)}`;
              return h("div", { key: entry.key, className: "rsb-categoryGroup" },
                h("div", { className: "rsb-categoryRow", "data-current": list.category === entry.key ? "true" : "false" },
                  h("button", {
                    type: "button", className: "rsb-categoryToggle", disabled: sources.length === 0,
                    "aria-expanded": expanded, "aria-controls": sourceListId,
                    "aria-label": tr(expanded ? "sources.collapse" : "sources.expand", { category: entry.label }),
                    onClick: () => setExpandedCategories((current) => ({ ...current, [entry.key]: !current[entry.key] })),
                  }, h(Icon, { name: "chevron-right", size: 13 })),
                  h("button", {
                    type: "button", className: "rsb-railItem",
                    "data-active": list.category === entry.key && selectedFeed === null ? "true" : "false",
                    "aria-pressed": list.category === entry.key && selectedFeed === null,
                    title: `${entry.label} (${entry.count})`, onClick: () => selectCategory(entry.key),
                  },
                    h(Icon, { name: categoryIcons[entry.key] ?? "file", size: 15 }),
                    h("span", { className: "rsb-railLabel" }, entry.label),
                    h("span", { className: "rsb-railCount" }, String(entry.count)),
                  ),
                ),
                expanded ? h("div", { id: sourceListId, className: "rsb-sourceList", role: "group", "aria-label": entry.label },
                  sources.map((source) => h("button", {
                    key: source.id, type: "button", className: "rsb-railItem rsb-sourceItem",
                    "data-active": selectedFeed === source.id ? "true" : "false",
                    "aria-pressed": selectedFeed === source.id,
                    title: `${source.title} (${source.count})`, onClick: () => selectFeed(source),
                  },
                    h(FeedIcon, { article: { feed: source.title, feedUrl: source.feedUrl } }),
                    h("span", { className: "rsb-railLabel" }, source.title),
                    h("span", { className: "rsb-railCount" }, String(source.count)),
                  )),
                ) : null,
              );
            }),
            ),
          ),
        ),
        h("div", { className: "rsb-railFooter" },
          data?.schedule?.nextSyncAt ? h("div", { className: "rsb-schedule" },
            h(Icon, { name: "clock", size: 14 }),
            h("span", { className: "rsb-scheduleText" }, tr("footer.nextSync"), h("strong", null, shortDateTime(data.schedule.nextSyncAt))),
          ) : null,
        ),
      );
      const searchControl = h("div", { className: "rsb-search" },
        h(Icon, { name: "search", size: 14, className: "rsb-searchIcon" }),
        h("input", {
          ref: searchRef, type: "search", className: "rsb-input", value: query,
          placeholder: tr("search.placeholder"), "aria-label": tr("search.placeholder"),
          onChange: (event) => changeQuery(event.target.value),
        }),
        query !== "" ? h("button", {
          type: "button", className: "rsb-searchClear", title: tr("search.clear"),
          "aria-label": tr("search.clear"), onClick: () => changeQuery(""),
        }, h(Icon, { name: "x", size: 13 })) : null,
      );
      const readingPane = h("section", { className: "rsb-readingPane", "aria-label": tr("reader.pane") },
        reader !== null ? h(ReaderView, {
          reader, articles: readerArticles, tr, onBack: handleReaderBack,
          onRetry: () => openArticle(reader.id, true), onNavigate: openArticle,
          onToggleRead: toggleRead, onSelectTag: selectTag, onSelectFormat: selectFormat, readBusy, positions: readingPositions,
        }) : h("div", { className: "rsb-readerPlaceholder" },
          h(Icon, { name: "book", size: 32 }),
          h("p", { className: "rsb-emptyTitle" }, tr("reader.choose")),
          h("p", { className: "rsb-emptyHint" }, tr("reader.chooseHint")),
        ),
      );
      const content = h("div", { className: "rsb-body", ref: attachListBody, onScroll: (event) => { listScroll.current = event.currentTarget.scrollTop; } },
        h("div", { className: "rsb-report" },
          banner, actionBanner,
          readNotice ? h("div", { className: "rsb-banner", role: "status" }, readNotice) : null,
          runningStrip,
          report ? h("div", { className: "rsb-listHeading" },
            h("h2", { className: "rsb-listTitle" }, listLabel),
            h("div", { className: "rsb-actions" },
              h("span", { className: "rsb-listCount", role: "status" }, tr("dashboard.results", { visible: visibleArticles.length, total: totalGroups })),
              h("button", {
                type: "button", className: "rsb-btn rsb-btn--outline rsb-btn--sm rsb-bulkRead",
                disabled: !bulkReady || !hasUnreadMatches || readBusy !== null,
                onClick: () => void markAllRead(),
              }, tr(readBusy === "bulk" ? "read.allPending" : "read.all")),
            ),
          ) : null,
          body,
          latestMatches && data?.pagination?.hasMore ? h("div", { className: "rsb-loadMore" },
            h("button", {
              type: "button", className: "rsb-btn rsb-btn--outline", disabled: pending,
              onClick: () => {
                if (pending || !data.pagination.hasMore) return;
                bulkContext.current = null;
                setPending(true);
                setLatestOffset(data.pagination.nextOffset);
                setReload((value) => value + 1);
              },
            }, pending ? h(Icon, { name: "loader", size: 14, spin: true }) : null, tr(pending ? "latest.loading" : "latest.more")),
          ) : null,
        ),
      );
      return h("div", { className: "rsb-root", "data-dsh-plugin": "@local/dsh-rss-brief", "data-compact": "true", "data-reading": String(reader !== null),
        style: { "--rsb-rail-width": `${columnWidths.navigation}px`, "--rsb-list-width": `${columnWidths.list}%` },
      },
        sidebar,
        h(ColumnDivider, { label: tr("layout.navigationWidth"), hint: tr("layout.resizeHint"), value: columnWidths.navigation,
          minimum: 132, maximum: 360, defaultValue: 208,
          onChange: (navigation) => setColumnWidths((current) => ({ ...current, navigation })),
        }),
        h("div", { className: "rsb-workspace" },
          h("section", { className: "rsb-listPane", "aria-label": tr("view.latest") },
          h("header", { className: "rsb-header" },
            h("div", { className: "rsb-titleRow" },
              h(Icon, { name: "layout", size: 17 }),
              h("h1", { className: "rsb-title" }, tr("view.latest")),
            ),
            h("div", { className: "rsb-actions" },
              h("button", {
                type: "button", className: "rsb-btn rsb-btn--ghost rsb-btn--icon",
                title: tr("action.refresh"), "aria-label": tr("action.refresh"),
                onClick: refreshView, disabled: pending,
              }, h(Icon, { name: "refresh", size: 15, spin: pending })),
              h("button", {
                type: "button", className: "rsb-btn rsb-btn--ghost rsb-btn--icon",
                title: tr("action.settings"), "aria-label": tr("action.settings"),
                onClick: () => setSettingsOpen(true),
              }, h(Icon, { name: "gear", size: 15 })),
            ),
          ),
          h("div", { className: "rsb-navRow" },
            searchControl,
            h("div", { className: "rsb-navFilters" }, qualitySwitch, readSwitch, classificationFilters),
          ),
          h("div", { className: "rsb-content" }, content),
          h("footer", { className: "rsb-footer" },
            h("span", null, tr("dashboard.results", { visible: visibleArticles.length, total: totalGroups })),
            data?.schedule?.lastFetchAt
              ? h("span", null, tr("latest.lastFetch", { time: shortDateTime(data.schedule.lastFetchAt) }))
              : null,
          ),
          ),
          h(ColumnDivider, { label: tr("layout.readerWidth"), hint: tr("layout.resizeHint"), value: columnWidths.list,
            minimum: 25, maximum: 70, defaultValue: 44, percent: true,
            onChange: (list) => setColumnWidths((current) => ({ ...current, list })),
          }),
          readingPane,
        ),
        settingsOpen ? h(ModelSettings, {
          tr, onClose: () => setSettingsOpen(false), onScheduleSaved: () => setReload((value) => value + 1),
          onManageSubscriptions: () => { setSettingsOpen(false); setSubscriptionsOpen(true); },
        }) : null,
        subscriptionsOpen ? h(SubscriptionSettings, {
          tr, onClose: () => setSubscriptionsOpen(false),
          onSaved: () => { selectCategory(null); refreshView(); },
        }) : null,
      );
    }

    return {
      inject: ["slots", "locale"],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(NS, { zh: ZH, en: EN }),
          "rss-brief: dictionaries",
        );
        ctx.effect(() => {
          const tag = document.createElement("style");
          tag.dataset.plugin = "@local/dsh-rss-brief";
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, "rss-brief: styles");

        const t = ctx.locale.bind(NS);
        ctx.slots.inject("sidebar.panellist", () =>
          ctx.slots.register(
            {
              name: "sidebar.panellist",
              id: PANEL_ID,
              order: 21,
              locale: NS,
              label: () => t("panel.title"),
            },
            SidebarIcon,
          ),
        );
        ctx.slots.inject("main", () =>
          ctx.slots.register({ name: "main", key: PANEL_ID, locale: NS }, RssBriefPage),
        );
      },
    };
  },
});
