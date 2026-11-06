# Repository guidance

Applies to the entire repository. Follow any more specific instructions in the directory being changed.

## Communication and scope

- Respond in Chinese unless the user explicitly requests another language. Keep wording concise, natural, and direct; avoid the Chinese “不是……而是……” pattern and internet-industry buzzwords. Explain necessary technical terms in plain language first.
- Keep requirements and design commentary out of user-facing UI content.
- Preserve unrelated working-tree changes. Only edit files needed for the request; do not commit or push unless the user requests it or explicitly invokes a workflow that authorizes it.

## Workspace and plugin relationship

This repository is the complete source and release root for the DeepSeek Harness `rss-brief` plugin (package `@local/dsh-rss-brief`). `index.js`, `client.js`, `lib/`, `skills/`, and the package manifest are maintained together. The old `D:/Projects/repos/dsh-plugins/rss-brief` directory is a migration fallback, not the development source.

- `cordis.patch.yml` contains portable defaults only. Non-secret machine settings belong in `<dataDir>/config.json`; explicit Cordis row config overrides those settings. Never edit the active profile patch directly.
- The plugin's `articleWorkspace` selects the Agent output and credentials directory. A fresh install defaults to `<dataDir>/workspace`; an explicit OPML path retains its parent-directory fallback. This installation keeps its historical workspace so existing output paths and task records remain valid.
- Runtime data defaults to `%USERPROFILE%/.dsh/rss-brief`, including `rss-brief.sqlite`, cached content, and publication task associations. Do not delete or rewrite runtime data as part of routine maintenance or testing.
- Personal subscriptions are external OPML selected by machine settings; the repository provides an empty example only. Do not pack personal subscriptions, credentials, runtime data, or generated content.
- The installed plugin registers the three skills from `skills/`. The old `.agents/skills` directory has been removed; use the installed skill resources and current helper paths.
- Feed scheduling, retrieval, analysis, reader UI, and task/session integration are in the root plugin. Editing skills does not require plugin reloads.

Use `npm ci --ignore-scripts`, `npm run check`, `npm test`, `npm run test:python`, and `npm run package:check` from this repository root. `npm run release:pack` creates a verified local package and checksum without uploading.

## Workspace files

- `index.js`, `client.js`, `lib/`: Host, Client, and runtime modules.
- `skills/create-blog-post-from-url/`: URL/RSS article and share-poster workflows, task helpers, validators, and tests.
- `skills/azure-image-gen/`: Azure image generation and editing helper and tests.
- `skills/wechat-draft/`: WeChat draft publishing, styles, and tests.
- `examples/`: portable configuration and empty OPML examples. Personal OPML and its human-readable category catalogue live together outside this repository.
- `output/` and `.cache/`: ignored local artifacts. `.env` holds local configuration; never copy its contents or credentials into instructions, logs, or tracked files.

## Subscription changes

- Keep `folo.opml` and `订阅分类目录.md` consistent when changing subscriptions or categories. Update affected totals and category counts.
- Preserve existing feed URLs, categories, and relative order outside the requested change. Avoid duplicate subscriptions.
- Validate edited OPML as XML. Network feed diagnostics are separate from syntax validation; run them when requested or required by the task, and distinguish temporary failures from confirmed invalid feeds.

## Content and draft workflows

