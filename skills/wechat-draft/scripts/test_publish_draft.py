import argparse
import json
import re
import unittest
from unittest.mock import patch

from bs4 import BeautifulSoup

import publish_draft
from style_manager import build_styled_fragment


class RaisingParser:
    def error(self, message):
        raise ValueError(message)


def make_args(**overrides):
    values = {
        "appid": "appid",
        "secret": "secret",
        "article_type": "news",
        "title": "标题",
        "content": "正文",
        "content_file": None,
        "author": "",
        "digest": "",
        "cover_image": None,
        "thumb_media_id": "thumb-id",
        "content_source_url": "",
        "image": [],
        "image_dir": None,
        "style_preset": "auto",
        "extra_css_file": None,
        "delete_draft": None,
    }
    values.update(overrides)
    return argparse.Namespace(**values)


class ValidateArgsTests(unittest.TestCase):
    def setUp(self):
        self.parser = RaisingParser()

    def test_official_length_boundaries(self):
        publish_draft.validate_args(
            self.parser,
            make_args(title="题" * 32, author="作" * 16, digest="摘" * 120),
        )

        for field, value in (
            ("title", "题" * 33),
            ("author", "作" * 17),
            ("digest", "摘" * 121),
        ):
            with self.subTest(field=field), self.assertRaises(ValueError):
                publish_draft.validate_args(
                    self.parser,
                    make_args(**{field: value}),
                )

    def test_news_requires_cover(self):
        with self.assertRaisesRegex(ValueError, "cover-image"):
            publish_draft.validate_args(
                self.parser,
                make_args(thumb_media_id=None),
            )

    def test_newspic_uses_same_title_limit(self):
        publish_draft.validate_args(
            self.parser,
            make_args(
                article_type="newspic",
                title="题" * 32,
                content=None,
                thumb_media_id=None,
                image=["card.png"],
            ),
        )
        with self.assertRaises(ValueError):
            publish_draft.validate_args(
                self.parser,
                make_args(
                    article_type="newspic",
                    title="题" * 33,
                    content=None,
                    thumb_media_id=None,
                    image=["card.png"],
                ),
            )


class NewspicTextTests(unittest.TestCase):
    def test_normalization_preserves_line_and_paragraph_breaks(self):
        for newline in ("\n", "\r\n", "\r"):
            with self.subTest(newline=repr(newline)):
                content = newline.join([
                    "", "  事件与出处。  ", "", "", " \t ",
                    "主要\t  细节。", "保留条件与局限。", "",
                    "来源：https://example.com/article", "",
                ])
                self.assertEqual(
                    publish_draft.normalize_plain_text(content),
                    "事件与出处。\n\n主要 细节。\n保留条件与局限。\n\n来源：https://example.com/article",
                )

    @patch("publish_draft.upload_newspic_image", return_value="image-id")
    @patch("publish_draft.collect_newspic_image_paths", return_value=["card.png"])
    @patch("publish_draft.os.path.exists", return_value=True)
    def test_newspic_payload_keeps_caption_paragraphs_and_source_line(self, _exists, _collect, _upload):
        caption = "事件与出处。\n\n主要细节与限制。\n\n来源：https://example.com/article"
        article = publish_draft.build_newspic_article(
            make_args(article_type="newspic", content=caption, content_format="auto", image=["card.png"]),
            "token",
        )
        self.assertEqual(article["content"], caption)


class ArticlePayloadTests(unittest.TestCase):
    @patch("publish_draft.prepare_content", return_value="<p>正文</p>")
    def test_news_payload(self, _prepare_content):
        article = publish_draft.build_news_article(make_args(), "token")

        self.assertEqual(article["article_type"], "news")
        self.assertEqual(article["thumb_media_id"], "thumb-id")
        self.assertNotIn("is_original", article)
        self.assertNotIn("advertisement", article)

    @patch("publish_draft.upload_cover_image", return_value=None)
    def test_news_stops_when_cover_upload_fails(self, _upload_cover):
        with self.assertRaisesRegex(RuntimeError, "封面图片上传失败"):
            publish_draft.build_news_article(
                make_args(cover_image="cover.png", thumb_media_id=None),
                "token",
            )

    @patch("publish_draft.prepare_newspic_content", return_value="正文")
    @patch("publish_draft.upload_newspic_image", return_value="image-id")
    @patch("publish_draft.collect_newspic_image_paths", return_value=["card.png"])
    @patch("publish_draft.os.path.exists", return_value=True)
    def test_newspic_payload(self, _exists, _collect, _upload, _prepare):
        article = publish_draft.build_newspic_article(
            make_args(
                article_type="newspic",
                content=None,
                thumb_media_id=None,
                image=["card.png"],
            ),
            "token",
        )

        self.assertEqual(article["article_type"], "newspic")
        self.assertEqual(
            article["image_info"]["image_list"],
            [{"image_media_id": "image-id"}],
        )
        self.assertNotIn("is_original", article)
        self.assertNotIn("advertisement", article)


