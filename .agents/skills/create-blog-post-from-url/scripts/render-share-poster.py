#!/usr/bin/env python3
"""Compose one 1536×2048 HD-2D scene poster with deterministic local text.
Generate the text-free base scene with Azure --skip-post-process; keep it outside assets.
Usage: render-share-poster.py --scene scene.png --manifest TASK/share.json
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit
from PIL import Image, ImageDraw, ImageFont, ImageOps

WIDTH, HEIGHT = 1536, 2048


def local_font(bold=False):
    names = ['msyhbd.ttc', 'msyh.ttc'] if bold else ['msyh.ttc', 'msyhbd.ttc']
    for name in names:
        candidate = Path('C:/Windows/Fonts') / name
        if candidate.is_file():
            return candidate
    raise ValueError('Microsoft YaHei local font not found in C:/Windows/Fonts.')


def wrap_text(draw, text, font, max_width):
    lines, line = [], ''
    for char in text:
        if char in '\r\n':
            raise ValueError('Poster labels must be single-line plain text.')
        if draw.textlength(line + char, font=font) > max_width:
            if not line:
                raise ValueError('A glyph exceeds the text area.')
            lines.append(line)
            line = char
        else:
            line += char
    if line:
        lines.append(line)
    return lines


def fitted(draw, text, font_path, start_size, width, height, max_lines):
    for size in range(start_size, 23, -1):
        font = ImageFont.truetype(str(font_path), size)
        lines = wrap_text(draw, text, font, width)
        step = int(size * 1.45)
        if len(lines) <= max_lines and len(lines) * step <= height:
            return font, lines, step
    raise ValueError('Poster text cannot fit without overflow.')


def render(scene, manifest_path):
    manifest_path = Path(manifest_path).absolute()
    manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    for key, maximum in [('headline',24),('subtitle',40)]:
        value = manifest.get(key)
        if not isinstance(value,str) or not value.strip() or len(value) > maximum or any(c in value for c in '\r\n<>'):
            raise ValueError(f'{key} requires plain text of at most {maximum} characters.')
    if manifest.get('poster') not in ('./assets/01-poster.png','./assets/01-poster.jpg'):
        raise ValueError('Manifest must select ./assets/01-poster.png or .jpg.')
    output = manifest_path.parent / manifest['poster']
    if Path(scene).resolve() == output.resolve():
        raise ValueError('Raw scene and composed poster must use different paths.')
    for item in (manifest_path, Path(scene).absolute(), output):
        for ancestor in (item, *item.parents):
            if ancestor.is_symlink() or (hasattr(ancestor, 'is_junction') and ancestor.is_junction()):
                raise ValueError('Symbolic links and junctions are forbidden.')
    with Image.open(scene) as image:
        image.load()
        if image.width < 1080 or image.height < 1440:
            raise ValueError('Base scene must be at least 1080×1440; use Azure --skip-post-process.')
        canvas = ImageOps.fit(image.convert('RGB'), (WIDTH, HEIGHT), method=Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(canvas, 'RGBA')
    draw.rounded_rectangle((64,72,1472,540),radius=32,fill=(12,20,31,230))
    draw.rounded_rectangle((64,1880,1472,1980),radius=20,fill=(12,20,31,230))
    font, lines, step = fitted(draw,manifest['headline'],local_font(True),100,1280,280,2)
    for index,line in enumerate(lines):
        draw.text((128,112+index*step),line,font=font,fill='white',anchor='lt')
    font, lines, step = fitted(draw,manifest['subtitle'],local_font(),48,1280,135,2)
    for index,line in enumerate(lines):
        draw.text((128,385+index*step),line,font=font,fill=(221,232,242),anchor='lt')
    source = urlsplit(manifest['source'])
    if source.scheme not in ('http','https') or not source.hostname or source.username or source.password:
        raise ValueError('Manifest source must be an HTTP(S) URL without credentials.')
    label = f'来源：{source.hostname} · AI插画'
    font, lines, step = fitted(draw,label,local_font(),36,1280,70,1)
    draw.text((128,1906),lines[0],font=font,fill='white',anchor='lt')
    output.parent.mkdir(parents=True,exist_ok=True)
    canvas.save(output,quality=95)
    return {'poster_path':str(output),'width':WIDTH,'height':HEIGHT}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scene',required=True)
    parser.add_argument('--manifest',required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(render(args.scene,args.manifest),ensure_ascii=True))
    except Exception as error:
        print(json.dumps({'error':str(error)},ensure_ascii=True))
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
