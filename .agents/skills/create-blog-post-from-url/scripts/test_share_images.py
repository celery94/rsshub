"""Offline tests for render-share-images.py.

Everything runs in temporary task directories with synthetic PIL fixtures: no
network, no Azure, no real task data. Run with:

    python -m unittest discover -s .agents/skills/create-blog-post-from-url/scripts -p 'test_*.py'
"""
import contextlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
import share_images  # noqa: E402


def _load_renderer():
    path = SCRIPTS / "render-share-images.py"
    spec = importlib.util.spec_from_file_location("render_share_images", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


RENDER = _load_renderer()

SOURCE = "https://example.com/articles/multi-image-poster-test"
QUOTE = "这是一段逐字引用的原文内容"
LONG_QUOTE = (
    "原文作者在文章中逐字写下了这样一段话，提醒读者注意信息图只是辅助说明，"
    "真正重要的判断仍然要回到原文核对数据来源、统计口径与时间范围，避免被单个数字误导。"
)
OVERFLOW_QUOTE = (
    "原文用较长篇幅说明了问题的来龙去脉，并提醒读者不要把单一数字当作全部结论，"
    "还需要结合上下文核对统计口径与时间范围，再判断这条信息是否值得转发。"
)
CACHED = (
    "编辑在原文中写道：这是一段逐字引用的原文内容，用于核对引语。"
    "原文还提到另一段引语，提醒读者核对数据来源。"
    + OVERFLOW_QUOTE
    + LONG_QUOTE
    + "以上内容只用于本地离线测试。"
)
CAPTION_BODY = (
    "本次分享用本地渲染器生成信息图，示例文字只用于离线测试，不包含真实文章内容。"
    "读者可以核对引语与数字，再结合原文语境判断结论。"
    "以上内容均为排版测试素材，不代表任何真实事件或产品。"
    "测试覆盖标题、数据、卡片、引语与原文素材等常见信息块的排版表现。"
)
CAPTION = CAPTION_BODY + "\n来源：" + SOURCE
DEFAULT_BG = (245, 241, 231)


def entry(file, headline, blocks, **extra):
    value = {"file": file, "headline": headline, "blocks": blocks}
    value.update(extra)
    return value


def quote_block(text=QUOTE, origin=None):
    block = {"type": "quote", "text": text}
    if origin is not None:
        block["from"] = origin
    return block


def metrics_block(items=None):
    return {"type": "metrics", "items": items or [
        {"value": "42%", "label": "测试数据"},
        {"value": "150–160", "label": "统计区间"},
    ]}


def cards_block(items=None):
    return {"type": "cards", "items": items or [
        {"heading": "结论先行", "body": "第一张卡片用于检查标题与正文的层级关系。"},
        {"heading": "数据支撑", "body": "第二张卡片用于检查多张卡片之间的正文间距是否一致。"},
    ]}


def text_block(body="这段普通段落用于检查正文的可读字号与行距，内容仅用于离线排版测试。"):
    return {"type": "text", "body": body}


def scene_block(path, alt=None):
    block = {"type": "scene", "path": path}
    if alt is not None:
        block["alt"] = alt
    return block


def material_block(path, caption=None):
    block = {"type": "material", "path": path}
    if caption is not None:
        block["caption"] = caption
    return block


class RendererTests(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.addCleanup(self._temp.cleanup)
        self.task = Path(self._temp.name) / "rss-share-test"
        self.task.mkdir()
        (self.task / "input.json").write_text(
            json.dumps(
                {
                    "version": 1,
                    "mode": "rss-share",
                    "task_id": "rss-share-test",
                    "source_url": SOURCE,
                    "cached_content": CACHED,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    # -- fixtures -------------------------------------------------------
    def picture(self, relative, size, color):
        path = self.task / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        image = Image.new("RGB", size, color)
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, size[1] // 4, size[0], size[1] * 3 // 4), fill=(250, 220, 180))
        draw.ellipse((size[0] // 4, size[1] // 3, size[0] * 3 // 4, size[1] * 2 // 3), fill=(30, 30, 30))
        if path.suffix.lower() == ".jpg":
            image.save(path, quality=92)
        else:
            image.save(path)
        return path

    def write_manifest(self, images, **top):
        manifest = {"title": "多图分享排版测试", "source": SOURCE, "caption": CAPTION, "images": images}
        manifest.update(top)
        path = self.task / "share.json"
        path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
        return path

    def render(self, images, **top):
        return RENDER.run(self.write_manifest(images, **top))

    def files(self):
        return sorted(str(path.relative_to(self.task)) for path in self.task.rglob("*") if path.is_file())

    def text_regions(self, report):
        return [region for region in report["images"][0]["regions"] if region["kind"] == "text"]

    # -- tests ----------------------------------------------------------
    def test_single_image_render_writes_png_at_manifest_size(self):
        self.picture("./scenes/01.png", (900, 600), (70, 110, 140))
        report = self.render([entry(
            "./assets/01-overview.png",
            "本地排版能力概览",
            [quote_block(origin="示例出处"), metrics_block(), cards_block()],
            subtitle="示例副标题用于检查标题层级",
        )])
        self.assertFalse(report["check"])
        self.assertEqual(len(report["images"]), 1)
        item = report["images"][0]
        self.assertEqual(item["file"], "./assets/01-overview.png")
        output = Path(item["path"])
        self.assertTrue(output.is_file())
        with Image.open(output) as rendered:
            self.assertEqual(rendered.size, (1536, 2048))
            self.assertEqual(rendered.format, "PNG")
            self.assertEqual(rendered.convert("RGB").getpixel((0, 0)), DEFAULT_BG)
        roles = {region["role"]: region for region in item["regions"]}
        self.assertLess(roles["quote"]["box"][1], roles["metric_value"]["box"][1])
        self.assertLess(roles["metric_value"]["box"][1], roles["card"]["box"][1])
        self.assertIn("headline", item["fonts"])
        self.assertGreaterEqual(item["fonts"]["headline"], 64)
        self.assertGreaterEqual(item["fonts"]["card_body"], 30)

    def test_two_images_render_expected_formats_and_sizes(self):
        self.picture("./scenes/01.png", (900, 600), (70, 110, 140))
        self.picture("./materials/01-source.jpg", (600, 900), (140, 90, 60))
        report = self.render([
            entry("./assets/01-overview.png", "第一张总览", [quote_block(), metrics_block(), cards_block()]),
            entry(
                "./assets/02-detail.jpg",
                "第二张展开",
                [material_block("./materials/01-source.jpg", caption="原文配图，仅用于本地测试"), text_block()],
                width=1536,
                height=1920,
            ),
        ])
        self.assertEqual([item["file"] for item in report["images"]], ["./assets/01-overview.png", "./assets/02-detail.jpg"])
        first, second = (Path(item["path"]) for item in report["images"])
        with Image.open(first) as rendered:
            self.assertEqual((rendered.size, rendered.format), ((1536, 2048), "PNG"))
        with Image.open(second) as rendered:
            self.assertEqual((rendered.size, rendered.format), ((1536, 1920), "JPEG"))
        self.assertEqual(report["images"][1]["blocks"], ["material", "text"])

    def test_theme_background_and_card_colors_apply(self):
        theme = {
            "background": "#101820",
            "ink": "#F5F1E7",
            "muted": "#9FB0C0",
            "accent": "#E0A030",
            "card": "#1B2A3A",
            "radius": 20,
        }
        report = self.render([entry(
            "./assets/01-overview.png",
            "深色主题检查",
            [quote_block(), cards_block()],
            theme=theme,
        )])
        item = report["images"][0]
        self.assertEqual(item["theme"]["background"], "#101820")
        with Image.open(Path(item["path"])) as rendered:
            rgb = rendered.convert("RGB")
            self.assertEqual(rgb.getpixel((0, 0)), (16, 24, 32))
            card = next(region for region in item["regions"] if region["role"] == "card")["box"]
            self.assertEqual(rgb.getpixel((card[2] - 8, (card[1] + card[3]) // 2)), (27, 42, 58))

    def test_check_reports_layout_and_writes_no_file(self):
        self.picture("./scenes/01.png", (900, 600), (70, 110, 140))
        manifest = self.write_manifest([entry(
            "./assets/01-overview.png",
            "检查模式排版报告",
            [quote_block(origin="示例出处"), metrics_block(), material_block("./materials/missing.png")],
        )])
        # Material file is intentionally absent: the check must fail before any write.
        with self.assertRaises(ValueError):
            RENDER.run(manifest, check=True)
        self.assertFalse((self.task / "assets").exists())

        self.picture("./materials/01.png", (500, 500), (60, 120, 90))
        manifest = self.write_manifest([entry(
            "./assets/01-overview.png",
            "检查模式排版报告",
            [
                quote_block(origin="示例出处"),
                text_block("这段普通段落用于检查正文换行与区域宽度是否正确，内容需要完整显示且不能越过安全边距。"),
                metrics_block(),
                material_block("./materials/01.png", caption="原文素材"),
            ],
        )])
        before = self.files()
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = RENDER.main(["--check", "--manifest", str(manifest)])
        self.assertEqual(code, 0)
        payload = json.loads(buffer.getvalue())
        self.assertTrue(payload["check"])
        self.assertEqual(payload["source"], SOURCE)
        self.assertEqual(self.files(), before)
        self.assertFalse((self.task / "assets").exists())
        item = payload["images"][0]
        self.assertEqual(item["file"], "./assets/01-overview.png")
        self.assertEqual((item["width"], item["height"]), (1536, 2048))
        self.assertEqual(item["blocks"], ["quote", "text", "metrics", "material"])
        self.assertGreaterEqual(item["fonts"]["headline"], 64)
        self.assertIn("footer_source", item["fonts"])
        margin = round(item["width"] * 96 / 1536)
        for region in item["regions"]:
            x0, y0, x1, y1 = region["box"]
            self.assertTrue(0 <= x0 < x1 <= item["width"])
            self.assertTrue(0 <= y0 < y1 <= item["height"])
            self.assertGreaterEqual(x0, margin)
            self.assertLessEqual(x1, item["width"] - margin)
        self.assertTrue(any(region["kind"] == "image" for region in item["regions"]))
        wrapped = [region for region in item["regions"] if region["role"] == "text"][0]
        self.assertGreaterEqual(len(wrapped["lines"]), 2)

        rendered = RENDER.run(manifest)
        rendered_item = rendered["images"][0]
        self.assertEqual(rendered_item["fonts"], item["fonts"])
        self.assertEqual(rendered_item["blocks"], item["blocks"])
        self.assertEqual([(region["role"], region["box"]) for region in rendered_item["regions"]],
                         [(region["role"], region["box"]) for region in item["regions"]])

    def test_overflow_raises_clear_error_without_writing(self):
        manifest = self.write_manifest([entry(
            "./assets/01-overview.png",
            "内容过多时明确失败",
            [
                quote_block(OVERFLOW_QUOTE),
                text_block("文" * 160),
                cards_block([{"heading": "标" * 12, "body": "内" * 80} for _ in range(5)]),
                text_block("字" * 160),
            ],
        )])
        with self.assertRaises(ValueError) as caught:
            RENDER.run(manifest)
        message = str(caught.exception)
        self.assertIn("cannot fit", message)
        self.assertIn("readable font size", message)
        self.assertIn("./assets/01-overview.png", message)
        self.assertIn("blocks:", message)
        self.assertFalse((self.task / "assets").exists())

    def test_outside_paths_are_rejected(self):
        cases = [
            [scene_block("./scenes/../escape.png")],
            [material_block("./materials/../escape.png")],
            [material_block("C:/Windows/Fonts/msyh.ttc")],
            [scene_block("/etc/passwd.png")],
        ]
        for blocks in cases:
            with self.subTest(blocks=blocks):
                manifest = self.write_manifest([entry("./assets/01-overview.png", "路径越界检查", blocks)])
                with self.assertRaises(ValueError):
                    RENDER.run(manifest)
        self.assertFalse((self.task / "assets").exists())
        with self.assertRaises(ValueError):
            RENDER._task_file(self.task, "../outside.png", "scene")
        with self.assertRaises(ValueError):
            RENDER._output_path(self.task, "./assets/../escape.png")
        self.assertEqual(RENDER._output_path(self.task, "./assets/01-overview.png"),
                         (self.task / "assets" / "01-overview.png").resolve())

    def test_symlink_and_junction_files_are_rejected(self):
        outside = Path(self._temp.name) / "outside"
        outside.mkdir()
        secret = outside / "secret.png"
        Image.new("RGB", (200, 200), (10, 20, 30)).save(secret)
        (self.task / "materials").mkdir()
        try:
            os.symlink(secret, self.task / "materials" / "01.png")
        except OSError as error:
            self.skipTest(f"symlinks are not available: {error}")
        manifest = self.write_manifest([entry(
            "./assets/01-overview.png", "符号链接检查", [material_block("./materials/01.png")]
        )])
        with self.assertRaises(ValueError) as caught:
            RENDER.run(manifest)
        self.assertIn("symbolic link", str(caught.exception))
        self.assertFalse((self.task / "assets").exists())

        # A symlinked assets/ directory must not be followed either.
        (self.task / "materials" / "01.png").unlink()
        self.task.joinpath("materials").rmdir()
        self.picture("./scenes/01.png", (400, 300), (70, 110, 140))
        os.symlink(outside, self.task / "assets", target_is_directory=True)
        manifest = self.write_manifest([entry(
            "./assets/01-overview.png", "输出目录符号链接", [quote_block(), scene_block("./scenes/01.png")]
        )])
        with self.assertRaises(ValueError) as caught:
            RENDER.run(manifest)
        self.assertIn("symbolic link", str(caught.exception))
        self.assertFalse((outside / "01-overview.png").exists())

    def test_junction_directories_are_rejected(self):
        outside = Path(self._temp.name) / "outside"
        outside.mkdir()
        Image.new("RGB", (200, 200), (10, 20, 30)).save(outside / "01.png")
        junction = self.task / "materials"
        try:
            completed = subprocess.run(
                ["cmd", "/c", "mklink", "/J", str(junction), str(outside)],
                capture_output=True,
                text=True,
            )
        except OSError as error:
            self.skipTest(f"junctions are not available: {error}")
        if completed.returncode != 0:
            self.skipTest("junction creation requires privileges on this machine.")
        try:
            manifest = self.write_manifest([entry(
                "./assets/01-overview.png", "junction 检查", [material_block("./materials/01.png")]
            )])
            with self.assertRaises(ValueError) as caught:
                RENDER.run(manifest)
            self.assertIn("junction", str(caught.exception))
        finally:
            if getattr(junction, "is_junction", lambda: False)():
                junction.rmdir()

    def test_footer_is_one_source_line_at_the_bottom(self):
        report = self.render([entry(
            "./assets/01-overview.png", "页脚来源检查", [quote_block(), metrics_block()]
        )])
        item = report["images"][0]
        footer = [region for region in item["regions"] if region["role"] == "footer_source"]
        self.assertEqual(len(footer), 1)
        self.assertEqual(footer[0]["lines"], ["来源：" + SOURCE])
        box = footer[0]["box"]
        self.assertGreater(box[1], item["height"] * 0.9)
        self.assertLessEqual(box[3], item["height"])
        with Image.open(Path(item["path"])) as rendered:
            rgb = rendered.convert("RGB")
            band = rgb.crop(tuple(box))
            non_background = sum(1 for pixel in band.getdata() if pixel != DEFAULT_BG)
            self.assertGreater(non_background, 40)
            below = rgb.crop((0, box[3] + 2, item["width"], item["height"]))
            self.assertTrue(all(pixel == DEFAULT_BG for pixel in below.getdata()))
        bottom_text = [
            region for region in item["regions"]
            if region["kind"] == "text" and region["role"] not in ("footer_source",) and region["box"][1] > box[1]
        ]
        self.assertEqual(bottom_text, [])

    def test_scene_and_material_images_are_cover_cropped_in_order(self):
        self.picture("./scenes/01.png", (900, 600), (70, 110, 140))
        self.picture("./materials/01.jpg", (600, 900), (140, 90, 60))
        report = self.render([entry(
            "./assets/01-overview.png",
            "图像块裁切检查",
            [
                quote_block(),
                scene_block("./scenes/01.png", alt="场景插画的说明"),
                material_block("./materials/01.jpg", caption="原文配图的说明"),
            ],
        )])
        item = report["images"][0]
        images = [region for region in item["regions"] if region["kind"] == "image"]
        self.assertEqual([region["role"] for region in images], ["scene", "material"])
        self.assertLess(images[0]["box"][1], images[1]["box"][1])
        for region in images:
            left, top, right, bottom = region["crop"]
            self.assertTrue(0.0 <= left < right <= 1.0 and 0.0 <= top < bottom <= 1.0)
            box_width = region["box"][2] - region["box"][0]
            box_height = region["box"][3] - region["box"][1]
            source_width, source_height = (900, 600) if region["role"] == "scene" else (600, 900)
            cropped_aspect = (right - left) * source_width / ((bottom - top) * source_height)
            self.assertAlmostEqual(cropped_aspect, box_width / box_height, places=2)
        self.assertTrue(any(region["role"] == "scene_caption" for region in item["regions"]))
        self.assertTrue(any(region["role"] == "material_caption" for region in item["regions"]))
        with Image.open(Path(item["path"])) as rendered:
            rgb = rendered.convert("RGB")
            scene_box = images[0]["box"]
            self.assertEqual(rgb.getpixel((scene_box[0] + 1, scene_box[1] + 1)), DEFAULT_BG)
            center = rgb.getpixel(((scene_box[0] + scene_box[2]) // 2, (scene_box[1] + scene_box[3]) // 2))
            self.assertNotEqual(center, DEFAULT_BG)

    def test_missing_glyph_fails_instead_of_drawing_tofu(self):
        self.picture("./materials/01.png", (400, 300), (60, 120, 90))
        manifest = self.write_manifest([entry(
            "./assets/01-overview.png",
            "缺字方块检查",
            [material_block("./materials/01.png", caption="原文配图📷说明")],
        )])
        with self.assertRaises(ValueError) as caught:
            RENDER.run(manifest)
        self.assertIn("no glyph", str(caught.exception))
        self.assertFalse((self.task / "assets").exists())

    def test_missing_font_reports_a_clear_error(self):
        self.picture("./scenes/01.png", (400, 300), (70, 110, 140))
        manifest = self.write_manifest([entry(
            "./assets/01-overview.png", "缺失字体检查", [quote_block(), scene_block("./scenes/01.png")]
        )])
        original = RENDER.FONT_DIR
        empty = Path(self._temp.name) / "no-fonts"
        empty.mkdir()
        RENDER.FONT_DIR = empty
        self.addCleanup(setattr, RENDER, "FONT_DIR", original)
        with self.assertRaises(ValueError) as caught:
            RENDER.run(manifest)
        self.assertIn("Microsoft YaHei font is missing", str(caught.exception))

    def test_legacy_manifest_points_to_single_poster_renderer(self):
        path = self.task / "share.json"
        path.write_text(json.dumps({
            "title": "旧版单图海报",
            "headline": "旧版单图海报",
            "source": SOURCE,
            "caption": CAPTION,
            "poster": "./assets/01-poster.png",
            "editorial": {"layout": "insight", "sections": []},
        }, ensure_ascii=False), encoding="utf-8")
        with self.assertRaises(ValueError) as caught:
            RENDER.run(path)
        message = str(caught.exception)
        self.assertIn("render-share-poster.py", message)
        self.assertFalse((self.task / "assets").exists())

    def test_maximum_legal_field_lengths_render(self):
        self.picture("./materials/01.png", (900, 1600), (60, 120, 90))
        caption = "原文配图说明文字较长时应当在图片下方居中显示并且保持单行或两行以内。"
        report = self.render([entry(
            "./assets/01-max.png",
            "最大标题长度限制的标题最多二十四字",
            [
                quote_block(LONG_QUOTE, origin="二十字以内的出处标注位置"),
                metrics_block([
                    {"value": "12345678", "label": "十二字的中文标签"},
                    {"value": "1.2万亿", "label": "第二项标签"},
                    {"value": "150–160", "label": "第三项标签"},
                    {"value": "42%", "label": "第四项标签"},
                ]),
                material_block("./materials/01.png", caption=caption),
            ],
            kicker="八个字栏目名称",
            subtitle="副标题最多四十个字，用于检查两行排版和行距是否稳定，不重复标题内容。",
        )])
        item = report["images"][0]
        self.assertTrue(Path(item["path"]).is_file())
        self.assertGreaterEqual(item["fonts"]["headline"], 64)
        self.assertGreaterEqual(item["fonts"]["quote"], 48)
        self.assertGreaterEqual(item["fonts"]["metric_value"], 54)
        margin = round(item["width"] * 96 / 1536)
        for region in item["regions"]:
            self.assertGreaterEqual(region["box"][0], margin)
            self.assertLessEqual(region["box"][2], item["width"] - margin)
        quote = next(region for region in item["regions"] if region["role"] == "quote")
        self.assertGreaterEqual(len(quote["lines"]), 2)

    def test_quote_must_match_cached_content(self):
        bad = "这段引语并不会出现在缓存正文里面"
        manifest = self.write_manifest([entry(
            "./assets/01-overview.png", "缓存引语核对", [quote_block(bad)]
        )])
        with self.assertRaises(ValueError) as caught:
            RENDER.run(manifest)
        self.assertIn("verbatim", str(caught.exception))
        self.assertFalse((self.task / "assets").exists())
        (self.task / "input.json").unlink()
        report = RENDER.run(manifest)
        self.assertTrue(Path(report["images"][0]["path"]).is_file())

    def test_cli_error_is_json_and_writes_nothing(self):
        path = self.task / "share.json"
        path.write_text("{not json", encoding="utf-8")
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = RENDER.main(["--manifest", str(path)])
        self.assertEqual(code, 1)
        payload = json.loads(buffer.getvalue())
        self.assertIn("not valid JSON", payload["error"])
        self.assertFalse((self.task / "assets").exists())

    def test_render_output_is_deterministic(self):
        self.picture("./materials/01.png", (600, 400), (60, 120, 90))
        images = [entry(
            "./assets/01-overview.png",
            "确定性渲染检查",
            [quote_block(origin="示例出处"), metrics_block(), material_block("./materials/01.png", caption="原文素材")],
        )]
        first = self.render(images)
        first_bytes = Path(first["images"][0]["path"]).read_bytes()
        second = self.render(images)
        self.assertEqual(Path(second["images"][0]["path"]).read_bytes(), first_bytes)
        self.assertEqual(second["images"][0]["regions"], first["images"][0]["regions"])


if __name__ == "__main__":
    unittest.main()
