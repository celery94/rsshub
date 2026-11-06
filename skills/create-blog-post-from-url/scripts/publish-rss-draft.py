#!/usr/bin/env python3
"""Private RSS helper bridge: reuse wechat-draft, never its independent CLI.

Called by rss-task.mjs while its per-task lock is held. Preparation failures
and explicit draft/add API rejection are retryable before a draft is saved.
A nonempty media_id confirms the draft was saved; no publication API is called.
Reentry with a saved draft or an unknown outcome never creates another draft.
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
from urllib.parse import urlsplit

PUBLISHER = Path(__file__).resolve().parents[2] / "wechat-draft/scripts/publish_draft.py"
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
    # Publisher resources are siblings in the installed skills tree. Workspace
    # credentials are loaded explicitly after import, never from package cwd.
    sys.path.insert(0, str(PUBLISHER.parent))
    spec = importlib.util.spec_from_file_location("rss_wechat_publisher", PUBLISHER)
    if spec is None or spec.loader is None:
        fail("WECHAT_PREPARATION_FAILED", "The WeChat publisher could not be loaded.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def decode_share_image(file, *, min_side=1080, max_side=4096):
    """Decode one final share image before any API call."""
    from PIL import Image
    if not file.is_file():
        fail("INVALID_SHARE", "A share image is missing.")
    expected_format = "PNG" if file.suffix.lower() == ".png" else "JPEG"
    with Image.open(file) as image:
        if image.format != expected_format or image.width < min_side or image.height < min_side or image.width > max_side or image.height > max_side or getattr(image, "n_frames", 1) != 1:
            fail("INVALID_SHARE", "Share images must be single-frame PNG/JPG of at least 1080 pixels per side.")
        image.verify()
    with Image.open(file) as image:
        image.load()


def decode_source_image(file):
    """Decode a scene or material input image; it never reaches WeChat directly."""
    from PIL import Image
    if not file.is_file():
        fail("INVALID_SHARE", "A scene or material image is missing.")
    with Image.open(file) as image:
        if getattr(image, "n_frames", 1) != 1:
            fail("INVALID_SHARE", "Scene and material images must be single-frame images.")
        image.verify()


def validate_images_share(task_dir, result, title, source, workspace, manifest, input_data):
    """Validate a multi-image share task and return its final image paths."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from share_images import validate_images_manifest
    try:
        normalized = validate_images_manifest(manifest, source=source, cached_content=input_data.get("cached_content"))
    except ValueError:
        fail("INVALID_SHARE", "Share manifest failed its multi-image contract.")
    images = []
    for image in normalized["images"]:
        asset = contained(task_dir / image["file"], task_dir / "assets")
        decode_share_image(asset)
        images.append(asset)
        for block in image["blocks"]:
            if block["type"] in ("scene", "material"):
                decode_source_image(contained(task_dir / block["path"], task_dir))
    assets = task_dir / "assets"
    if {item.name for item in assets.iterdir()} != {image.name for image in images}:
        fail("INVALID_SHARE", "Assets must contain exactly the final share images.")
    if normalized["title"] != title or normalized["source"] != source:
        fail("INVALID_SHARE", "Share title or source does not match its validated input.")
    relative = [image.relative_to(workspace).as_posix() for image in images]
    caption_path = (task_dir / "caption.txt").relative_to(workspace).as_posix()
    if result.get("article_type") != "newspic" or result.get("image_count") != len(images):
        fail("INVALID_SHARE", "Share result image count does not match its manifest.")
    if result.get("poster_path") != relative[0] or result.get("cover_path") != relative[0] or result.get("image_paths") != relative or result.get("caption_path") != caption_path or result.get("inline_image_paths") != []:
        fail("INVALID_SHARE", "Share result paths do not match the validated images.")
    return images


