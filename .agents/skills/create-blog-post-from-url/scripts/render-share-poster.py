#!/usr/bin/env python3
"""Compose one 1536×2048 HD-2D scene poster with deterministic local text.
Generate the text-free base scene with Azure --skip-post-process; keep it outside assets.
Usage: render-share-poster.py --scene scene.png --manifest TASK/share.json [--focal 0.625]
       render-share-poster.py --check --manifest TASK/share.json
--check fits the editorial text against a placeholder scene without writing the poster;
--focal moves the band crop center (0–1) when a generated scene puts its subject off-center.
"""
import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit
from PIL import Image, ImageDraw, ImageFont, ImageOps
sys.path.insert(0, str(Path(__file__).resolve().parent))
from share_editorial import validate_editorial
from editorial_poster import compose_editorial

WIDTH, HEIGHT = 1536, 2048


def local_font(bold=False):
    names = ['msyhbd.ttc', 'msyh.ttc'] if bold else ['msyh.ttc', 'msyhbd.ttc']
    for name in names:
        candidate = Path('C:/Windows/Fonts') / name
        if candidate.is_file():
            return candidate
    raise ValueError('Microsoft YaHei local font not found in C:/Windows/Fonts.')


def wrap_text(draw, text, font, max_width, cjk=False):
    lines, line = [], ''
    for char in text:
        if char in '\r\n':
            raise ValueError('Poster labels must be single-line plain text.')
        if draw.textlength(line + char, font=font) > max_width:
            if not line:
                raise ValueError('A glyph exceeds the text area.')
            if cjk and len(line) > 1 and (char in '，。、；：！？）》】」』％…' or line[-1] in '（《【「『'):
                lines.append(line[:-1])
                line = line[-1] + char
            else:
                lines.append(line)
                line = char
        else:
            line += char
    if line:
        lines.append(line)
    return lines


def fitted(draw, text, font_path, start_size, width, height, max_lines, min_size=24):
    for size in range(start_size, min_size - 1, -1):
        font = ImageFont.truetype(str(font_path), size)
        lines = wrap_text(draw, text, font, width)
        step = int(size * 1.45)
        if len(lines) <= max_lines and len(lines) * step <= height:
            return font, lines, step
    raise ValueError('Poster text cannot fit without overflow.')


def layout_headline(draw, text, width=1280, height=280):
    """Prefer one readable line; preserve complete Latin words in two-line fallback."""
    font_path = str(local_font(True))
    for size in range(100, 71, -1):
        font = ImageFont.truetype(font_path, size)
        if draw.textlength(text, font=font) <= width:
            return font, [text], int(size * 1.45)
    tokens = re.findall(r"[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*|\s+|[^\s]", text)
    for size in range(100, 23, -1):
        font = ImageFont.truetype(font_path, size)
        lines, line = [], ''
        fits = True
        for token in tokens:
            if draw.textlength(token, font=font) > width:
                fits = False
                break
            if draw.textlength(line + token, font=font) > width:
                if line.strip():
                    lines.append(line.rstrip())
                line = token.lstrip()
            else:
                line += token
        if line.strip():
            lines.append(line.rstrip())
        step = int(size * 1.45)
        if fits and 1 <= len(lines) <= 2 and len(lines) * step <= height:
            return font, lines, step
    raise ValueError('Headline cannot fit without splitting a Latin word or overflowing.')


def validate_points(points, required=False, present=False):
    if not required and not present:
        return []
    if not isinstance(points, list) or not 2 <= len(points) <= 3:
        raise ValueError('Content posters require two or three key_points.')
    for point in points:
        if not isinstance(point, str) or point != point.strip() or not 12 <= len(point) <= 50 or not re.search(r'[\u3400-\u9fff\U00020000-\U000323af]', point) or re.search(r'[\x00-\x1f\x7f<>`]|\*\*|!\[|\]\(', point):
            raise ValueError('key_points must be Chinese plain text of 12–50 codepoints.')
    return points


def layout_points(draw, points, width=1160, height=500):
    """Fit a shared 42–48 px font; never truncate or shrink into tiny text."""
    for size in range(48, 41, -1):
        font = ImageFont.truetype(str(local_font()), size)
        wrapped = [wrap_text(draw, point, font, width, cjk=True) for point in points]
        step = int(size * 1.45)
        total = sum(len(lines) * step for lines in wrapped) + 28 * (len(points) - 1)
        if all(len(lines) <= 2 for lines in wrapped) and total <= height:
            return font, wrapped, step
    raise ValueError('Content descriptions cannot fit at a readable font size without overflow.')