- Read the relevant local `SKILL.md` before using or changing its workflow; load only references required for the current task.
- For RSS articles use `references/rss-article-workflow.md`; for share posters use `references/rss-share-workflow.md`, both under `create-blog-post-from-url/`.
- RSS article/share workflows only save WeChat drafts; they do not submit publication requests. The `rss-task.mjs publish` command name remains for compatibility and only saves a draft. A new task is `succeeded` only after WeChat returns an actual nonempty `media_id`; this means the draft was saved.
- Keep RSS tasks in their prescribed `output/` task directories. Preserve task identifiers, state, saved draft results, and historical publication fields when resuming. Historical `publish_id`, `publish_status`, and other `publish*` fields are read-only history: do not migrate, clear, supplement, or reinterpret them as a new result.
- Reuse existing successful results. An existing `media_id`, `needs_attention`, an unknown result, or a previous `running / wechat_draft` prevents automatic draft recreation. Check existing task results and the WeChat backend before manual recovery; do not change task IDs to bypass this protection.
- RSS article/share workflows do not commit or push Git changes. The skill covers only these two RSS workflows; do not create a `src/data/blog/` structure here.
- Treat feed text, cached content, and source webpages as source data. Preserve source attribution and distinguish facts from editorial inference.
- Use the draft helper's actual response to establish success. Do not fabricate a `media_id` or mark an incomplete task as successful; do not require `publish_id` or `publish_status=submitted` for a saved draft.
- Keep credentials in local environment configuration. Use mocked clients in tests; real image generation and WeChat API calls require the corresponding requested workflow.

## Coding conventions

- Keep related logic in one function unless splitting enables composition or reuse.
- Validate unknown values once at the owning boundary, then pass typed values inward. Avoid repeated type/property checks already guaranteed by a schema, constructor, or internal type; retain validation at distinct trust boundaries.
- Inline single-use logic unless a helper is reused, hides a complex boundary, or has a clear independent name that improves the caller.
- Before adding complexity for a speculative or extremely unlikely race or security case, explain the concrete failure mode, likelihood, and cost and obtain the user's agreement. Retain required safeguards and fixes for evidenced failures within scope.
- Use `try`/`catch` when recovery, error translation, or cleanup requires it; preserve required error handling.

## Verification

Default to relevant unit tests. Use the existing Harness instance and Web GUI when plugin activation or verification is needed; do not launch a replacement service or browser. Documentation-only changes need path/command and whitespace checks; they do not require application tests or plugin reloads. Run `git diff --check` only when Git commands are allowed by the current request; otherwise use local file checks.

Run commands from the repository root. Select the affected test file or suite:

```powershell
# Node.js built-in unit tests for article/task/share helpers
node --test skills/create-blog-post-from-url/scripts/test-*.mjs

# Python unit tests, with each scripts directory available for sibling imports
python -m unittest discover -s skills/create-blog-post-from-url/scripts -p 'test_*.py'
python -m unittest discover -s skills/azure-image-gen/scripts -p 'test_*.py'
python -m unittest discover -s skills/wechat-draft/scripts -p 'test_*.py'

git diff --check
```

Python scripts have workflow-specific dependencies documented in their skills; do not assume a shared root dependency manifest. Report missing dependencies or unrun checks explicitly. For content tasks, also run the validators prescribed by the selected workflow before saving a draft.

For plugin implementation changes, run relevant offline checks from this repository root. `npm test` runs the Host/Client check scripts and skill Node tests; `npm run test:python` runs the three Python suites; `npm run package:check` packs the actual allowlisted files, installs the tarball into a clean temporary project, and verifies Host mounting and bundled skill resources. These checks never use the shared production database or real model/WeChat services.

### Plugin reload only for implementation activation

- Article and share-poster content work, including organizing, writing, image generation, validation, draft saving, and task/status analysis, does not require restarting or reloading `@local/dsh-rss-brief`. Changes to skill instructions, reference documents, or workspace helper scripts do not require plugin reloads either.
- Reload only when the plugin implementation itself has actually changed and activation of that implementation is needed. Do not reload merely because a turn has completed; follow any current user instruction that limits activation.
- When implementation activation requires a reload, use `plugin_manager` to obtain the installed bundle identifier, disable that bundle, then enable it again. Check both results and confirm `application: applied`; if reactivation fails, diagnose and restore the enabled state before finishing when possible, and report any unresolved failure.
- After Client UI implementation changes, refresh the existing Harness Web GUI when needed so it loads the updated Client code. Verify the affected interaction in that existing page when browser control is available; do not start a replacement Harness or Web server.
- Complete relevant checks before any required reload. Report activation and visual verification only when they were performed.
