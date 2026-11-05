#!/usr/bin/env python3
"""Fetch original-page images as optional rss-share material.

The source page and every image are untrusted data. This script only reads
markup to extract candidate image URLs, inspects response metadata and
validates decoded pixels; it never executes page text or scripts and never
follows links other than images (and their validated redirects). No
credentials, Authorization headers or login cookies are sent.

Usage:
  python fetch-share-materials.py --source <http(s) URL> \
      --task-dir output/rss-shares/<task_id> [--max 2] [--timeout 20]

Exit 0 with saved material:
  {"ok": true, "materials": [{"file", "source_url", "width", "height",
                              "sha256", "alt"}, ...], "skipped": N}
Exit 0 without usable images (never blocks poster generation):
  {"ok": true, "materials": [], "note": "reason"}
Exit 1 for invalid arguments or task directory:
  {"ok": false, "error": "reason"}

Outputs:
  <task-dir>/materials/NN-source.png|jpg
  <task-dir>/materials/materials.json
    {"source_page": url, "fetched_at": iso8601,
     "materials": [{"file": "./materials/01-source.jpg", "source_url": ...,
                    "width": ..., "height": ..., "sha256": ..., "alt": ...}]}

The three trust-boundary hooks accept injected fakes for offline tests:
  fetch_page(url, *, timeout) -> html text
  download_image(url, *, referer, timeout, validate_url) -> Downloaded
  validate_url(url) -> bool
Module-level functions are the real implementations.
"""
import argparse
import hashlib
import io
import ipaddress
import json
import math
import os
import re
import socket
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import NamedTuple
from urllib.parse import urljoin, urlsplit

import requests
from bs4 import BeautifulSoup
from PIL import Image, UnidentifiedImageError

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
IMAGE_ACCEPT = "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5"
REDIRECT_CODES = frozenset({301, 302, 303, 307, 308})
MAX_REDIRECTS = 3
MAX_PAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 50_000_000
MAX_CANDIDATES = 200
MAX_ALT = 200
MIN_WIDTH, MIN_HEIGHT = 600, 300
CANDIDATE_ATTRIBUTES = ("src", "data-src", "data-original")
# Page chrome (site logo, icons, avatars) is not article material even when large.
DECORATIVE_HINTS = re.compile(
    r"(?<![a-z])(?:logo|logos|icon|icons|avatar|sprite|badge|qrcode|qr-code|"
    r"placeholder|spinner|favicon|emoji|blank)(?![a-z])",
    re.I,
)
IMAGE_EXTENSIONS = {"PNG": ".png", "JPEG": ".jpg"}
HTML_TYPES = frozenset({"text/html", "application/xhtml+xml"})


class MaterialError(Exception):
    """A candidate page or image cannot be used; the caller skips it."""


class UnsafeUrlError(MaterialError):
    """The URL is not a public HTTP(S) address."""


class FetchError(MaterialError):
    """Network, status or response-metadata failure."""


class UsageError(Exception):
    """Invalid CLI input or task directory; the process exits 1."""


class Candidate(NamedTuple):
    url: str
    alt: str


class Downloaded(NamedTuple):
    content_type: str
    content: bytes


def _utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _configure_console():
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


def _emit(payload):
    print(json.dumps(payload, ensure_ascii=False))


def _reason(error):
    message = " ".join(str(error).split())
    name = type(error).__name__
    return f"{name}: {message[:160]}" if message else name


def resolve_addresses(host):
    """Resolve a hostname to IP strings for the public-address guard."""
    infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    return [info[4][0].split("%", 1)[0] for info in infos]


def _is_global_address(text):
    try:
        address = ipaddress.ip_address(text)
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return address.is_global


def url_is_public(url, *, resolve=resolve_addresses):
    """Return True only for credential-free HTTP(S) URLs on public addresses.

    Every resolved address must be global, so a hostname mixing public and
    private answers (DNS rebinding) is rejected. Resolution errors count as
    unsafe. Redirect hops are re-checked by the real fetchers.
    """
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").lower().rstrip(".")
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https") or not host:
        return False
    if parsed.username or parsed.password:
        return False
    if host == "localhost" or host.endswith(".localhost"):
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None:
        return _is_global_address(host)
    try:
        addresses = resolve(host)
    except Exception:
        return False
    return bool(addresses) and all(_is_global_address(item) for item in addresses)


