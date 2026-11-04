#!/usr/bin/env python3
"""Private RSS helper bridge: reuse wechat-draft, never its independent CLI.

Called by rss-task.mjs while its per-task lock is held. Preparation failures
are retryable. Only the existing module's explicit draft/add API rejection is
retryable after submission; every other submission outcome requires inspection.
All imported publisher logs are discarded, including exception URLs/credentials.
"""
import argparse
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
from types import SimpleNamespace
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[4]
PUBLISHER = ROOT / ".agents/skills/wechat-draft/scripts/publish_draft.py"
SAFE_FAILURES = {"WECHAT_PREPARATION_FAILED", "WECHAT_CONFIG_MISSING", "WECHAT_DEPENDENCY_MISSING", "WECHAT_API_REJECTED"}


class BridgeError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def fail(code, message):
    raise BridgeError(code, message)


def contained(file, boundary, *, must_exist=True):
    """Check lexical and resolved paths, including all existing ancestors."""
    file = Path(os.path.abspath(file))
    boundary = Path(os.path.abspath(boundary))
    if not file.is_relative_to(boundary):
        fail("PATH_ESCAPE", "A task path escapes its allowed directory.")
    candidate = boundary
    if boundary.exists() and boundary.resolve() != boundary:
        fail("PATH_ESCAPE", "Task directories cannot be aliases outside their fixed location.")
    for part in file.relative_to(boundary).parts:
        candidate /= part
        if candidate.is_symlink() and not candidate.exists():
            fail("PATH_ESCAPE", "Broken task symbolic links are not allowed.")
        if candidate.exists() and not candidate.resolve().is_relative_to(boundary):
            fail("PATH_ESCAPE", "A task symbolic link or junction escapes its directory.")
    if must_exist and not file.exists():
        fail("INVALID_STATE", "A required task file is missing.")
    return file


