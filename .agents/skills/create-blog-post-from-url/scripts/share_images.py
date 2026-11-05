"""Strict contract for the multi-image RSS share manifest (share.json `images`).

Shared by the offline renderer and the private publishing bridge, so both sides
accept exactly the same manifests. Legacy single-poster manifests (`poster` +
`editorial` or `key_points`) are validated by share_editorial.py and
validate-share.mjs; this module never accepts them.
"""
import re
from urllib.parse import urlsplit

DEFAULT_THEME = {
    "background": "#F5F1E7",
    "ink": "#14283D",
    "muted": "#536779",
    "accent": "#D39A32",
    "card": "#FCFAF4",
    "radius": 18,
}
DEFAULT_WIDTH, DEFAULT_HEIGHT = 1536, 2048
MIN_SIDE, MAX_WIDTH, MAX_HEIGHT = 1080, 2048, 2560
MAX_IMAGES = 3
TOP_FIELDS = ("title", "source", "caption", "images")
LEGACY_FIELDS = ("poster", "editorial", "key_points")
BLOCK_TYPES = ("quote", "metrics", "cards", "text", "scene", "material")
THEME_COLORS = ("background", "ink", "muted", "accent", "card")
ASSET_PATH = re.compile(r"^\./assets/(\d{2})-([a-z0-9][a-z0-9-]{0,23})\.(png|jpg)$")
SCENE_PATH = re.compile(r"^\./scenes/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(?:png|jpg|jpeg)$")
MATERIAL_PATH = re.compile(r"^\./materials/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(?:png|jpg|jpeg)$")
COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")
HAN = re.compile(r"[\u3400-\u9fff\U00020000-\U000323af]")
CONTROL = re.compile(r"[\x00-\x1f\x7f<>`]|\*\*|!\[|\]\(")


def is_images_manifest(manifest):
    return isinstance(manifest, dict) and "images" in manifest


def plain(value, minimum, maximum, *, chinese=False, field=None):
    """Single-line plain text of an exact codepoint range."""
    name = field or "text"
    if not isinstance(value, str) or value != value.strip():
        raise ValueError(f"{name} must be a trimmed string.")
    if not minimum <= len(value) <= maximum:
        raise ValueError(f"{name} requires {minimum}–{maximum} plain-text codepoints.")
    if CONTROL.search(value):
        raise ValueError(f"{name} must be plain text without markup or control characters.")
    if chinese and not HAN.search(value):
        raise ValueError(f"{name} must contain Chinese.")
    return value


def exact_object(value, required, optional=(), field="object"):
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object.")
    missing = [key for key in required if key not in value]
    unknown = [key for key in value if key not in required and key not in optional]
    if missing or unknown:
        raise ValueError(f"{field} has missing or unknown fields.")
    return value


def normalize_prose(text):
    """Collapse whitespace so verbatim quotes match wrapped cached content."""
    return re.sub(r"[\s\u3000]+", "", text)


def quote_missing_segments(text, cached_content):
    """Return quote segments that do not appear verbatim in the cached article."""
    if not isinstance(cached_content, str) or not cached_content.strip():
        return []
    haystack = normalize_prose(cached_content)
    segments = [part for part in re.split(r"…+|\.{3,}|⋯+", text) if part]
    return [part for part in segments if len(normalize_prose(part)) >= 4 and normalize_prose(part) not in haystack]


def _theme(value):
    if value is None:
        return None
    exact_object(value, (), tuple(THEME_COLORS) + ("radius",), "theme")
    merged = dict(DEFAULT_THEME)
    for key in THEME_COLORS:
        if key in value:
            if not isinstance(value[key], str) or not COLOR.match(value[key]):
                raise ValueError("Theme colors must be #RRGGBB strings.")
            merged[key] = value[key].upper()
    if "radius" in value:
        radius = value["radius"]
        if not isinstance(radius, int) or isinstance(radius, bool) or not 0 <= radius <= 48:
            raise ValueError("Theme radius must be an integer between 0 and 48.")
        merged["radius"] = radius
    return merged


def _items(block, field, minimum, maximum, fields, unknown=()):
    items = block.get(field)
    if not isinstance(items, list) or not minimum <= len(items) <= maximum:
        raise ValueError(f"{block['type']} requires {minimum}–{maximum} items.")
    normalized = []
    for item in items:
        exact_object(item, fields, unknown, f"{block['type']} item")
        normalized.append({key: item[key] for key in fields})
    return normalized


