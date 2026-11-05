#!/usr/bin/env python3
"""Render one to three deterministic multi-image RSS share infographics.

Usage:
    python render-share-images.py --manifest TASK/share.json
    python render-share-images.py --check --manifest TASK/share.json

Every `images[]` entry in TASK/share.json becomes one PNG/JPG written to its
declared `./assets/NN-<slug>.png|jpg` path inside TASK. Validation is shared
with the publishing bridge through share_images.validate_images_manifest; the
legacy single-poster format is rejected here and stays on render-share-poster.py.

The renderer is offline and deterministic: Pillow plus the local Microsoft YaHei
fonts only, no network, no randomness, no clock. `--check` validates the
manifest and measures every layout, then prints a JSON report without writing
any image (it does not even create assets/).
"""
import argparse
import json
import math
import re
import sys
from pathlib import Path, PurePosixPath

from PIL import Image, ImageDraw, ImageFont, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parent))
import share_images

BASE_WIDTH = 1536
FONT_DIR = Path("C:/Windows/Fonts")
REGULAR_FONT_FILE = "msyh.ttc"
BOLD_FONT_FILE = "msyhbd.ttc"
FIT_STEPS = 50
MISSING_GLYPH = "\U0010FFFD"

# Font sizes at a 1536 px wide canvas; everything scales with the real width.
KICKER_SIZE = 34
HEADLINE_TARGET, HEADLINE_MIN = 104, 64
SUBTITLE_TARGET, SUBTITLE_MIN = 48, 36
QUOTE_TARGET, QUOTE_MIN = 72, 48
QUOTE_FROM_SIZE = 34
METRICS_VALUE_TARGET, METRICS_VALUE_MIN = 112, 54
METRICS_LABEL_TARGET, METRICS_LABEL_MIN = 34, 30
CARD_HEADING_TARGET, CARD_HEADING_MIN = 46, 36
CARD_BODY_TARGET, CARD_BODY_MIN = 42, 37
TEXT_TARGET, TEXT_MIN = 48, 40
CAPTION_SIZE = 32
FOOTER_TARGET, FOOTER_MIN = 34, 20

CLOSING = "，。、；：！？）》】」』〉”’％‰…·,.;:!?)]}%"
OPENING = "（《【「『〈“‘([{"
TOKEN = re.compile(r"[A-Za-z0-9]+(?:[.,'%\-–—/:_][A-Za-z0-9]+)*|\s+|[^\s]")

_FONTS = {}
_GLYPHS = {}


class FitError(Exception):
    """The current layout cannot be fitted; try a smaller type scale."""


def _rgb(value):
    return tuple(int(value[index:index + 2], 16) for index in (1, 3, 5))


def _mix(base, overlay, amount):
    return tuple(int(round(base[index] * (1.0 - amount) + overlay[index] * amount)) for index in range(3))