class DraftOnlyCliTests(unittest.TestCase):
    def setUp(self):
        self.argv = ["publish_draft.py", "--appid", "offline", "--secret", "offline"]
        self.get = self.enterContext(patch("publish_draft.requests.get"))
        self.post = self.enterContext(patch("publish_draft.requests.post"))
        self.get.return_value.json.return_value = {"access_token": "token"}
        self.post.return_value.json.return_value = {"media_id": "saved-draft"}
        self.enterContext(patch("builtins.print"))

    def run_cli(self, extra):
        with patch("publish_draft.sys.argv", self.argv + list(extra)):
            return publish_draft.main()

    def assert_no_freepublish_requests(self):
        for request in self.get.call_args_list + self.post.call_args_list:
            self.assertNotIn("freepublish", request.args[0])

    def test_default_news_creates_one_draft_without_publishing(self):
        result = self.run_cli([
            "--title", "标题", "--content", "<p>正文</p>",
            "--thumb-media-id", "thumb", "--style-preset", "none",
        ])
        self.assert_saved_draft(result, "news", 0)
        article = json.loads(self.post.call_args.kwargs["data"])["articles"][0]
        self.assertEqual(article["thumb_media_id"], "thumb")
        self.assertIn("正文", article["content"])

    @patch("publish_draft.upload_newspic_image", return_value="image-id")
    @patch("publish_draft.os.path.exists", return_value=True)
    def test_default_newspic_creates_one_draft_without_publishing(self, _exists, upload):
        result = self.run_cli([
            "--article-type", "newspic", "--title", "海报标题", "--image", "card.png",
        ])
        self.assert_saved_draft(result, "newspic", 1)
        upload.assert_called_once()
        article = json.loads(self.post.call_args.kwargs["data"])["articles"][0]
        self.assertEqual(article["image_info"]["image_list"], [{"image_media_id": "image-id"}])

    def assert_saved_draft(self, result, article_type, image_count):
        self.assertTrue(result["success"])
        self.assertEqual(result["media_id"], "saved-draft")
        self.assertEqual(result["article_type"], article_type)
        self.assertEqual(result["image_count"], image_count)
        self.assertEqual(result["message"], "草稿已保存，未提交发布。")
        self.assertFalse(any(key.startswith("publish") for key in result))
        self.assertNotIn("msg_data_id", result)
        self.get.assert_called_once_with(
            "https://api.weixin.qq.com/cgi-bin/token",
            params={"grant_type": "client_credential", "appid": "offline", "secret": "offline"},
            timeout=15,
        )
        self.post.assert_called_once()
        self.assertEqual(self.post.call_args.args[0], "https://api.weixin.qq.com/cgi-bin/draft/add")
        self.assert_no_freepublish_requests()

    def test_removed_flags_are_rejected_before_any_request(self):
        for extra in (["--publish-draft", "existing"], ["--draft-only"]):
            with self.subTest(extra=extra), patch("sys.stderr"), self.assertRaises(SystemExit) as error:
                self.run_cli(extra)
            self.assertEqual(error.exception.code, 2)
        self.get.assert_not_called()
        self.post.assert_not_called()

    def test_delete_draft_remains_available_without_content(self):
        self.post.return_value.json.return_value = {"errcode": 0, "errmsg": "ok"}
        result = self.run_cli(["--delete-draft", "existing"])
        self.assertTrue(result["success"])
        self.assertEqual(result["deleted_media_id"], "existing")
        self.post.assert_called_once_with(
            "https://api.weixin.qq.com/cgi-bin/draft/delete",
            params={"access_token": "token"},
            data=json.dumps({"media_id": "existing"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, timeout=30,
        )
        self.assert_no_freepublish_requests()

    def test_incomplete_draft_response_cannot_report_success_or_retry(self):
        for media_id in (None, "", "   ", True, 123, [], {}):
            with self.subTest(media_id=media_id):
                self.post.reset_mock()
                self.post.return_value.json.return_value = {"media_id": media_id}
                with self.assertRaisesRegex(ValueError, "media_id"):
                    self.run_cli([
                        "--title", "标题", "--content", "正文", "--thumb-media-id", "thumb",
                    ])
                self.post.assert_called_once()
                self.assert_no_freepublish_requests()

    def test_draft_creation_failure_is_not_retried(self):
        self.post.side_effect = TimeoutError("offline timeout")
        with self.assertRaises(TimeoutError):
            self.run_cli([
                "--title", "标题", "--content", "正文", "--thumb-media-id", "thumb",
            ])
        self.post.assert_called_once()
        self.assert_no_freepublish_requests()


class CodeBlockFormattingTests(unittest.TestCase):
    @staticmethod
    def visible_code(fragment):
        """模拟 white-space 被微信重置后的文本，只认 br 换行。"""
        soup = BeautifulSoup(fragment, "html.parser")
        block = soup.find("pre")
        for br in block.find_all("br"):
            br.replace_with("\u2028")
        text = re.sub(r"[ \t\r\n]+", " ", block.get_text())
        return text.replace("\u2028", "\n").replace("\xa0", " ")

    def test_publishing_preserves_reported_three_commands_without_whitespace_css(self):
        commands = (
            "winget install Microsoft.WinAppCli\n"
            "dotnet --version   # 应为 10.x\n"
            "winapp --version   # 应为 0.7.x 或更高"
        )
        args = make_args(
            content=f"```bash\n{commands}\n```",
            content_format="markdown",
            ignore_image_errors=False,
        )
        output = publish_draft.prepare_content(args, "unused-token")
        self.assertEqual(self.visible_code(output).rstrip("\n"), commands)

    def test_both_markdown_converters_and_all_presets_preserve_blank_lines_and_indent(self):
        code = 'if (x < 2 && ready) {\n    Print("中文 & <tag>");\n\n    return;\n}'
        for converter in (
            publish_draft.markdown_to_html,
            publish_draft.basic_markdown_to_html,
        ):
            for preset in ("default", "code", "essay", "guide", "none"):
                with self.subTest(converter=converter.__name__, preset=preset):
                    output = build_styled_fragment(
                        converter(f"```csharp\n{code}\n```"), preset, ""
                    )
                    self.assertEqual(self.visible_code(output).rstrip("\n"), code)
                    self.assertIsNone(BeautifulSoup(output, "html.parser").find("tag"))

    def test_html_highlighting_existing_breaks_tabs_and_inline_code(self):
        fragment = (
            '<p><code>inline code</code></p><pre><code class="language-python">'
            '<span style="color: red">if</span> x:\r\n'
            '\tprint(&quot;&lt;ok&gt;&quot;)<br>\n'
            '\treturn x</code></pre>'
        )
        # A newline after an existing br is also a real source newline.
        expected = 'if x:\n    print("<ok>")\n\n    return x'
        output = build_styled_fragment(fragment, "code", "")
        self.assertEqual(self.visible_code(output), expected)
        soup = BeautifulSoup(output, "html.parser")
        self.assertEqual(soup.select_one("p code").get_text(), "inline code")
        self.assertEqual(soup.select_one("pre span").get_text(), "if")
        self.assertIn("color: red", soup.select_one("pre span")["style"])
        second_output = build_styled_fragment(output, "code", "")
        self.assertEqual(self.visible_code(second_output), expected)

    def test_html_pre_without_code_tag(self):
        output = build_styled_fragment("<pre>one\n  two\n\nthree</pre>", "none", "")
        self.assertEqual(self.visible_code(output), "one\n  two\n\nthree")


if __name__ == "__main__":
    unittest.main()
