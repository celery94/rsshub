"""Offline tests for fetch-share-materials.py; no network, synthetic HTML and PIL bytes."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image


def _load_module():
    spec = importlib.util.spec_from_file_location(
        "fetch_share_materials", Path(__file__).with_name("fetch-share-materials.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MATERIALS = _load_module()
SOURCE = "https://source.example/posts/one"
DEFAULT_NOW = "2026-01-02T03:04:05+00:00"


def encoded_image(width=1200, height=800, image_format="PNG", color=(90, 120, 150)):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format=image_format)
    return buffer.getvalue()


def page_with_images(*urls):
    images = "".join(f'<img src="{url}" alt="图{index}">' for index, url in enumerate(urls, 1))
    return f"<html><body><article>{images}</article></body></html>"


def downloaded(media_type, data):
    return MATERIALS.Downloaded(media_type, data)


class FakeFetcher:
    def __init__(self, html="", error=None):
        self.html = html
        self.error = error
        self.calls = []

    def __call__(self, url, *, timeout=20.0):
        self.calls.append(url)
        if self.error is not None:
            raise self.error
        return self.html


class FakeDownloader:
    def __init__(self, responses=None):
        self.responses = dict(responses or {})
        self.calls = []

    def __call__(self, url, *, referer, timeout=20.0, validate_url=None):
        self.calls.append(url)
        response = self.responses.get(url)
        if isinstance(response, Exception):
            raise response
        if response is None:
            raise MATERIALS.FetchError("测试没有为该地址提供图片响应。")
        return response


class FakeResponse:
    def __init__(self, status=200, headers=None, chunks=()):
        self.status_code = status
        self.headers = dict(headers or {})
        self.encoding = "utf-8"
        self._chunks = list(chunks)
        self.closed = False

    def iter_content(self, chunk_size):
        yield from self._chunks

    def close(self):
        self.closed = True


def invoke(argv, *, html="", fetcher=None, downloader=None, validate=None):
    fetcher = fetcher if fetcher is not None else FakeFetcher(html)
    downloader = downloader if downloader is not None else FakeDownloader()
    validate = validate if validate is not None else (lambda url: True)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        code = MATERIALS.main(
            argv,
            fetch_page=fetcher,
            download_image=downloader,
            validate_url=validate,
            now=lambda: DEFAULT_NOW,
        )
    return code, json.loads(output.getvalue()), fetcher, downloader


class CandidateExtractionTests(unittest.TestCase):
    def test_extracts_all_candidate_attributes_and_resolves_urls(self):
        html = """
        <html><body><article>
          <img src="/hero.png" alt="封面">
          <img data-src="https://cdn.example.com/photo.jpg" alt=" 现场  照片 ">
          <img data-original="//cdn.example.com/original.webp">
          <img srcset="/small.jpg 1x, /large.jpg 2x" alt="srcset">
          <img alt="没有地址">
          <img src="/hero.png" alt="重复地址">
        </article></body></html>
        """
        candidates = MATERIALS.extract_image_candidates(html, SOURCE + "/page")
        self.assertEqual(
            [(candidate.url, candidate.alt) for candidate in candidates],
            [
                ("https://source.example/hero.png", "封面"),
                ("https://cdn.example.com/photo.jpg", "现场 照片"),
                ("https://cdn.example.com/original.webp", ""),
                ("https://source.example/small.jpg", "srcset"),
            ],
        )

    def test_srcset_uses_only_its_first_url(self):
        html = '<img srcset=" /first.png 1x , /second.png 2x">'
        candidates = MATERIALS.extract_image_candidates(html, SOURCE)
        self.assertEqual([candidate.url for candidate in candidates], ["https://source.example/first.png"])

    def test_skips_page_chrome_logos_icons_and_avatars(self):
        html = """
        <html><body>
          <img src="/assets/app-logo.66344e903b.png" alt="app logo">
          <img src="/avatar/user-1.jpg" alt="用户头像">
          <img src="/static/icon-arrow.svg" alt="">
          <img src="/photo/ceremony.jpg" alt="颁奖现场">
        </body></html>
        """
        candidates = MATERIALS.extract_image_candidates(html, SOURCE)
        self.assertEqual([candidate.url for candidate in candidates], ["https://source.example/photo/ceremony.jpg"])

    def test_empty_html_yields_no_candidates(self):
        self.assertEqual(MATERIALS.extract_image_candidates("<p>无图</p>", SOURCE), [])


class UrlSafetyTests(unittest.TestCase):
    @staticmethod
    def resolver(host):
        return {
            "source.example": ["93.184.216.34"],
            "cdn.example.com": ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"],
            "internal.example": ["10.1.2.3"],
            "mixed.example": ["93.184.216.34", "192.168.0.10"],
        }[host]

    def test_public_http_urls_are_allowed(self):
        for url in (
            "https://source.example/a.png",
            "http://source.example/a.png",
            "https://cdn.example.com/a.jpg",
            "https://93.184.216.34/a.png",
            "http://[2001:4860:4860::8888]/a.png",
            "https://source.example./a.png",
        ):
            with self.subTest(url=url):
                self.assertTrue(MATERIALS.url_is_public(url, resolve=self.resolver))

    def test_private_reserved_loopback_and_link_local_urls_are_rejected(self):
        for url in (
            "http://127.0.0.1/a.png",
            "http://10.0.0.5/a.png",
            "http://192.168.1.20/a.png",
            "http://169.254.1.1/a.png",
            "http://0.0.0.0/a.png",
            "http://[::1]/a.png",
            "http://[::ffff:127.0.0.1]/a.png",
            "http://[fd00::1]/a.png",
            "http://localhost/a.png",
            "http://internal.example/a.png",
            "http://mixed.example/a.png",
        ):
            with self.subTest(url=url):
                self.assertFalse(MATERIALS.url_is_public(url, resolve=self.resolver))

    def test_credentials_non_http_and_dns_failures_are_rejected(self):
        for url in (
            "http://user:secret@source.example/a.png",
            "http://user@source.example/a.png",
            "ftp://source.example/a.png",
            "file:///C:/a.png",
            "javascript:alert(1)",
            "data:image/png;base64,AAAA",
            "not-a-url",
        ):
            with self.subTest(url=url):
                self.assertFalse(MATERIALS.url_is_public(url, resolve=self.resolver))

        def unreachable(host):
            raise OSError("dns failure")

        self.assertFalse(MATERIALS.url_is_public("https://unknown.example/a.png", resolve=unreachable))


class DownloaderTests(unittest.TestCase):
    def test_image_download_uses_browser_headers_and_checks_every_hop(self):
        image = encoded_image(800, 600)
        responses = [
            FakeResponse(302, {"Location": "https://cdn.example.com/photo.png"}),
            FakeResponse(200, {"Content-Type": "image/png; charset=binary"}, [image]),
        ]
        validated = []

        def validate(url):
            validated.append(url)
            return "127.0.0.1" not in url

        with patch.object(MATERIALS.requests, "get", side_effect=responses) as get:
            result = MATERIALS.download_image(
                "https://source.example.com/photo.png",
                referer="https://source.example.com/post",
                timeout=5,
                validate_url=validate,
            )
        self.assertEqual(
            validated,
            ["https://source.example.com/photo.png", "https://cdn.example.com/photo.png"],
        )
        self.assertEqual(result.content_type, "image/png")
        self.assertEqual(result.content, image)
        self.assertEqual(get.call_count, 2)
        first_headers = get.call_args_list[0].kwargs["headers"]
        self.assertIn("Mozilla/5.0", first_headers["User-Agent"])
        self.assertEqual(first_headers["Referer"], "https://source.example.com/post")
        self.assertTrue(first_headers["Accept"].startswith("image/"))
        self.assertNotIn("Authorization", first_headers)
        self.assertNotIn("Cookie", first_headers)

    def test_redirect_to_private_address_is_rejected_before_request(self):
        responses = [FakeResponse(302, {"Location": "http://127.0.0.1/secret.png"})]

        def validate(url):
            return "127.0.0.1" not in url

        with patch.object(MATERIALS.requests, "get", side_effect=responses) as get:
            with self.assertRaises(MATERIALS.UnsafeUrlError):
                MATERIALS.download_image(
                    "https://source.example.com/photo.png",
                    referer="https://source.example.com/post",
                    timeout=5,
                    validate_url=validate,
                )
        self.assertEqual(get.call_count, 1)

    def test_more_than_three_redirects_fail(self):
        responses = [
            FakeResponse(302, {"Location": f"https://source.example.com/{index}"})
            for index in range(4)
        ]
        with patch.object(MATERIALS.requests, "get", side_effect=responses) as get:
            with self.assertRaises(MATERIALS.FetchError):
                MATERIALS.download_image(
                    "https://source.example.com/photo.png",
                    referer="https://source.example.com/post",
                    timeout=5,
                    validate_url=lambda url: True,
                )
        self.assertEqual(get.call_count, 4)

    def test_non_image_content_type_is_rejected(self):
        responses = [FakeResponse(200, {"Content-Type": "text/html"}, [b"<html></html>"])]
        with patch.object(MATERIALS.requests, "get", side_effect=responses):
            with self.assertRaises(MATERIALS.FetchError):
                MATERIALS.download_image(
                    "https://source.example.com/page",
                    referer="https://source.example.com/post",
                    timeout=5,
                    validate_url=lambda url: True,
                )

    def test_declared_content_length_over_limit_fails_before_reading(self):
        responses = [
            FakeResponse(
                200,
                {"Content-Type": "image/png", "Content-Length": str(MATERIALS.MAX_IMAGE_BYTES + 1)},
                [],
            )
        ]
        with patch.object(MATERIALS.requests, "get", side_effect=responses):
            with self.assertRaises(MATERIALS.FetchError):
                MATERIALS.download_image(
                    "https://source.example.com/huge.png",
                    referer="https://source.example.com/post",
                    timeout=5,
                    validate_url=lambda url: True,
                )


class PageFetchTests(unittest.TestCase):
    def test_fetch_page_accepts_html_and_uses_origin_referer(self):
        html = "<html><body><img src='/a.png'></body></html>".encode("utf-8")
        responses = [FakeResponse(200, {"Content-Type": "text/html; charset=utf-8"}, [html])]
        validated = []
        with patch.object(MATERIALS.requests, "get", side_effect=responses) as get:
            text = MATERIALS.fetch_page(
                "https://source.example.com/posts/1",
                timeout=5,
                validate_url=lambda url: validated.append(url) or True,
            )
        self.assertIn("<img", text)
        self.assertEqual(validated, ["https://source.example.com/posts/1"])
        headers = get.call_args.kwargs["headers"]
        self.assertIn("Mozilla/5.0", headers["User-Agent"])
        self.assertEqual(headers["Referer"], "https://source.example.com/")

    def test_fetch_page_rejects_non_html_and_error_status(self):
        for status, content_type in ((200, "image/png"), (404, "text/html")):
            with self.subTest(status=status):
                responses = [FakeResponse(status, {"Content-Type": content_type}, [b"<html></html>"])]
                with patch.object(MATERIALS.requests, "get", side_effect=responses):
                    with self.assertRaises(MATERIALS.FetchError):
                        MATERIALS.fetch_page(
                            "https://source.example.com/posts/1",
                            timeout=5,
                            validate_url=lambda url: True,
                        )


class InspectImageTests(unittest.TestCase):
    def test_png_and_jpeg_are_accepted_with_their_extensions(self):
        width, height, extension, payload = MATERIALS.inspect_image(encoded_image(1200, 800, "PNG"))
        self.assertEqual((width, height, extension), (1200, 800, ".png"))
        self.assertEqual(payload, encoded_image(1200, 800, "PNG"))
        width, height, extension, _ = MATERIALS.inspect_image(encoded_image(1000, 700, "JPEG"))
        self.assertEqual((width, height, extension), (1000, 700, ".jpg"))

    def test_gif_and_undersized_images_are_rejected(self):
        gif = io.BytesIO()
        Image.new("RGB", (800, 600)).save(gif, format="GIF")
        for data in (gif.getvalue(), encoded_image(599, 800), encoded_image(800, 299)):
            with self.subTest(size=len(data)):
                with self.assertRaises(MATERIALS.MaterialError):
                    MATERIALS.inspect_image(data)


class PipelineTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="rss-share-materials-")
        self.addCleanup(temporary.cleanup)
        self.workspace = Path(temporary.name)
        self.task = self.workspace / "output" / "rss-shares" / "share-test"
        self.task.mkdir(parents=True)

    def argv(self, *extra):
        return ["--source", SOURCE, "--task-dir", str(self.task), *extra]

    def test_writes_materials_and_manifest(self):
        html = page_with_images(
            "https://source.example/hero.png",
            "https://source.example/photo.jpg",
            "https://source.example/tiny.png",
        )
        png = encoded_image(1200, 800, "PNG")
        jpeg = encoded_image(1000, 700, "JPEG")
        downloader = FakeDownloader(
            {
                "https://source.example/hero.png": downloaded("image/png", png),
                "https://source.example/photo.jpg": downloaded("image/jpeg", jpeg),
                "https://source.example/tiny.png": downloaded(
                    "image/png", encoded_image(120, 80, "PNG")
                ),
            }
        )
        code, output, fetcher, downloader = invoke(
            self.argv("--max", "3"), html=html, downloader=downloader
        )
        self.assertEqual(code, 0)
        self.assertTrue(output["ok"])
        self.assertEqual(output["skipped"], 1)
        self.assertEqual([item["file"] for item in output["materials"]], [
            "./materials/01-source.png",
            "./materials/02-source.jpg",
        ])
        self.assertEqual(fetcher.calls, [SOURCE])

        materials_dir = self.task / "materials"
        first = materials_dir / "01-source.png"
        second = materials_dir / "02-source.jpg"
        self.assertEqual(first.read_bytes(), png)
        self.assertEqual(second.read_bytes(), jpeg)
        with Image.open(first) as image:
            self.assertEqual((image.format, image.size), ("PNG", (1200, 800)))
        with Image.open(second) as image:
            self.assertEqual((image.format, image.size), ("JPEG", (1000, 700)))

        manifest = json.loads((materials_dir / "materials.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["source_page"], SOURCE)
        self.assertEqual(manifest["fetched_at"], DEFAULT_NOW)
        self.assertEqual(len(manifest["materials"]), 2)
        hero, photo = manifest["materials"]
        self.assertEqual(hero["file"], "./materials/01-source.png")
        self.assertEqual(hero["source_url"], "https://source.example/hero.png")
        self.assertEqual((hero["width"], hero["height"]), (1200, 800))
        self.assertEqual(hero["sha256"], hashlib.sha256(png).hexdigest())
        self.assertEqual(hero["alt"], "图1")
        self.assertEqual(photo["source_url"], "https://source.example/photo.jpg")
        self.assertEqual(photo["sha256"], hashlib.sha256(jpeg).hexdigest())

    def test_max_limits_saved_materials_and_stops_downloading(self):
        html = page_with_images(
            "https://source.example/one.png",
            "https://source.example/two.png",
        )
        downloader = FakeDownloader(
            {
                "https://source.example/one.png": downloaded("image/png", encoded_image()),
                "https://source.example/two.png": downloaded("image/png", encoded_image(1000, 700)),
            }
        )
        code, output, _, downloader = invoke(
            self.argv("--max", "1"), html=html, downloader=downloader
        )
        self.assertEqual(code, 0)
        self.assertEqual(len(output["materials"]), 1)
        self.assertEqual(downloader.calls, ["https://source.example/one.png"])

    def test_dedupes_repeated_urls_and_identical_bytes(self):
        hero = encoded_image(900, 600, color=(10, 90, 40))
        same = encoded_image(900, 600, color=(90, 40, 10))
        html = page_with_images(
            "https://source.example/hero.png",
            "https://source.example/hero.png",
            "https://source.example/copy-a.png",
            "https://source.example/copy-b.png",
        )
        downloader = FakeDownloader(
            {
                "https://source.example/hero.png": downloaded("image/png", hero),
                "https://source.example/copy-a.png": downloaded("image/png", same),
                "https://source.example/copy-b.png": downloaded("image/png", same),
            }
        )
        code, output, _, downloader = invoke(
            self.argv("--max", "3"), html=html, downloader=downloader
        )
        self.assertEqual(code, 0)
        self.assertEqual(output["skipped"], 1)
        self.assertEqual(
            [item["source_url"] for item in output["materials"]],
            ["https://source.example/hero.png", "https://source.example/copy-a.png"],
        )
        self.assertEqual(downloader.calls, [
            "https://source.example/hero.png",
            "https://source.example/copy-a.png",
            "https://source.example/copy-b.png",
        ])
        files = sorted(path.name for path in (self.task / "materials").glob("*-source.*"))
        self.assertEqual(files, ["01-source.png", "02-source.png"])

    def test_webp_is_converted_to_png(self):
        webp = encoded_image(1000, 700, "WEBP")
        html = page_with_images("https://source.example/hero.webp")
        downloader = FakeDownloader({"https://source.example/hero.webp": downloaded("image/webp", webp)})
        code, output, _, _ = invoke(self.argv(), html=html, downloader=downloader)
        self.assertEqual(code, 0)
        self.assertEqual(output["materials"][0]["file"], "./materials/01-source.png")
        target = self.task / "materials" / "01-source.png"
        saved = target.read_bytes()
        self.assertEqual(output["materials"][0]["sha256"], hashlib.sha256(saved).hexdigest())
        with Image.open(target) as image:
            self.assertEqual((image.format, image.size), ("PNG", (1000, 700)))

    def test_small_image_non_image_corrupt_and_oversize_are_skipped(self):
        html = page_with_images(
            "https://source.example/tiny.png",
            "https://source.example/banner.png",
            "https://source.example/page",
            "https://source.example/broken.png",
            "https://source.example/huge.png",
        )
        downloader = FakeDownloader(
            {
                "https://source.example/tiny.png": downloaded("image/png", encoded_image(500, 400)),
                "https://source.example/banner.png": downloaded("image/png", encoded_image(1000, 200)),
                "https://source.example/page": downloaded("text/html", b"<html></html>"),
                "https://source.example/broken.png": downloaded("image/png", b"not a real png"),
                "https://source.example/huge.png": downloaded(
                    "image/png", b"x" * (MATERIALS.MAX_IMAGE_BYTES + 1)
                ),
            }
        )
        code, output, _, _ = invoke(self.argv("--max", "5"), html=html, downloader=downloader)
        self.assertEqual(code, 0)
        self.assertTrue(output["ok"])
        self.assertEqual(output["materials"], [])
        self.assertIn("跳过 5 个候选", output["note"])
        self.assertFalse((self.task / "materials" / "materials.json").exists())

    def test_no_images_returns_ok_and_note_without_writing_files(self):
        code, output, _, _ = invoke(self.argv(), html="<html><body><p>无图</p></body></html>")
        self.assertEqual(code, 0)
        self.assertEqual(set(output), {"ok", "materials", "note"})
        self.assertTrue(output["ok"])
        self.assertEqual(output["materials"], [])
        self.assertTrue(output["note"])
        self.assertFalse((self.task / "materials").exists())

    def test_page_fetch_failure_returns_ok_and_note(self):
        fetcher = FakeFetcher(error=MATERIALS.FetchError("模拟网络失败"))
        code, output, fetcher, _ = invoke(self.argv(), fetcher=fetcher)
        self.assertEqual(code, 0)
        self.assertEqual(output["ok"], True)
        self.assertEqual(output["materials"], [])
        self.assertIn("页面", output["note"])
        self.assertEqual(fetcher.calls, [SOURCE])

    def test_private_image_url_is_skipped(self):
        html = page_with_images(
            "http://127.0.0.1/secret.png",
            "https://source.example/ok.png",
        )
        downloader = FakeDownloader(
            {"https://source.example/ok.png": downloaded("image/png", encoded_image())}
        )
        code, output, _, downloader = invoke(
            self.argv(),
            html=html,
            downloader=downloader,
            validate=lambda url: "127.0.0.1" not in url,
        )
        self.assertEqual(code, 0)
        self.assertEqual(output["skipped"], 1)
        self.assertEqual(len(output["materials"]), 1)
        self.assertEqual(downloader.calls, ["https://source.example/ok.png"])

    def test_non_public_source_page_is_skipped_without_fetching(self):
        fetcher = FakeFetcher(html=page_with_images("https://source.example/a.png"))
        code, output, fetcher, _ = invoke(self.argv(), fetcher=fetcher, validate=lambda url: False)
        self.assertEqual(code, 0)
        self.assertEqual(set(output), {"ok", "materials", "note"})
        self.assertEqual(output["materials"], [])
        self.assertEqual(fetcher.calls, [])

    def test_invalid_arguments_exit_1_with_json_error(self):
        not_a_directory = self.task / "input.json"
        not_a_directory.write_text("{}", encoding="utf-8")
        cases = [
            [],
            ["--task-dir", str(self.task)],
            ["--source", SOURCE],
            ["--source", "not-a-url", "--task-dir", str(self.task)],
            ["--source", "ftp://source.example/a", "--task-dir", str(self.task)],
            ["--source", "https://user:secret@source.example/a", "--task-dir", str(self.task)],
            ["--source", SOURCE, "--task-dir", str(self.workspace / "missing")],
            ["--source", SOURCE, "--task-dir", str(not_a_directory)],
            ["--source", SOURCE, "--task-dir", str(self.task), "--max", "0"],
            ["--source", SOURCE, "--task-dir", str(self.task), "--max", "abc"],
            ["--source", SOURCE, "--task-dir", str(self.task), "--timeout", "0"],
            ["--source", SOURCE, "--task-dir", str(self.task), "--timeout", "-3"],
        ]
        for argv in cases:
            with self.subTest(argv=argv):
                code, output, fetcher, _ = invoke(argv)
                self.assertEqual(code, 1)
                self.assertFalse(output["ok"])
                self.assertTrue(output["error"])
                self.assertEqual(fetcher.calls, [])
        self.assertFalse((self.task / "materials").exists())

    @unittest.skipUnless(os.name == "nt", "junction creation requires Windows")
    def test_materials_junction_outside_task_is_rejected(self):
        outside = self.task.parent / "outside-materials"
        outside.mkdir()
        junction = self.task / "materials"
        try:
            subprocess.run(
                ["cmd", "/c", "mklink", "/J", str(junction), str(outside)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except (OSError, subprocess.CalledProcessError):
            self.skipTest("无法在当前环境创建 junction")
        try:
            downloader = FakeDownloader(
                {"https://source.example/hero.png": downloaded("image/png", encoded_image())}
            )
            code, output, _, _ = invoke(
                self.argv(),
                html=page_with_images("https://source.example/hero.png"),
                downloader=downloader,
            )
            self.assertEqual(code, 1)
            self.assertFalse(output["ok"])
            self.assertIn("materials", output["error"])
        finally:
            os.rmdir(junction)


if __name__ == "__main__":
    unittest.main()