def _origin(url):
    parsed = urlsplit(url)
    return f"{parsed.scheme}://{parsed.netloc}/" if parsed.scheme and parsed.netloc else ""


def _request_headers(referer, accept):
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": accept,
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    if referer:
        headers["Referer"] = referer
    return headers


def _media_type(response):
    return (response.headers.get("Content-Type") or "").split(";")[0].strip().lower()


def _get_following_redirects(url, *, headers, timeout, validate_url):
    """GET with at most MAX_REDIRECTS redirects; every hop URL is validated."""
    for _hop in range(MAX_REDIRECTS + 1):
        if not validate_url(url):
            raise UnsafeUrlError("URL 不是公开的 HTTP(S) 地址。")
        try:
            response = requests.get(
                url,
                headers=headers,
                timeout=timeout,
                allow_redirects=False,
                stream=True,
            )
        except requests.RequestException as error:
            raise FetchError(f"请求失败：{error.__class__.__name__}") from error
        location = (response.headers.get("Location") or "").strip()
        if response.status_code in REDIRECT_CODES and location:
            response.close()
            url = urljoin(url, location)
            continue
        return response
    raise FetchError(f"重定向超过 {MAX_REDIRECTS} 次。")


def fetch_page(url, *, timeout=20.0, validate_url=url_is_public):
    """Download the source page as text; only HTML responses are accepted."""
    response = _get_following_redirects(
        url,
        headers=_request_headers(_origin(url), PAGE_ACCEPT),
        timeout=timeout,
        validate_url=validate_url,
    )
    try:
        if not 200 <= response.status_code < 300:
            raise FetchError(f"页面返回 HTTP {response.status_code}。")
        content_type = _media_type(response)
        if content_type and content_type not in HTML_TYPES:
            raise FetchError("页面响应不是 HTML。")
        encoding = response.encoding or "utf-8"
        chunks, size = [], 0
        for chunk in response.iter_content(64 * 1024):
            if not chunk:
                continue
            size += len(chunk)
            if size > MAX_PAGE_BYTES:
                raise FetchError("页面超过 5MB 上限。")
            chunks.append(chunk)
        return b"".join(chunks).decode(encoding, errors="replace")
    finally:
        response.close()


def download_image(url, *, referer, timeout=20.0, validate_url=url_is_public):
    """Stream one image; enforce image/* and the 8MB cap before decoding."""
    response = _get_following_redirects(
        url,
        headers=_request_headers(referer, IMAGE_ACCEPT),
        timeout=timeout,
        validate_url=validate_url,
    )
    try:
        if not 200 <= response.status_code < 300:
            raise FetchError(f"图片返回 HTTP {response.status_code}。")
        content_type = _media_type(response)
        if not content_type.startswith("image/"):
            raise FetchError("图片响应不是 image/*。")
        declared = (response.headers.get("Content-Length") or "").strip()
        if declared.isdigit() and int(declared) > MAX_IMAGE_BYTES:
            raise FetchError("图片超过 8MB 上限。")
        chunks, size = [], 0
        for chunk in response.iter_content(64 * 1024):
            if not chunk:
                continue
            size += len(chunk)
            if size > MAX_IMAGE_BYTES:
                raise FetchError("图片超过 8MB 上限。")
            chunks.append(chunk)
        data = b"".join(chunks)
        if not data:
            raise FetchError("图片内容为空。")
        return Downloaded(content_type, data)
    finally:
        response.close()


def _first_srcset_url(srcset):
    for descriptor in srcset.split(","):
        tokens = descriptor.strip().split()
        if tokens:
            return tokens[0]
    return ""


def _is_decorative(url, alt):
    """Skip page chrome such as logos, icons and avatars by URL and alt text."""
    return bool(DECORATIVE_HINTS.search(f"{url} {alt}"))