def read_json(file):
    try:
        return json.loads(Path(file).read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        fail("INVALID_STATE", "A required task JSON file is invalid.")


def atomic_result(file, result, task_dir):
    contained(file, task_dir)
    temporary = contained(task_dir / (".result." + uuid4().hex + ".tmp"), task_dir, must_exist=False)
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as handle:
            json.dump(result, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        contained(file, task_dir)
        os.replace(temporary, file)
    finally:
        if temporary.exists():
            temporary.unlink()


def usable_configuration(value):
    if not isinstance(value, str) or not value.strip():
        return False
    return not re.search(r"[<>]|^(?:\$\{|%[A-Za-z_]+%$)|^(?:your(?:[_ -]|$)|replace(?:[_ -]|$)|change[-_ ]?me|placeholder|todo|dummy|example(?:[_ -]|$)|xxx+$|none$|null$)", value.strip(), re.I)


def load_publisher():
    # publish_draft imports its sibling style_manager and performs its original
    # dotenv loading on import. No credential is passed on a command line.
    sys.path.insert(0, str(PUBLISHER.parent))
    spec = importlib.util.spec_from_file_location("rss_wechat_publisher", PUBLISHER)
    if spec is None or spec.loader is None:
        fail("WECHAT_PREPARATION_FAILED", "The WeChat publisher could not be loaded.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_bridge(task_dir, lock_token, title, digest, source, *, workspace=ROOT, module_loader=load_publisher):
    """Module injection is for offline unittest only, never a CLI option."""
    workspace = Path(workspace).resolve()
    task_dir = contained(task_dir, workspace)
    task_id = task_dir.name
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", task_id) or re.fullmatch(r"CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]", task_id, re.I):
        fail("INVALID_STATE", "Invalid task identifier.")
    if task_dir != workspace / "output/rss-articles" / task_id:
        fail("PATH_ESCAPE", "The bridge only accepts fixed RSS task directories.")
    lock = read_json(contained(task_dir / ".lock", task_dir))
    if not lock_token or lock.get("token") != lock_token:
        fail("TASK_LOCK_REQUIRED", "The RSS helper must hold this task's lock.")
    input_data = read_json(contained(task_dir / "input.json", task_dir))
    result_path = contained(task_dir / "result.json", task_dir)
    result = read_json(result_path)
    article = contained(task_dir / "article.md", task_dir)
    expected_article = article.relative_to(workspace).as_posix()
    for data in (input_data, result):
        if data.get("version") != 1 or data.get("mode") != "rss-article" or data.get("task_id") != task_id or data.get("source_url") != source:
            fail("INVALID_STATE", "Bridge arguments do not match stored task input.")
    if result.get("status") == "succeeded" and isinstance(result.get("media_id"), str) and result["media_id"].strip():
        return result
    if result.get("status") == "needs_attention":
        return result
    if result.get("stage") != "wechat_draft" or result.get("status") != "running" or result.get("article_path") != expected_article or result.get("title") != title:
        fail("INVALID_STATE", "The RSS helper must validate the article before calling the bridge.")
    cover_value = result.get("cover_path")
    if not isinstance(cover_value, str):
        fail("INVALID_STATE", "Missing cover path.")
    cover = contained(workspace / cover_value, task_dir / "assets")
    if not re.fullmatch(r"01-cover\.(?:png|jpg)", cover.name, re.I):
        fail("INVALID_STATE", "The cover must be a fixed task PNG or JPG.")

    def finish(status, code=None, message=None, media_id=None):
        result.update(status=status, stage="wechat_draft", media_id=media_id,
                      error={"code": code, "message": message} if code else None,
                      updated_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))
        atomic_result(result_path, result, task_dir)
        return result

    # Suppress import-time output and every original publisher print. Raw
    # exceptions are deliberately never stored, printed or interpolated.
    with open(os.devnull, "w", encoding="utf-8") as sink, redirect_stdout(sink), redirect_stderr(sink):
        try:
            publisher = module_loader()
            publisher.load_env_from_dotenv()
            app_id = os.environ.get("WECHAT_APP_ID")
            app_secret = os.environ.get("WECHAT_APP_SECRET")
            if not usable_configuration(app_id) or not usable_configuration(app_secret):
                return finish("failed", "WECHAT_CONFIG_MISSING", "WeChat configuration is missing, empty or a placeholder.")
            args = SimpleNamespace(
                appid=app_id, secret=app_secret, title=title, digest=digest,
                content=None, content_file=str(article), content_format="markdown",
                style_preset="auto", author="Aide Hub", article_type="news",
                cover_image=str(cover), thumb_media_id=None, content_source_url=source,
                ignore_image_errors=False, extra_css_file=None, image=[], image_dir=None,
                delete_draft=None,
            )
            # Use the original argument constraints as well as the JS validator.
            publisher.validate_args(argparse.ArgumentParser(add_help=False), args)
            token = publisher.get_access_token(app_id, app_secret)
            if not isinstance(token, str) or not token.strip():
                return finish("failed", "WECHAT_PREPARATION_FAILED", "WeChat token or image preparation failed before draft submission.")
            prepared = publisher.build_news_article(args, token)
            if not isinstance(prepared, dict) or not prepared.get("thumb_media_id"):
                return finish("failed", "WECHAT_PREPARATION_FAILED", "WeChat token or image preparation failed before draft submission.")
        except (ImportError, ModuleNotFoundError):
            return finish("failed", "WECHAT_DEPENDENCY_MISSING", "A dependency of the existing WeChat publisher is unavailable; no draft was submitted.")
        except BaseException:
            return finish("failed", "WECHAT_PREPARATION_FAILED", "WeChat token or image preparation failed before draft submission.")

        try:
            media_id = publisher.add_draft(token, prepared)
        except RuntimeError as error:
            # The existing function raises this only after decoding a nonzero
            # draft/add errcode. HTTP errors, invalid JSON and missing media_id
            # have no definite rejection and must remain unknown.
            match = re.match(r"^新增草稿失败: errcode=(-?\d+),", str(error))
            if match and int(match.group(1)) != 0:
                return finish("failed", "WECHAT_API_REJECTED", "WeChat explicitly rejected draft/add; no successful draft was confirmed.")
            return finish("needs_attention", "WECHAT_SUBMISSION_UNKNOWN", "Draft submission may have reached WeChat. Inspect the draft box manually before any further action.")
        except BaseException:
            return finish("needs_attention", "WECHAT_SUBMISSION_UNKNOWN", "Draft submission may have reached WeChat. Inspect the draft box manually before any further action.")
        if not isinstance(media_id, str) or not media_id.strip():
            return finish("needs_attention", "WECHAT_SUBMISSION_UNKNOWN", "WeChat did not return a nonempty media_id. Inspect the draft box manually before any further action.")
        return finish("succeeded", media_id=media_id.strip())


def main():
    parser = argparse.ArgumentParser(description="Private RSS draft bridge", add_help=False)
    for name in ("task-dir", "lock-token", "title", "digest", "source"):
        parser.add_argument("--" + name, required=True)
    # Keep invalid arguments JSON-only too; argparse otherwise writes plain text.
    with open(os.devnull, "w", encoding="utf-8") as sink, redirect_stderr(sink):
        try:
            args = parser.parse_args()
        except SystemExit:
            print(json.dumps({"error": {"code": "INVALID_ARGUMENTS", "message": "The RSS helper must supply all bridge arguments."}}))
            return 1
    try:
        if Path.cwd().resolve() != ROOT.resolve():
            fail("WORKSPACE_REQUIRED", "Run the RSS bridge from the project root.")
        result = run_bridge(args.task_dir, args.lock_token, args.title, args.digest, args.source)
    except BridgeError as error:
        print(json.dumps({"error": {"code": error.code, "message": str(error)}}))
        return 1
    except BaseException:
        print(json.dumps({"error": {"code": "BRIDGE_OPERATION_FAILED", "message": "The bridge could not complete. Treat any interrupted submission as unknown."}}))
        return 1
    print(json.dumps(result, ensure_ascii=True))
    # A structured failed/unknown result is a successfully completed bridge run;
    # the JS helper reads the result and selects its own exit code.
    return 0


if __name__ == "__main__":
    sys.exit(main())