def _luminance(color):
    def channel(value):
        value = value / 255.0
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    red, green, blue = (channel(value) for value in color)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def _contrast(first, second):
    high, low = sorted((_luminance(first), _luminance(second)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def _best_contrast(background, candidates):
    best, best_ratio = candidates[0], -1.0
    for color in [*candidates, (255, 255, 255), (17, 17, 17)]:
        ratio = _contrast(color, background)
        if ratio > best_ratio:
            best, best_ratio = color, ratio
    return best


def _load_font(size, bold=False):
    size = max(1, int(size))
    key = (str(FONT_DIR), bool(bold), size)
    cached = _FONTS.get(key)
    if cached is not None:
        return cached
    path = FONT_DIR / (BOLD_FONT_FILE if bold else REGULAR_FONT_FILE)
    if not path.is_file():
        raise ValueError(f"Microsoft YaHei font is missing: {path}. Install the local Microsoft YaHei font before rendering.")
    try:
        loaded = ImageFont.truetype(str(path), size)
    except OSError as error:
        raise ValueError(f"Cannot load Microsoft YaHei font {path}: {error}") from error
    _FONTS[key] = loaded
    return loaded


def _glyph_signature(font, char):
    return (bytes(font.getmask(char)), tuple(font.getbbox(char)), int(round(font.getlength(char))))


def _require_glyphs(font, text, role):
    key = (str(getattr(font, "path", "")), font.size)
    missing_signature = _GLYPHS.get(key)
    if missing_signature is None:
        missing_signature = _glyph_signature(font, MISSING_GLYPH)
        _GLYPHS[key] = missing_signature
    for char in text:
        if char.isspace():
            continue
        if _glyph_signature(font, char) == missing_signature:
            raise ValueError(f"{role}: Microsoft YaHei has no glyph for {char!r} (U+{ord(char):04X}); remove it from the manifest text.")


def _wrap_lines(draw, text, font, width, break_words, role):
    tokens = list(text) if break_words else TOKEN.findall(text)
    lines, line = [], ""
    for token in tokens:
        if draw.textlength(line + token, font=font) <= width:
            line += token
            continue
        if not line:
            if token.isspace():
                continue
            raise ValueError(f"{role}: a single glyph is wider than the text area.")
        if token.isspace():
            lines.append(line.rstrip())
            line = ""
            continue
        carry = ""
        if token[0] in CLOSING and len(line) > 1:
            carry, line = line[-1], line[:-1]
        elif line[-1] in OPENING:
            carry, line = line[-1], line[:-1]
        if line.strip():
            lines.append(line.rstrip())
        line = carry + token
        if draw.textlength(line, font=font) > width:
            raise ValueError(f"{role}: a word cannot fit the text area at a readable size.")
    if line.strip():
        lines.append(line.rstrip())
    if not lines:
        raise ValueError(f"{role}: the text produced no lines.")
    return lines


def _short_last_line(line):
    return len(re.sub(r"[\s" + re.escape(CLOSING + OPENING) + "]", "", line)) <= 4


def _balanced_wrap(draw, text, font, width, lines):
    """Narrow the measure a little so the last line is not a lone fragment."""
    if len(lines) < 2 or not _short_last_line(lines[-1]):
        return lines
    step = max(8, int(round(width * 0.01)))
    narrower = int(width) - step
    floor = width * 0.7
    while narrower >= floor:
        try:
            candidate = _wrap_lines(draw, text, font, narrower, False, "text")
        except ValueError:
            return lines
        if len(candidate) != len(lines):
            return lines
        if not _short_last_line(candidate[-1]):
            return candidate
        narrower -= step
    return lines


def _is_link(path):
    try:
        if path.is_symlink():
            return True
    except OSError:
        return True
    is_junction = getattr(path, "is_junction", None)
    if is_junction is not None:
        try:
            if is_junction():
                return True
        except OSError:
            return True
    return False


def _inside(root, resolved):
    return resolved == root or root in resolved.parents


def _task_file(task_dir, relative, field):
    """Resolve a manifest-relative file and refuse anything outside the task dir."""
    rel = PurePosixPath(relative)
    if rel.is_absolute() or ".." in rel.parts or not rel.parts:
        raise ValueError(f"{field}: path must stay inside the task directory: {relative}")
    root = task_dir.resolve()
    current = task_dir
    for part in rel.parts[:-1]:
        current = current / part
        if _is_link(current):
            raise ValueError(f"{field}: path crosses a symbolic link or junction: {relative}")
    candidate = current / rel.parts[-1]
    if _is_link(candidate):
        raise ValueError(f"{field}: symbolic links and junctions are not allowed: {relative}")
    resolved = candidate.resolve()
    if not _inside(root, resolved):
        raise ValueError(f"{field}: path escapes the task directory: {relative}")
    if not resolved.is_file():
        raise ValueError(f"{field}: file not found inside the task directory: {relative}")
    return resolved


def _output_path(task_dir, relative):
    rel = PurePosixPath(relative)
    if rel.is_absolute() or ".." in rel.parts or len(rel.parts) != 2 or rel.parts[0] != "assets":
        raise ValueError(f"{relative}: output must stay inside ./assets/ of the task directory.")
    if rel.suffix.lower() not in (".png", ".jpg"):
        raise ValueError(f"{relative}: output must be a .png or .jpg file.")
    root = task_dir.resolve()
    current = task_dir
    for part in rel.parts[:-1]:
        current = current / part
        if _is_link(current):
            raise ValueError(f"{relative}: output crosses a symbolic link or junction.")
    target = current / rel.parts[-1]
    if _is_link(target):
        raise ValueError(f"{relative}: refusing to overwrite a symbolic link or junction.")
    resolved = target.resolve()
    if not _inside(root, resolved):
        raise ValueError(f"{relative}: output escapes the task directory.")
    if resolved.exists() and not resolved.is_file():
        raise ValueError(f"{relative}: output path already exists and is not a file.")
    return resolved


def _oriented_size(path, field):
    try:
        with Image.open(path) as opened:
            width, height = opened.size
            try:
                orientation = opened.getexif().get(274, 1)
            except (OSError, ValueError):
                orientation = 1
    except OSError as error:
        raise ValueError(f"{field}: image cannot be opened: {error}") from error
    if orientation in (5, 6, 7, 8):
        width, height = height, width
    if width < 1 or height < 1:
        raise ValueError(f"{field}: image has no pixels.")
    return width, height


def _load_rgb(path, background):
    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened)
        image.load()
        if image.mode in ("RGBA", "LA", "P") or "transparency" in image.info:
            rgba = image.convert("RGBA")
            base = Image.new("RGBA", rgba.size, (*background, 255))
            base.alpha_composite(rgba)
            return base.convert("RGB")
        return image.convert("RGB")


def _rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size[0] - 1, size[1] - 1),
        radius=max(0, min(int(radius), size[0] // 2, size[1] // 2)),
        fill=255,
    )
    return mask


class Layout:
    """Measures, fits and paints one manifest image; pure Pillow, no file writes."""

    def __init__(self, task_dir, image):
        self.task_dir = Path(task_dir)
        self.width = int(image["width"])
        self.height = int(image["height"])
        self.theme = image.get("theme") or dict(share_images.DEFAULT_THEME)
        self.scale = self.width / BASE_WIDTH
        self.margin = max(24, int(round(self.width * 96 / BASE_WIDTH)))
        self.left = self.margin
        self.right = self.width - self.margin
        self.content_w = self.right - self.left
        if self.content_w <= 0:
            raise ValueError(f"{image['file']}: canvas is too narrow for the safe margin.")
        self.draw = ImageDraw.Draw(Image.new("RGB", (1, 1)))
        self.background = _rgb(self.theme["background"])
        self.ink = _rgb(self.theme["ink"])
        self.muted = _rgb(self.theme["muted"])
        self.accent = _rgb(self.theme["accent"])
        self.card = _rgb(self.theme["card"])
        self.accent_dark = _mix(self.accent, self.ink, 0.42)
        self.rule = _mix(self.background, self.muted, 0.4)
        self.card_edge = _mix(self.card, self.ink, 0.14)
        self.accent_ink = _best_contrast(self.accent, [self.ink, self.background])
        self.corner = max(0, int(round(int(self.theme["radius"]) * self.scale)))
        self._wrap_cache = {}
        self._size_cache = {}
        self._file_cache = {}

    # -- sizing helpers -------------------------------------------------
    def px(self, base):
        return max(1, int(round(base * self.scale)))

    def size(self, target, minimum, scale):
        return max(1, int(round((minimum + (target - minimum) * scale) * self.scale)))

    def font(self, size, bold=False):
        return _load_font(size, bold)

    def wrap(self, text, size, width, *, bold=False, break_words=False, role="text"):
        key = (bool(bold), int(size), int(round(width)), bool(break_words), text)
        cached = self._wrap_cache.get(key)
        if cached is not None:
            return list(cached)
        lines = _wrap_lines(self.draw, text, self.font(size, bold), width, break_words, role)
        self._wrap_cache[key] = lines
        return list(lines)

    def balanced(self, text, size, width, bold, fallback):
        try:
            candidate = _balanced_wrap(self.draw, text, self.font(size, bold), width, fallback)
        except ValueError:
            return fallback
        if len(candidate) != len(fallback):
            return fallback
        return list(candidate)

    def fit(self, text, bold, width, target, minimum, max_lines, leading, *, single_first=False, role):
        limits = (1, max_lines) if single_first and max_lines > 1 else (max_lines,)
        for limit in limits:
            for size in range(self.px(target), self.px(minimum) - 1, -1):
                font = self.font(size, bold)  # font errors must propagate, not shrink text
                try:
                    lines = _wrap_lines(self.draw, text, font, width, False, role)
                except ValueError:
                    continue
                step = max(1, int(round(size * leading)))
                if len(lines) <= limit:
                    return lines, step, size
        raise ValueError(f"{role} cannot fit {width} px at a readable size; shorten it.")

    def task_file(self, relative, field):
        cached = self._file_cache.get(relative)
        if cached is not None:
            return cached
        resolved = _task_file(self.task_dir, relative, field)
        self._file_cache[relative] = resolved
        return resolved

    def image_size(self, resolved, field):
        key = str(resolved)
        cached = self._size_cache.get(key)
        if cached is not None:
            return cached
        result = _oriented_size(resolved, field)
        self._size_cache[key] = result
        return result

    def text_region(self, role, text, size, x, y, step, *, bold=False, color=None, anchor="lt", wrap_width=None, balance=True, lines=None):
        return {
            "role": role,
            "kind": "text",
            "x": x,
            "y": y,
            "lines": list(lines) if lines is not None else [text],
            "step": max(1, int(step)),
            "font_size": max(1, int(size)),
            "bold": bool(bold),
            "color": color or self.ink,
            "anchor": anchor,
            "wrap_width": wrap_width if wrap_width is not None else self.content_w,
            "text": text,
            "balance": balance,
        }

    def rect_region(self, role, box, radius, fill, outline=None, width=0):
        return {"role": role, "kind": "rect", "box": box, "radius": max(0, int(radius)), "fill": fill, "outline": outline, "width": int(width)}

    def finish_text(self, region):
        text = region.pop("text")
        if region.pop("balance", True):
            region["lines"] = self.balanced(text, region["font_size"], region["wrap_width"], region["bold"], region["lines"])
        lines = region["lines"]
        font = self.font(region["font_size"], region["bold"])
        _require_glyphs(font, "".join(lines), region["role"])
        width = 0.0
        for line in lines:
            width = max(width, self.draw.textlength(line, font=font))
        step = region["step"]
        x, y, anchor = region["x"], region["y"], region["anchor"]
        text_height = len(lines) * step
        if anchor == "lt":
            box = (x, y, x + width, y + text_height)
        elif anchor == "mt":
            box = (x - width / 2.0, y, x + width / 2.0, y + text_height)
        else:
            box = (x, y - text_height / 2.0, x + width, y + text_height / 2.0)
        region["box"] = tuple(int(round(value)) for value in box)

    # -- header and footer ---------------------------------------------
    def measure_header(self, image):
        regions = []
        y = self.margin
        if "kicker" in image:
            size = self.px(KICKER_SIZE)
            font = self.font(size, bold=True)
            text = image["kicker"]
            pad_x, tab_h = self.px(24), self.px(52)
            tab_w = int(math.ceil(self.draw.textlength(text, font=font))) + 2 * pad_x
            if tab_w > self.content_w:
                raise ValueError("kicker cannot fit the content width.")
            box = (self.left, y, self.left + tab_w, y + tab_h)
            regions.append(self.rect_region("kicker", box, self.px(10), self.accent))
            regions.append(self.text_region("kicker", text, size, self.left + pad_x, y + tab_h // 2, tab_h, bold=True, color=self.accent_ink, anchor="lm", balance=False))
            y = box[3] + self.px(24)
        lines, step, size = self.fit(image["headline"], True, self.content_w, HEADLINE_TARGET, HEADLINE_MIN, 2, 1.24, single_first=True, role="headline")
        regions.append(self.text_region("headline", image["headline"], size, self.left, y, step, bold=True, color=self.ink, lines=lines))
        y += len(lines) * step
        if "subtitle" in image:
            y += self.px(20)
            lines, step, size = self.fit(image["subtitle"], False, self.content_w, SUBTITLE_TARGET, SUBTITLE_MIN, 2, 1.4, single_first=True, role="subtitle")
            regions.append(self.text_region("subtitle", image["subtitle"], size, self.left, y, step, color=self.muted, lines=lines))
            y += len(lines) * step
        y += self.px(32)
        rule_h = self.px(8)
        regions.append(self.rect_region("header_rule", (self.left, y, self.left + self.px(72), y + rule_h), rule_h // 2, self.accent))
        y += rule_h
        for region in regions:
            if region["kind"] == "text":
                self.finish_text(region)
        return regions, y

    def measure_footer(self, source):
        text = f"来源：{source}"
        chosen = None
        for size in range(self.px(FOOTER_TARGET), max(1, self.px(FOOTER_MIN)) - 1, -1):
            font = self.font(size)
            if self.draw.textlength(text, font=font) <= self.content_w:
                chosen = size
                break
        if chosen is None:
            raise ValueError(f"footer: the source line cannot fit one readable line: {text}")
        step = max(1, int(round(chosen * 1.4)))
        footer_top = self.height - self.margin - step
        divider_y = footer_top - self.px(30)
        regions = [
            self.rect_region("footer_rule", (self.left, divider_y, self.right, divider_y + max(1, self.px(2))), 0, self.rule),
            self.text_region("footer_source", text, chosen, self.left, footer_top, step, color=self.muted, balance=False),
        ]
        self.finish_text(regions[1])
        return regions, footer_top

    # -- blocks ---------------------------------------------------------
    def measure_block(self, block, scale):
        kind = block["type"]
        if kind == "quote":
            return self.measure_quote(block, scale)
        if kind == "metrics":
            return self.measure_metrics(block, scale)
        if kind == "cards":
            return self.measure_cards(block, scale)
        if kind == "text":
            return self.measure_text(block, scale)
        return self.measure_image_block(block, scale)

    def measure_quote(self, block, scale):
        size = self.size(QUOTE_TARGET, QUOTE_MIN, scale)
        step = max(1, int(round(size * 1.35)))
        indent = self.px(40)
        width = self.content_w - indent
        lines = self.wrap(block["text"], size, width, role="quote")
        text_height = len(lines) * step
        regions = [
            self.text_region("quote", block["text"], size, self.left + indent, 0, step, color=self.ink, wrap_width=width, lines=lines),
        ]
        height = text_height
        if "from" in block:
            gap = self.px(16)
            from_size = self.px(QUOTE_FROM_SIZE)
            from_step = max(1, int(round(from_size * 1.4)))
            from_text = f"— {block['from']}"
            from_lines = self.wrap(from_text, from_size, width, role="quote from")
            regions.append(self.text_region("quote_from", from_text, from_size, self.left + indent, text_height + gap, from_step, color=self.muted, wrap_width=width, lines=from_lines))
            height += gap + len(from_lines) * from_step
        bar_box = (self.left, self.px(8), self.left + max(2, self.px(8)), height - self.px(8))
        regions.insert(0, self.rect_region("quote_bar", bar_box, max(1, self.px(4)), self.accent))
        return {"kind": "blocks", "height": height, "regions": regions}

    def measure_metrics(self, block, scale):
        items = block["items"]
        count = len(items)
        column_gap = self.px(24)
        column_w = (self.content_w - column_gap * (count - 1)) // count
        if column_w <= 0:
            raise FitError("metrics cannot fit the content width")
        minimum = self.px(METRICS_VALUE_MIN)
        start = self.size(METRICS_VALUE_TARGET, METRICS_VALUE_MIN, scale)
        chosen = None
        for value_size in range(start, minimum - 1, -1):
            value_font = self.font(value_size, bold=True)
            if all(self.draw.textlength(item["value"], font=value_font) <= column_w for item in items):
                chosen = value_size
                break
        if chosen is None:
            raise FitError(f"metrics values cannot fit {count} columns at the minimum readable size")
        value_step = max(1, int(round(chosen * 1.2)))
        label_size = self.size(METRICS_LABEL_TARGET, METRICS_LABEL_MIN, scale)
        label_lines = [self.wrap(item["label"], label_size, column_w, role="metric label") for item in items]
        label_step = max(1, int(round(label_size * 1.4)))
        label_height = max(len(lines) for lines in label_lines) * label_step
        gap = self.px(14)
        height = value_step + gap + label_height
        regions = []
        for index in range(1, count):
            x = self.left + index * (column_w + column_gap) - column_gap // 2
            regions.append(self.rect_region("metric_rule", (x, self.px(10), x + max(1, self.px(2)), height - self.px(10)), 1, self.rule))
        for index, item in enumerate(items):
            center = int(round(self.left + index * (column_w + column_gap) + column_w / 2.0))
            regions.append(self.text_region("metric_value", item["value"], chosen, center, 0, value_step, bold=True, color=self.accent_dark, anchor="mt", wrap_width=column_w, balance=False))
            regions.append(self.text_region("metric_label", item["label"], label_size, center, value_step + gap, label_step, color=self.muted, anchor="mt", wrap_width=column_w, lines=label_lines[index]))
        return {"kind": "blocks", "height": height, "regions": regions}

    def measure_cards(self, block, scale):
        pad = self.px(28)
        inner = self.content_w - 2 * pad
        heading_size = self.size(CARD_HEADING_TARGET, CARD_HEADING_MIN, scale)
        body_size = self.size(CARD_BODY_TARGET, CARD_BODY_MIN, scale)
        heading_step = max(1, int(round(heading_size * 1.28)))
        body_step = max(1, int(round(body_size * 1.55)))
        heading_gap = self.px(10)
        card_gap = self.px(20)
        regions = []
        y = 0
        for item in block["items"]:
            heading_lines = self.wrap(item["heading"], heading_size, inner, role="card heading")
            body_lines = self.wrap(item["body"], body_size, inner, role="card body")
            heading_height = len(heading_lines) * heading_step
            body_height = len(body_lines) * body_step
            card_height = 2 * pad + heading_height + heading_gap + body_height
            regions.append(self.rect_region("card", (self.left, y, self.right, y + card_height), self.corner, self.card, self.card_edge, max(1, self.px(2))))
            regions.append(self.text_region("card_heading", item["heading"], heading_size, self.left + pad, y + pad, heading_step, bold=True, color=self.accent_dark, wrap_width=inner, lines=heading_lines))
            regions.append(self.text_region("card_body", item["body"], body_size, self.left + pad, y + pad + heading_height + heading_gap, body_step, color=self.ink, wrap_width=inner, lines=body_lines))
            y += card_height + card_gap
        return {"kind": "blocks", "height": y - card_gap, "regions": regions}

    def measure_text(self, block, scale):
        size = self.size(TEXT_TARGET, TEXT_MIN, scale)
        step = max(1, int(round(size * 1.55)))
        lines = self.wrap(block["body"], size, self.content_w, role="text")
        region = self.text_region("text", block["body"], size, self.left, 0, step, color=self.ink, lines=lines)
        return {"kind": "blocks", "height": len(lines) * step, "regions": [region]}

    def measure_image_block(self, block, scale):
        kind = block["type"]
        relative = block["path"]
        resolved = self.task_file(relative, kind)
        source_width, source_height = self.image_size(resolved, kind)
        aspect = source_width / source_height
        minimum = self.px(280)
        preferred = int(round(self.content_w / aspect))
        preferred = min(preferred, int(round(self.height * 0.55)))
        preferred = max(preferred, minimum)
        caption_text = block.get("caption") if kind == "material" else block.get("alt")
        caption = None
        caption_height = 0
        if caption_text:
            caption_size = max(1, int(round(CAPTION_SIZE * self.scale)))
            caption_step = max(1, int(round(caption_size * 1.4)))
            caption_lines = self.wrap(caption_text, caption_size, self.content_w, role=f"{kind} caption")
            caption_gap = self.px(16)
            caption_height = caption_gap + len(caption_lines) * caption_step
            caption = {
                "gap": caption_gap,
                "region": self.text_region(
                    f"{kind}_caption", caption_text, caption_size,
                    self.left + self.content_w // 2, 0, caption_step,
                    color=self.muted, anchor="mt", lines=caption_lines,
                ),
            }
        outline = self.accent_dark if kind == "material" else None
        return {
            "kind": "image",
            "height": minimum + caption_height,
            "image_min": minimum,
            "image_pref": preferred,
            "caption_h": caption_height,
            "image": {
                "role": kind,
                "rel_path": relative,
                "path": str(resolved),
                "aspect": aspect,
                "radius": self.corner,
                "outline": outline,
                "outline_width": max(2, self.px(3)) if outline else 0,
            },
            "caption": caption,
        }

    # -- placement ------------------------------------------------------
    @staticmethod
    def crop_fractions(aspect, box_width, box_height):
        ratio = box_width / box_height
        if ratio >= aspect:
            crop_width, crop_height = 1.0, aspect / ratio
        else:
            crop_width, crop_height = ratio / aspect, 1.0
        left = (1.0 - crop_width) / 2.0
        top = (1.0 - crop_height) / 2.0
        return (left, top, left + crop_width, top + crop_height)

    def place_block(self, block, top, height):
        if block["kind"] == "image":
            return self.place_image(block, top, height)
        for region in block["regions"]:
            if region["kind"] == "rect":
                x0, y0, x1, y1 = region["box"]
                region["box"] = (x0, y0 + top, x1, y1 + top)
            else:
                region["y"] = region["y"] + top
                self.finish_text(region)
        return block["regions"]

    def place_image(self, block, top, height):
        image = block["image"]
        caption = block["caption"]
        image_height = height - block["caption_h"]
        box = (self.left, top, self.right, top + image_height)
        crop = self.crop_fractions(image["aspect"], self.content_w, image_height)
        regions = [{
            "role": image["role"],
            "kind": "image",
            "box": box,
            "rel_path": image["rel_path"],
            "path": image["path"],
            "crop": tuple(round(value, 6) for value in crop),
            "radius": image["radius"],
            "outline": image["outline"],
            "outline_width": image["outline_width"],
        }]
        if caption:
            region = dict(caption["region"])
            region["y"] = top + image_height + caption["gap"]
            self.finish_text(region)
            regions.append(region)
        return regions


def build_plan(task_dir, image, source):
    layout = Layout(task_dir, image)
    header_regions, header_bottom = layout.measure_header(image)
    footer_regions, footer_top = layout.measure_footer(source)
    content_top = header_bottom + layout.px(48)
    content_bottom = footer_top - layout.px(30) - layout.px(44)
    available = content_bottom - content_top
    if available < layout.px(160):
        raise ValueError(
            f"{image['file']}: the canvas is too short for the header, footer and content "
            f"({available} px of content height). Use a taller canvas or shorter headings."
        )
    blocks = image["blocks"]
    count = len(blocks)
    gap_min = layout.px(34)
    measured = None
    scale = 0.0
    last_error = None
    for step in range(FIT_STEPS, -1, -1):
        candidate_scale = step / FIT_STEPS
        try:
            candidate = [layout.measure_block(block, candidate_scale) for block in blocks]
        except FitError as error:
            last_error = error
            continue
        needed = sum(item["height"] for item in candidate) + gap_min * (count - 1)
        if needed <= available:
            measured, scale = candidate, candidate_scale
            break
        last_error = FitError(f"needs {needed} px but only {available} px is available")
    if measured is None:
        detail = f" ({last_error})" if last_error is not None else ""
        kinds = ", ".join(block["type"] for block in blocks)
        raise ValueError(
            f"{image['file']}: content cannot fit at the minimum readable font size{detail}. "
            f"Shorten the text or remove a block (blocks: {kinds})."
        )

    needed = sum(item["height"] for item in measured) + gap_min * (count - 1)
    leftover = available - needed
    caps = [
        max(0, item["image_pref"] - item["image_min"]) if item["kind"] == "image" else 0
        for item in measured
    ]
    extras = [0] * count
    total_cap = sum(caps)
    if total_cap > 0 and leftover > 0:
        grow = min(leftover, total_cap)
        extras = [grow * cap // total_cap for cap in caps]
        remainder = grow - sum(extras)
        for index in range(count):
            if remainder <= 0:
                break
            addition = min(caps[index] - extras[index], remainder)
            extras[index] += addition
            remainder -= addition
        leftover -= grow
    if count > 1:
        share = leftover // (count - 1)
        remainder = leftover - share * (count - 1)
        gaps = [gap_min + share + (1 if index < remainder else 0) for index in range(count - 1)]
        top_extra = 0
    else:
        gaps = []
        top_extra = leftover // 2

    regions = list(header_regions)
    cursor = content_top + top_extra
    for index, item in enumerate(measured):
        height = item["height"] + extras[index]
        regions.extend(layout.place_block(item, cursor, height))
        cursor += height
        if index < count - 1:
            cursor += gaps[index]
    regions.extend(footer_regions)

    fonts = {}
    for region in regions:
        if region["kind"] == "text":
            fonts.setdefault(region["role"], region["font_size"])
    return {
        "file": image["file"],
        "width": layout.width,
        "height": layout.height,
        "theme": {key: layout.theme[key] for key in sorted(layout.theme)},
        "scale": round(scale, 2),
        "blocks": [block["type"] for block in blocks],
        "fonts": fonts,
        "regions": regions,
    }


def paint_plan(plan):
    background = _rgb(plan["theme"]["background"])
    card = _rgb(plan["theme"]["card"])
    canvas = Image.new("RGB", (plan["width"], plan["height"]), background)
    draw = ImageDraw.Draw(canvas, "RGBA")
    for region in plan["regions"]:
        kind = region["kind"]
        if kind == "rect":
            box = tuple(int(value) for value in region["box"])
            radius = int(region["radius"])
            fill, outline, width = region["fill"], region["outline"], int(region["width"])
            if fill is not None and outline is not None:
                draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=max(1, width))
            elif fill is not None:
                draw.rounded_rectangle(box, radius=radius, fill=fill)
            elif outline is not None:
                draw.rounded_rectangle(box, radius=radius, outline=outline, width=max(1, width))
        elif kind == "text":
            font = _load_font(region["font_size"], region["bold"])
            x = int(round(region["x"]))
            step = int(region["step"])
            for index, line in enumerate(region["lines"]):
                draw.text(
                    (x, int(round(region["y"] + index * step))),
                    line,
                    font=font,
                    fill=tuple(region["color"]),
                    anchor=region["anchor"],
                )
        else:
            _paint_image(canvas, draw, region, card)
    return canvas


def _paint_image(canvas, draw, region, background):
    try:
        source = _load_rgb(region["path"], background)
    except (OSError, ValueError) as error:
        raise ValueError(f"{region['rel_path']}: image cannot be read: {error}") from error
    x0, y0, x1, y1 = (int(value) for value in region["box"])
    width, height = max(1, x1 - x0), max(1, y1 - y0)
    left, top, right, bottom = region["crop"]
    crop_box = (left * source.width, top * source.height, right * source.width, bottom * source.height)
    fitted = source.resize((width, height), resample=Image.Resampling.LANCZOS, box=crop_box)
    radius = int(region["radius"])
    canvas.paste(fitted, (x0, y0), _rounded_mask((width, height), radius))
    if region["outline"] is not None:
        draw.rounded_rectangle(
            (x0, y0, x1 - 1, y1 - 1),
            radius=max(0, min(radius, width // 2, height // 2)),
            outline=tuple(region["outline"]),
            width=max(1, int(region["outline_width"])),
        )


def _save_image(canvas, path):
    try:
        if path.suffix.lower() == ".jpg":
            canvas.save(path, format="JPEG", quality=95, subsampling=0)
        elif path.suffix.lower() == ".png":
            canvas.save(path, format="PNG")
        else:
            raise ValueError(f"Unsupported output extension: {path.suffix}")
    except OSError as error:
        raise ValueError(f"Cannot write {path}: {error}") from error


def _load_manifest(manifest_path):
    if not manifest_path.is_file():
        raise ValueError(f"share.json not found: {manifest_path}")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"share.json is not valid JSON: {error}") from error
    if not isinstance(manifest, dict):
        raise ValueError("share.json must be an object.")
    if not share_images.is_images_manifest(manifest):
        raise ValueError(
            "share.json has no images array. The legacy single-poster format "
            "(poster + editorial or key_points) is rendered by render-share-poster.py, "
            "not by render-share-images.py."
        )
    return manifest


def _cached_content(task_dir):
    input_path = task_dir / "input.json"
    if not input_path.is_file():
        return None
    try:
        task_input = json.loads(input_path.read_text(encoding="utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"input.json is not valid JSON: {error}") from error
    if isinstance(task_input, dict) and isinstance(task_input.get("cached_content"), str):
        return task_input["cached_content"]
    return None


def _image_report(plan):
    regions = []
    for region in plan["regions"]:
        entry = {"role": region["role"], "kind": region["kind"], "box": [int(value) for value in region["box"]]}
        if region["kind"] == "text":
            entry["font_size"] = int(region["font_size"])
            entry["lines"] = list(region["lines"])
        elif region["kind"] == "image":
            entry["path"] = region["rel_path"]
            entry["crop"] = [round(float(value), 6) for value in region["crop"]]
        regions.append(entry)
    return {
        "file": plan["file"],
        "width": plan["width"],
        "height": plan["height"],
        "theme": plan["theme"],
        "scale": plan["scale"],
        "blocks": plan["blocks"],
        "fonts": plan["fonts"],
        "regions": regions,
    }


def run(manifest_path, *, check=False):
    manifest_path = Path(manifest_path)
    task_dir = manifest_path.parent
    manifest = _load_manifest(manifest_path)
    normalized = share_images.validate_images_manifest(manifest, source=None, cached_content=_cached_content(task_dir))
    plans = [build_plan(task_dir, image, normalized["source"]) for image in normalized["images"]]
    if check:
        return {
            "check": True,
            "task_dir": str(task_dir.resolve()),
            "source": normalized["source"],
            "images": [_image_report(plan) for plan in plans],
        }
    outputs = [_output_path(task_dir, image["file"]) for image in normalized["images"]]
    assets = task_dir / "assets"
    if not assets.exists():
        assets.mkdir()
    reports = []
    for plan, output in zip(plans, outputs):
        _save_image(paint_plan(plan), output)
        report = _image_report(plan)
        report["path"] = str(output)
        reports.append(report)
    return {"check": False, "source": normalized["source"], "images": reports}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Render one to three deterministic share infographics from share.json images.")
    parser.add_argument("--manifest", required=True, help="Path to TASK/share.json.")
    parser.add_argument("--check", action="store_true", help="Validate and measure every layout; write no image files.")
    args = parser.parse_args(argv)
    try:
        report = run(args.manifest, check=args.check)
    except Exception as error:  # JSON error contract shared with the other helper scripts.
        print(json.dumps({"error": str(error)}, ensure_ascii=True))
        return 1
    print(json.dumps(report, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