def extract_image_candidates(html, base_url):
    """Collect <img> candidate URLs in document order, deduplicated by URL.

    Each image contributes its src, data-src, data-original and the first
    srcset URL, resolved with urljoin. Alt text belongs to the <img>.
    """
    try:
        soup = BeautifulSoup(html, "html.parser")
    except Exception as error:
        raise MaterialError("页面 HTML 无法解析。") from error
    candidates, seen = [], set()
    for image in soup.find_all("img"):
        alt = " ".join(str(image.get("alt") or "").split())[:MAX_ALT]
        raw_urls = []
        for attribute in CANDIDATE_ATTRIBUTES:
            value = image.get(attribute)
            if isinstance(value, str) and value.strip():
                raw_urls.append(value.strip())
        srcset = image.get("srcset")
        if isinstance(srcset, str) and srcset.strip():
            first = _first_srcset_url(srcset)
            if first:
                raw_urls.append(first)
        for raw in raw_urls:
            absolute = urljoin(base_url, raw)
            if not absolute or absolute in seen or _is_decorative(absolute, alt):
                continue
            seen.add(absolute)
            candidates.append(Candidate(absolute, alt))
    return candidates


def inspect_image(data):
    """Validate real pixels; return (width, height, extension, saved bytes).

    Only intact PNG/JPEG/WEBP images of at least 600x300 are accepted.
    WEBP is re-encoded as PNG so the rendered material keeps alpha safely.
    """
    try:
        with Image.open(io.BytesIO(data)) as image:
            image_format = (image.format or "").upper()
            if image.width * image.height > MAX_PIXELS:
                raise MaterialError("图片像素数量超过上限。")
            image.verify()
    except MaterialError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        raise MaterialError("图片无法解码。") from error
    if image_format not in {"PNG", "JPEG", "WEBP"}:
        raise MaterialError("图片格式不是 PNG/JPEG/WEBP。")
    try:
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            if width < MIN_WIDTH or height < MIN_HEIGHT:
                raise MaterialError("图片尺寸小于 600×300。")
            if image_format != "WEBP":
                return width, height, IMAGE_EXTENSIONS[image_format], data
            image.load()
            has_alpha = image.mode in ("RGBA", "LA") or "transparency" in image.info
            converted = image.convert("RGBA" if has_alpha else "RGB")
            buffer = io.BytesIO()
            converted.save(buffer, format="PNG")
            return width, height, ".png", buffer.getvalue()
    except MaterialError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        raise MaterialError("图片无法解码。") from error


def _require_source_url(source):
    try:
        parsed = urlsplit(source)
        host = parsed.hostname
    except ValueError as error:
        raise UsageError("--source 不是合法的 HTTP(S) 链接。") from error
    if parsed.scheme not in ("http", "https") or not host:
        raise UsageError("--source 必须是 HTTP(S) 链接。")
    if parsed.username or parsed.password:
        raise UsageError("--source 不能包含用户名或密码。")
    if any(character.isspace() or ord(character) < 0x20 or ord(character) == 0x7F for character in source):
        raise UsageError("--source 不能包含空白或控制字符。")
    return source


def _task_root(task_dir):
    try:
        root = Path(task_dir).expanduser().resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise UsageError(f"任务目录不存在或不可访问：{task_dir}") from error
    if not root.is_dir():
        raise UsageError(f"任务目录不是目录：{task_dir}")
    return root


def _materials_dir(root):
    materials = root / "materials"
    try:
        materials.mkdir(exist_ok=True)
        resolved = materials.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise UsageError(f"无法创建 materials 目录：{error}") from error
    if resolved != root / "materials":
        raise UsageError("materials 目录不能是指向任务目录之外的链接。")
    return resolved


def _write_material(materials_dir, number, extension, payload):
    target = materials_dir / f"{number:02d}-source{extension}"
    if target.is_symlink():
        raise UsageError("素材输出路径不能是符号链接。")
    target.write_bytes(payload)
    return target


def _write_manifest(materials_dir, payload):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=materials_dir, prefix=".materials-", suffix=".tmp", delete=False
        ) as handle:
            handle.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
            temporary = Path(handle.name)
        os.replace(temporary, materials_dir / "materials.json")
    except OSError as error:
        raise UsageError(f"写入 materials.json 失败：{error}") from error
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink(missing_ok=True)