def validate_legacy_share(task_dir, result, title, source, workspace, manifest, input_data):
    """Validate the original single-poster manifest kept for resuming old tasks."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from share_editorial import validate_editorial
    fields = {"title", "caption", "source", "headline", "subtitle", "poster"}
    if set(manifest) - (fields | {"key_points", "editorial"}) or not fields.issubset(manifest) or any(not isinstance(manifest[key], str) or not manifest[key].strip() for key in fields):
        fail("INVALID_SHARE", "Incomplete share manifest.")
    if "poster_layout" in input_data and input_data["poster_layout"] not in ("content", "editorial"):
        fail("INVALID_SHARE", "poster_layout must be content or editorial when provided.")
    validate_editorial(manifest.get("editorial"), required=input_data.get("poster_layout") == "editorial", present="editorial" in manifest)
    points = manifest.get("key_points")
    if "key_points" in manifest or input_data.get("poster_layout") == "content":
        if not isinstance(points, list) or not 2 <= len(points) <= 3:
            fail("INVALID_SHARE", "Content posters require two or three key_points.")
        for point in points:
            if not isinstance(point, str) or point != point.strip() or not 12 <= len(point) <= 50 or not re.search(r"[\u3400-\u9fff\U00020000-\U000323af]", point) or re.search(r"[\x00-\x1f\x7f<>`]|\*\*|!\[|\]\(", point):
                fail("INVALID_SHARE", "key_points must be Chinese plain text of 12–50 codepoints.")
    for key, maximum in (("title", 32), ("headline", 24), ("subtitle", 40)):
        if len(manifest[key]) > maximum or re.search(r"[\r\n<>]", manifest[key]):
            fail("INVALID_SHARE", "Share text exceeds its plain-text constraints.")
    caption = contained(task_dir / "caption.txt", task_dir).read_text(encoding="utf-8-sig").strip()
    suffix = "来源：" + source
    body = caption[:-len(suffix)].strip() if caption.endswith("\n" + suffix) else ""
    if manifest["title"] != title or manifest["source"] != source or manifest["caption"].strip() != caption or not 100 <= len(re.sub(r"\s", "", body)) <= 200 or not re.search(r"[\u3400-\u9fff]", body) or re.search(r"<[^>]*>|!\[[^\]]*\]\(", caption):
        fail("INVALID_SHARE", "Share caption or source does not match its validated input.")
    if manifest["poster"] not in ("./assets/01-poster.png", "./assets/01-poster.jpg"):
        fail("INVALID_SHARE", "Invalid poster path.")
    poster = contained(task_dir / manifest["poster"], task_dir / "assets")
    expected = poster.relative_to(workspace).as_posix()
    if result.get("poster_path") != expected or result.get("cover_path") != expected or result.get("caption_path") != (task_dir / "caption.txt").relative_to(workspace).as_posix() or result.get("inline_image_paths") != [] or result.get("article_type") != "newspic" or result.get("image_count") != 1:
        fail("INVALID_SHARE", "Share result paths do not match fixed artifacts.")
    if list((task_dir / "assets").iterdir()) != [poster]:
        fail("INVALID_SHARE", "Exactly one final poster is required.")
    from PIL import Image
    with Image.open(poster) as image:
        expected_format = "PNG" if poster.suffix == ".png" else "JPEG"
        if image.format != expected_format or image.width < 1080 or image.height < 1440 or image.width * 4 != image.height * 3 or getattr(image, "n_frames", 1) != 1:
            fail("INVALID_SHARE", "Poster must be a single-frame 3:4 PNG/JPG of at least 1080×1440.")
        image.verify()
    with Image.open(poster) as image:
        image.load()
    return [poster]


def ensure_no_share_links(task_dir, workspace):
    """Reject symlinks or junctions before a malformed task can look like a submission."""
    ancestors = []
    current = task_dir
    while current != workspace:
        ancestors.append(current)
        current = current.parent
    for item in (*ancestors, *task_dir.rglob("*")):
        if item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()):
            fail("INVALID_SHARE", "Share symbolic links and junctions are forbidden.")


def validate_share(task_dir, result, title, source, workspace):
    """Validate share paths and decode every pixel before any API call."""
    parsed_source = urlsplit(source)
    if parsed_source.scheme not in ("http", "https") or not parsed_source.hostname or parsed_source.username or parsed_source.password:
        fail("INVALID_SHARE", "Invalid source URL.")
    ancestors = []
    current = task_dir
    while current != workspace:
        ancestors.append(current)
        current = current.parent
    for item in (*ancestors, *task_dir.rglob("*")):
        if item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()):
            fail("INVALID_SHARE", "Share symbolic links and junctions are forbidden.")
    manifest = read_json(contained(task_dir / "share.json", task_dir))
    input_data = read_json(contained(task_dir / "input.json", task_dir))
    if not isinstance(manifest, dict):
        fail("INVALID_SHARE", "Incomplete share manifest.")
    if "images" in manifest:
        return validate_images_share(task_dir, result, title, source, workspace, manifest, input_data)
    return validate_legacy_share(task_dir, result, title, source, workspace, manifest, input_data)


def run_bridge(task_dir, lock_token, title, digest, source, *, workspace=None, module_loader=load_publisher):
    """Use the supplied workspace for task data and configuration."""
    workspace = Path(workspace).resolve() if workspace is not None else Path.cwd().resolve()
    task_dir = contained(task_dir, workspace)
    task_id = task_dir.name
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", task_id) or re.fullmatch(r"CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]", task_id, re.I):
        fail("INVALID_STATE", "Invalid task identifier.")
    mode = "rss-share" if task_dir.parent.name == "rss-shares" else "rss-article"
    if task_dir != workspace / "output" / ("rss-shares" if mode == "rss-share" else "rss-articles") / task_id:
        fail("PATH_ESCAPE", "The bridge only accepts fixed RSS task directories.")
    lock = read_json(contained(task_dir / ".lock", task_dir))
    if not lock_token or lock.get("token") != lock_token:
        fail("TASK_LOCK_REQUIRED", "The RSS helper must hold this task's lock.")
    input_data = read_json(contained(task_dir / "input.json", task_dir))
    if "poster_layout" in input_data and (mode != "rss-share" or input_data["poster_layout"] not in ("content", "editorial")):
        fail("INVALID_STATE", "poster_layout is only supported as content or editorial in rss-share mode.")
    result_path = contained(task_dir / "result.json", task_dir)
    result = read_json(result_path)
    article = contained(task_dir / ("caption.txt" if mode == "rss-share" else "article.md"), task_dir)
    expected_article = article.relative_to(workspace).as_posix()
    for data in (input_data, result):
        if data.get("version") != 1 or data.get("mode") != mode or data.get("task_id") != task_id or data.get("source_url") != source:
            fail("INVALID_STATE", "Bridge arguments do not match stored task input.")
    def finish(status, code=None, message=None, **changes):
        result.update(status=status, stage="wechat_draft", **changes,
                      error={"code": code, "message": message} if code else None,
                      updated_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))
        atomic_result(result_path, result, task_dir)
        return result

    # Preserve historical results, including publication errors, without migration.
    if result.get("status") in ("succeeded", "needs_attention"):
        return result
    if isinstance(result.get("media_id"), str) and result["media_id"].strip():
        return finish("needs_attention", "WECHAT_SUBMISSION_UNKNOWN", "A draft already exists. Inspect the saved draft manually before any further action.")
    if result.get("stage") != "wechat_draft" or result.get("status") != "running" or result.get("article_path") != expected_article or result.get("title") != title:
        fail("INVALID_STATE", "The RSS helper must validate the article before calling the bridge.")
    cover_value = result.get("cover_path")
    if mode != "rss-share":
        if not isinstance(cover_value, str):
            fail("INVALID_STATE", "Missing cover path.")
        cover = contained(workspace / cover_value, task_dir / "assets")
        if not re.fullmatch(r"01-cover\.(?:png|jpg)", cover.name, re.I):
            fail("INVALID_STATE", "The cover must be a fixed task PNG or JPG.")

    # Link traversal is a structural path problem: raise it directly instead of
    # reporting a submission failure. Content validation stays inside the
    # suppressed block and becomes a structured failed result.
    if mode == "rss-share":
        ensure_no_share_links(task_dir, workspace)

    # Suppress import-time output and every original publisher print. Raw
    # exceptions are deliberately never stored, printed or interpolated.
    with open(os.devnull, "w", encoding="utf-8") as sink, redirect_stdout(sink), redirect_stderr(sink):
        try:
            if mode == "rss-share":
                share_images = validate_share(task_dir, result, title, source, workspace)
            publisher = module_loader()
            publisher.load_env_from_dotenv(workspace)
            app_id = os.environ.get("WECHAT_APP_ID")
            app_secret = os.environ.get("WECHAT_APP_SECRET")
            if not usable_configuration(app_id) or not usable_configuration(app_secret):
                return finish("failed", "WECHAT_CONFIG_MISSING", "WeChat configuration is missing, empty or a placeholder.")
            args = SimpleNamespace(
                appid=app_id, secret=app_secret, title=title, digest=digest,
                content=None, content_file=str(article), content_format="markdown",
                style_preset="auto", author="Aide Hub", article_type="newspic" if mode == "rss-share" else "news",
                cover_image=None if mode == "rss-share" else str(cover), thumb_media_id=None, content_source_url=source,
                ignore_image_errors=False, extra_css_file=None, image=[], image_dir=None,
                delete_draft=None,
            )
            if mode == "rss-share":
                args.content = article.read_text(encoding="utf-8-sig").strip()
                args.content_file = None
                args.content_format = "auto"
                args.cover_image = None
                args.image = [str(image) for image in share_images]
            # Use the original argument constraints as well as the JS validator.
            publisher.validate_args(argparse.ArgumentParser(add_help=False), args)
            token = publisher.get_access_token(app_id, app_secret)
            if not isinstance(token, str) or not token.strip():
                return finish("failed", "WECHAT_PREPARATION_FAILED", "WeChat token or image preparation failed before draft submission.")
            prepared = publisher.build_newspic_article(args, token) if mode == "rss-share" else publisher.build_news_article(args, token)
            valid = isinstance(prepared, dict)
            if valid and mode == "rss-share":
                image_list = prepared.get("image_info", {}).get("image_list", [])
                valid = prepared.get("article_type") == "newspic" and len(image_list) == len(share_images) and all(bool(item.get("image_media_id")) for item in image_list)
            elif valid:
                valid = bool(prepared.get("thumb_media_id"))
            if not valid:
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
    parser.add_argument("--workspace", default=str(Path.cwd()))
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
        result = run_bridge(args.task_dir, args.lock_token, args.title, args.digest, args.source, workspace=args.workspace)
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
