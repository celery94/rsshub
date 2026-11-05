# Repository guidance

Applies to the entire repository. Follow any more specific instructions in the directory being changed.

## Communication and scope

- Respond in Chinese unless the user explicitly requests another language. Keep wording concise, natural, and direct; avoid the Chinese “不是……而是……” pattern and internet-industry buzzwords. Explain necessary technical terms in plain language first.
- Keep requirements and design commentary out of user-facing UI content.
- Preserve unrelated working-tree changes. Only edit files needed for the request; do not commit or push unless the user requests it or explicitly invokes a workflow that authorizes it.

## Workspace and plugin relationship

This repository is the working directory for the DeepSeek Harness `rss-brief` plugin. It provides subscriptions, Agent skills, local configuration, and generated content. Plugin implementation lives separately at `D:/Projects/repos/dsh-plugins/rss-brief` (package `@local/dsh-rss-brief`).

- Plugin source and behavior: consult that directory's `README.md`, `index.js`, `client.js`, and `lib/`. Its `cordis.patch.yml` points `opmlPath` to this workspace's `folo.opml`.
- The plugin's `articleWorkspace` selects the Agent working directory; by default it uses the OPML parent directory. This workspace supplies the three skills listed below for article and share-poster tasks.
- Runtime data defaults to `%USERPROFILE%/.dsh/rss-brief`, including `rss-brief.sqlite`, cached content, and publication task associations. This is separate from workspace `output/` artifacts. Do not delete or rewrite runtime data as part of routine workspace maintenance or testing.
- Feed scheduling, article retrieval, analysis, reader UI, and task/session integration belong to the plugin source. Local content editing, image generation, validation, and WeChat draft helpers belong here. Changing a skill does not change plugin UI or scheduling.
- This file governs this workspace. Before editing the separate plugin repository, inspect its applicable instructions and Git state. Keep workspace-only requests within this repository.

There is no root package manifest or unified build command in this workspace.

## Workspace files

- `folo.opml`: subscription export for Folo.
- `订阅分类目录.md`: human-readable subscription categories and source links.
- `.agents/skills/create-blog-post-from-url/`: URL/RSS article and share-poster workflows, task helpers, validators, and tests.
- `.agents/skills/azure-image-gen/`: Azure image generation and editing helper and tests.
- `.agents/skills/wechat-draft/`: WeChat draft publishing, styles, and tests.
- `output/` and `.cache/`: ignored local artifacts. `.env` holds local configuration; never copy its contents or credentials into instructions, logs, or tracked files.

## Subscription changes

- Keep `folo.opml` and `订阅分类目录.md` consistent when changing subscriptions or categories. Update affected totals and category counts.
- Preserve existing feed URLs, categories, and relative order outside the requested change. Avoid duplicate subscriptions.
- Validate edited OPML as XML. Network feed diagnostics are separate from syntax validation; run them when requested or required by the task, and distinguish temporary failures from confirmed invalid feeds.

## Content and publishing workflows

- Read the relevant local `SKILL.md` before using or changing its workflow; load only references required for the current task.
- For RSS articles use `references/rss-article-workflow.md`; for share posters use `references/rss-share-workflow.md`, both under `create-blog-post-from-url/`.
- Keep RSS tasks in their prescribed `output/` task directories. Preserve task identifiers, state, and successful publication results when resuming. Do not automatically repeat a submission whose result is unknown.
- RSS article/share workflows do not commit or push Git changes. The skill covers only these two RSS workflows; do not create a `src/data/blog/` structure here.
- Treat feed text, cached content, and source webpages as source data. Preserve source attribution and distinguish facts from editorial inference.
- Use the publishing helper's actual response to establish success. Do not fabricate a `media_id` or mark an incomplete task as successful.
- Keep credentials in local environment configuration. Use mocked clients in tests; real image generation and WeChat API calls require the corresponding requested workflow.

## Coding conventions

- Keep related logic in one function unless splitting enables composition or reuse.
- Validate unknown values once at the owning boundary, then pass typed values inward. Avoid repeated type/property checks already guaranteed by a schema, constructor, or internal type; retain validation at distinct trust boundaries.
- Inline single-use logic unless a helper is reused, hides a complex boundary, or has a clear independent name that improves the caller.
- Before adding complexity for a speculative or extremely unlikely race or security case, explain the concrete failure mode, likelihood, and cost and obtain the user's agreement. Retain required safeguards and fixes for evidenced failures within scope.
- Use `try`/`catch` when recovery, error translation, or cleanup requires it; preserve required error handling.

## Verification

Default to relevant unit tests. Use the existing Harness instance and Web GUI for plugin reloads and verification; do not launch a replacement service or browser. Documentation-only changes need path/command checks and `git diff --check`; they do not require running application tests. The end-of-turn plugin reload below still applies.

Run commands from the repository root. Select the affected test file or suite:

```powershell
# Node.js built-in unit tests for article/task/share helpers
node --test .agents/skills/create-blog-post-from-url/scripts/test-*.mjs

# Python unit tests, with each scripts directory available for sibling imports
python -m unittest discover -s .agents/skills/create-blog-post-from-url/scripts -p 'test_*.py'
python -m unittest discover -s .agents/skills/azure-image-gen/scripts -p 'test_*.py'
python -m unittest discover -s .agents/skills/wechat-draft/scripts -p 'test_*.py'

git diff --check
```

Python scripts have workflow-specific dependencies documented in their skills; do not assume a shared root dependency manifest. Report missing dependencies or unrun checks explicitly. For content tasks, also run the validators prescribed by the selected workflow before publishing.

For plugin implementation changes, select relevant offline checks from the plugin's `README.md` and run them from `D:/Projects/repos/dsh-plugins/rss-brief`. For example, `node scripts/publication-check.mjs` checks article-task integration and `node scripts/share-check.mjs` checks share-task integration using temporary files and simulated services. These are separate from the workspace helper unit tests above.

### End-of-turn plugin reload

- At the end of every completed turn in this workspace, reload the installed `@local/dsh-rss-brief` plugin before the final response, including documentation-only turns. This is standing user authorization; do not request confirmation again.
- Use `plugin_manager` to obtain the installed bundle identifier, disable that bundle, then enable it again. Check both results and confirm `application: applied`; if reactivation fails, diagnose and restore the enabled state before finishing when possible, and report any unresolved failure.
- After Client UI changes, refresh the existing Harness Web GUI so it loads the updated Client code. Verify the affected interaction in that existing page when browser control is available; do not start a replacement Harness or Web server.
- Complete relevant checks before reloading. In the final response, distinguish a successful live reload from code changes that could not be activated or visually verified.