def render(scene, manifest_path, *, focal=0.625, check=False):
    manifest_path = Path(manifest_path).absolute()
    manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    fields = {'title', 'caption', 'source', 'headline', 'subtitle', 'poster'}
    if not isinstance(manifest, dict) or not fields.issubset(manifest) or set(manifest) - fields - {'key_points', 'editorial'} or any(not isinstance(manifest[key], str) or not manifest[key].strip() for key in fields):
        raise ValueError('Share manifest contains missing, invalid or unknown fields.')
    input_path = manifest_path.parent / 'input.json'
    task_input = {}
    if input_path.exists() or input_path.is_symlink():
        for item in (input_path, *input_path.parents):
            if item.is_symlink() or (hasattr(item, 'is_junction') and item.is_junction()):
                raise ValueError('Symbolic links and junctions are forbidden.')
        task_input = json.loads(input_path.read_text(encoding='utf-8-sig'))
        if 'poster_layout' in task_input and (task_input.get('mode') != 'rss-share' or task_input['poster_layout'] not in ('content', 'editorial')):
            raise ValueError('poster_layout is only supported as content or editorial in rss-share mode.')
    points = validate_points(manifest.get('key_points'), task_input.get('poster_layout') == 'content', 'key_points' in manifest)
    editorial = validate_editorial(manifest.get('editorial'), required=task_input.get('poster_layout') == 'editorial', present='editorial' in manifest)
    if check and not editorial:
        raise ValueError('Check mode requires an editorial manifest; content posters are validated by validate-share.mjs.')
    for key, maximum in [('headline',24),('subtitle',40)]:
        value = manifest.get(key)
        if not isinstance(value,str) or not value.strip() or len(value) > maximum or any(c in value for c in '\r\n<>'):
            raise ValueError(f'{key} requires plain text of at most {maximum} characters.')
    if manifest.get('poster') not in ('./assets/01-poster.png','./assets/01-poster.jpg'):
        raise ValueError('Manifest must select ./assets/01-poster.png or .jpg.')
    output = manifest_path.parent / manifest['poster']
    if check:
        scene_image = Image.new('RGB', (WIDTH, HEIGHT), (245, 241, 231))
    else:
        if Path(scene).resolve() == output.resolve():
            raise ValueError('Raw scene and composed poster must use different paths.')
        for item in (manifest_path, Path(scene).absolute(), output):
            for ancestor in (item, *item.parents):
                if ancestor.is_symlink() or (hasattr(ancestor, 'is_junction') and ancestor.is_junction()):
                    raise ValueError('Symbolic links and junctions are forbidden.')
        with Image.open(scene) as opened:
            opened.load()
            if opened.width < 1080 or opened.height < 1440:
                raise ValueError('Base scene must be at least 1080×1440; use Azure --skip-post-process.')
            scene_image = opened.convert('RGB')
    if editorial:
        canvas, metadata = compose_editorial(scene_image, manifest, local_font(), local_font(True), focal=(0.5, focal))
        if check:
            return {'check':True,'poster_path':None,'width':WIDTH,'height':HEIGHT,'focal':focal,'editorial':metadata}
        output.parent.mkdir(parents=True,exist_ok=True)
        canvas.save(output,quality=95)
        return {'poster_path':str(output),'width':WIDTH,'height':HEIGHT,'editorial':metadata}
    canvas = ImageOps.fit(scene_image, (WIDTH, HEIGHT), method=Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(canvas, 'RGBA')
    draw.rounded_rectangle((64,72,1472,540),radius=32,fill=(12,20,31,230))
    draw.rounded_rectangle((64,1880,1472,1980),radius=20,fill=(12,20,31,230))
    if points:
        font, lines, step = layout_headline(draw, manifest['headline'])
    else:
        font, lines, step = fitted(draw,manifest['headline'],local_font(True),100,1280,280,2)
    for index,line in enumerate(lines):
        draw.text((128,112+index*step),line,font=font,fill='white',anchor='lt')
    font, lines, step = fitted(draw,manifest['subtitle'],local_font(),48,1280,135,2)
    for index,line in enumerate(lines):
        draw.text((128,385+index*step),line,font=font,fill=(221,232,242),anchor='lt')
    if points:
        draw.rounded_rectangle((64,1190,1472,1848),radius=32,fill=(12,20,31,232))
        label_font = ImageFont.truetype(str(local_font(True)), 42)
        draw.text((128,1220),'主要内容',font=label_font,fill=(153,213,255),anchor='lt')
        point_font, wrapped, point_step = layout_points(draw, points)
        cursor = 1304
        for index, lines in enumerate(wrapped):
            draw.ellipse((124,cursor+2,184,cursor+62),fill=(49,95,126,255))
            draw.text((154,cursor+32),str(index+1),font=label_font,fill='white',anchor='mm')
            for line_index, line in enumerate(lines):
                draw.text((216,cursor+line_index*point_step),line,font=point_font,fill=(240,246,252),anchor='lt')
            cursor += len(lines)*point_step + 28
        if cursor - 28 > 1810:
            raise ValueError('Content panel overflow.')
    source = urlsplit(manifest['source'])
    if source.scheme not in ('http','https') or not source.hostname or source.username or source.password:
        raise ValueError('Manifest source must be an HTTP(S) URL without credentials.')
    label = f'来源：{source.hostname} · AI插画'
    font, lines, step = fitted(draw,label,local_font(),36,1280,70,1)
    draw.text((128,1906),lines[0],font=font,fill='white',anchor='lt')
    output.parent.mkdir(parents=True,exist_ok=True)
    canvas.save(output,quality=95)
    return {'poster_path':str(output),'width':WIDTH,'height':HEIGHT}


def focal_ratio(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError('focal must be a number between 0 and 1.')
    if not 0 < number < 1:
        raise argparse.ArgumentTypeError('focal must be a number between 0 and 1.')
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scene',help='Text-free scene generated by Azure; omitted only with --check.')
    parser.add_argument('--manifest',required=True)
    parser.add_argument('--focal',type=focal_ratio,default=0.625,help='Vertical crop center between 0 and 1; default 0.625.')
    parser.add_argument('--check',action='store_true',help='Fit the editorial text only; do not write a poster.')
    args = parser.parse_args()
    if not args.check and not args.scene:
        print(json.dumps({'error':'--scene is required unless --check is used.'},ensure_ascii=True))
        return 1
    try:
        print(json.dumps(render(args.scene,args.manifest,focal=args.focal,check=args.check),ensure_ascii=True))
    except Exception as error:
        print(json.dumps({'error':str(error)},ensure_ascii=True))
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