def _block(block, cached_content):
    if not isinstance(block, dict) or block.get("type") not in BLOCK_TYPES:
        raise ValueError("Each block requires a supported type.")
    kind = block["type"]
    if kind == "quote":
        exact_object(block, ("type", "text"), ("from",), "quote")
        text = plain(block["text"], 8, 120, field="quote text")
        if "from" in block:
            plain(block["from"], 1, 20, field="quote from")
        missing = quote_missing_segments(text, cached_content)
        if missing:
            raise ValueError("Quote text must appear verbatim in the cached article; use text blocks for paraphrase.")
        return {"type": kind, "text": text, **({"from": block["from"].strip()} if "from" in block else {})}
    if kind == "metrics":
        exact_object(block, ("type", "items"), (), "metrics")
        items = _items(block, "items", 1, 4, ("value", "label"))
        for item in items:
            plain(item["value"], 1, 8, field="metric value")
            if not re.search(r"\d", item["value"]):
                raise ValueError("Each metric value must contain a digit.")
            plain(item["label"], 2, 12, chinese=True, field="metric label")
        return {"type": kind, "items": items}
    if kind == "cards":
        exact_object(block, ("type", "items"), (), "cards")
        items = _items(block, "items", 1, 5, ("heading", "body"))
        for item in items:
            plain(item["heading"], 1, 12, chinese=True, field="card heading")
            plain(item["body"], 12, 80, chinese=True, field="card body")
        return {"type": kind, "items": items}
    if kind == "text":
        exact_object(block, ("type", "body"), (), "text")
        return {"type": kind, "body": plain(block["body"], 12, 160, chinese=True, field="text body")}
    if kind == "scene":
        exact_object(block, ("type", "path"), ("alt",), "scene")
        path = block["path"]
        if not isinstance(path, str) or not SCENE_PATH.match(path):
            raise ValueError("Scene path must be ./scenes/<name>.png, .jpg or .jpeg.")
        result = {"type": kind, "path": path}
        if "alt" in block:
            result["alt"] = plain(block["alt"], 1, 40, field="scene alt")
        return result
    exact_object(block, ("type", "path"), ("caption",), "material")
    path = block["path"]
    if not isinstance(path, str) or not MATERIAL_PATH.match(path):
        raise ValueError("Material path must be ./materials/<name>.png, .jpg or .jpeg.")
    result = {"type": kind, "path": path}
    if "caption" in block:
        result["caption"] = plain(block["caption"], 1, 40, field="material caption")
    return result


def _image(entry, index, cached_content):
    exact_object(entry, ("file", "headline", "blocks"), ("kicker", "subtitle", "theme", "width", "height"), "image")
    match = ASSET_PATH.match(entry["file"]) if isinstance(entry["file"], str) else None
    if not match or int(match.group(1)) != index + 1:
        raise ValueError("Image file must be ./assets/NN-<slug>.png or .jpg with NN matching its order.")
    headline = plain(entry["headline"], 1, 24, field="headline")
    image = {"file": entry["file"], "headline": headline}
    if "kicker" in entry:
        image["kicker"] = plain(entry["kicker"], 2, 8, chinese=True, field="kicker")
    if "subtitle" in entry:
        image["subtitle"] = plain(entry["subtitle"], 1, 40, field="subtitle")
    blocks = entry["blocks"]
    if not isinstance(blocks, list) or not 1 <= len(blocks) <= 6:
        raise ValueError("Each image requires one to six blocks.")
    rendered = [_block(block, cached_content) for block in blocks]
    kinds = [block["type"] for block in rendered]
    if not ({"quote", "material"} & set(kinds)):
        raise ValueError("Each image needs at least one quote or material block from the source article.")
    if kinds.count("scene") > 1 or kinds.count("material") > 2:
        raise ValueError("Each image accepts at most one scene and two material blocks.")
    image["blocks"] = rendered
    theme = _theme(entry.get("theme"))
    if theme is not None:
        image["theme"] = theme
    width = entry.get("width", DEFAULT_WIDTH)
    height = entry.get("height", DEFAULT_HEIGHT)
    for value, maximum, name in ((width, MAX_WIDTH, "width"), (height, MAX_HEIGHT, "height")):
        if not isinstance(value, int) or isinstance(value, bool) or not MIN_SIDE <= value <= maximum:
            raise ValueError(f"Image {name} must be an integer between {MIN_SIDE} and {maximum}.")
    image["width"], image["height"] = width, height
    return image


def validate_caption(caption, source):
    suffix = "来源：" + source
    if not isinstance(caption, str) or not caption.endswith("\n" + suffix):
        raise ValueError("Caption must end with a separate 来源：source URL line.")
    body = caption[: -len(suffix)].strip()
    count = len(re.sub(r"\s", "", body))
    if not 100 <= count <= 200 or not HAN.search(body) or re.search(r"<[^>]*>|!\[[^\]]*\]\(", caption):
        raise ValueError("Caption requires 100–200 characters of Chinese plain text, plus its source line.")
    return count


def validate_source(source):
    if not isinstance(source, str):
        raise ValueError("Source must be a string.")
    parsed = urlsplit(source)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Source must be an HTTP(S) URL without credentials.")
    return source


def validate_images_manifest(manifest, *, source=None, cached_content=None):
    """Validate and normalize a multi-image share manifest. Raises ValueError."""
    if not isinstance(manifest, dict):
        raise ValueError("share.json must be an object.")
    unknown = [key for key in manifest if key not in TOP_FIELDS]
    if unknown:
        raise ValueError("Multi-image share manifests accept only title, source, caption and images.")
    missing = [key for key in TOP_FIELDS if key not in manifest]
    if missing:
        raise ValueError("Multi-image share manifests require title, source, caption and images.")
    title = plain(manifest["title"], 1, 32, field="title")
    source_value = validate_source(manifest["source"])
    if source is not None and source_value != source:
        raise ValueError("source must exactly match the normalized task source URL.")
    validate_caption(manifest["caption"], source_value)
    images = manifest["images"]
    if not isinstance(images, list) or not 1 <= len(images) <= MAX_IMAGES:
        raise ValueError("images requires one to three entries.")
    normalized = [_image(entry, index, cached_content) for index, entry in enumerate(images)]
    files = [image["file"] for image in normalized]
    if len(set(files)) != len(files):
        raise ValueError("Image files must be unique.")
    return {
        "title": title,
        "source": source_value,
        "caption": manifest["caption"],
        "images": normalized,
    }


def image_file_names(normalized):
    return [image["file"] for image in normalized]