def _download_material(candidate, source, download_image, validate_url, timeout):
    if not validate_url(candidate.url):
        raise UnsafeUrlError("候选地址不是公开的 HTTP(S) 地址。")
    response = download_image(candidate.url, referer=source, timeout=timeout, validate_url=validate_url)
    content_type = str(getattr(response, "content_type", "") or "").lower()
    if not content_type.startswith("image/"):
        raise MaterialError("响应不是图片。")
    data = getattr(response, "content", b"")
    if not isinstance(data, (bytes, bytearray)) or not data:
        raise MaterialError("图片内容为空。")
    data = bytes(data)
    if len(data) > MAX_IMAGE_BYTES:
        raise MaterialError("图片超过 8MB 上限。")
    return inspect_image(data)


def run(
    source,
    task_dir,
    *,
    max_materials=2,
    timeout=20.0,
    fetch_page=fetch_page,
    download_image=download_image,
    validate_url=url_is_public,
    now=_utc_now,
):
    """Fetch and save materials; emits one JSON result and returns an exit code."""
    _require_source_url(source)
    root = _task_root(task_dir)
    fetched_at = now()
    if not validate_url(source):
        _emit({"ok": True, "materials": [], "note": "源页面地址不是公开的 HTTP(S) 地址，已跳过。"})
        return 0
    try:
        html = fetch_page(source, timeout=timeout)
        candidates = extract_image_candidates(html, source)[:MAX_CANDIDATES]
    except Exception as error:
        _emit({"ok": True, "materials": [], "note": f"页面抓取或解析失败：{_reason(error)}"})
        return 0
    if not candidates:
        _emit({"ok": True, "materials": [], "note": "页面没有找到候选图片。"})
        return 0
    materials, seen_digests, skipped = [], set(), 0
    materials_dir = None
    for candidate in candidates:
        if len(materials) >= max_materials:
            break
        try:
            width, height, extension, payload = _download_material(
                candidate, source, download_image, validate_url, timeout
            )
        except MaterialError:
            skipped += 1
            continue
        digest = hashlib.sha256(payload).hexdigest()
        if digest in seen_digests:
            skipped += 1
            continue
        seen_digests.add(digest)
        if materials_dir is None:
            materials_dir = _materials_dir(root)
        target = _write_material(materials_dir, len(materials) + 1, extension, payload)
        materials.append(
            {
                "file": f"./materials/{target.name}",
                "source_url": candidate.url,
                "width": width,
                "height": height,
                "sha256": digest,
                "alt": candidate.alt,
            }
        )
    if not materials:
        note = "没有可用的原文配图。"
        if skipped:
            note += f"已跳过 {skipped} 个候选。"
        _emit({"ok": True, "materials": [], "note": note})
        return 0
    _write_manifest(
        materials_dir,
        {"source_page": source, "fetched_at": fetched_at, "materials": materials},
    )
    _emit({"ok": True, "materials": materials, "skipped": skipped})
    return 0


class _ArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise UsageError(message)


def main(
    argv=None,
    *,
    fetch_page=fetch_page,
    download_image=download_image,
    validate_url=url_is_public,
    now=_utc_now,
):
    """CLI entry point; returns 0 for a non-blocking empty result, else 1."""
    _configure_console()
    parser = _ArgumentParser(description="抓取原文页面配图，作为 rss-share 的可选原文素材。")
    parser.add_argument("--source", required=True, help="原文页面 HTTP(S) 链接。")
    parser.add_argument("--task-dir", required=True, dest="task_dir", help="output/rss-shares/<task_id> 任务目录。")
    parser.add_argument("--max", type=int, default=2, dest="max_materials", help="最多保存的素材数量，默认 2。")
    parser.add_argument("--timeout", type=float, default=20.0, help="单次请求超时秒数，默认 20。")
    try:
        args = parser.parse_args(argv)
        if args.max_materials < 1:
            raise UsageError("--max 必须是大于 0 的整数。")
        if not math.isfinite(args.timeout) or args.timeout <= 0:
            raise UsageError("--timeout 必须是大于 0 的秒数。")
        return run(
            args.source,
            args.task_dir,
            max_materials=args.max_materials,
            timeout=args.timeout,
            fetch_page=fetch_page,
            download_image=download_image,
            validate_url=validate_url,
            now=now,
        )
    except UsageError as error:
        _emit({"ok": False, "error": str(error)})
        return 1
    except OSError as error:
        _emit({"ok": False, "error": f"文件写入失败：{error}"})
        return 1
    except Exception as error:
        _emit({"ok": False, "error": f"未预期的失败：{_reason(error)}"})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
