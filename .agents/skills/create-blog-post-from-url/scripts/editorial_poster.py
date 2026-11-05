"""Offline editorial poster composition. No text is painted over a busy scene."""
import re
from urllib.parse import urlsplit
from PIL import Image, ImageDraw, ImageFont
from share_editorial import validate_editorial

WIDTH, HEIGHT = 1536, 2048
IVORY, NAVY, MUTED, AMBER, RULE = '#F5F1E7', '#14283D', '#536779', '#D39A32', '#D7D9D8'
CLOSING = '，。、；：！？）》】」』％…'
OPENING = '（《【「『'


def wrap_editorial(draw, text, font, width, break_words=False):
    tokens = list(text) if break_words else re.findall(r"[A-Za-z0-9]+(?:[.,'’%\-][A-Za-z0-9]+)*|\s+|[^\s]", text)
    lines, line = [], ''
    for token in tokens:
        if draw.textlength(token, font=font) > width:
            raise ValueError('A word cannot fit the editorial text area at a readable size.')
        if draw.textlength(line + token, font=font) > width:
            carry = ''
            if line and token[0] in CLOSING:
                trailing = re.search(r'[A-Za-z0-9]+$|.$', line)
                carry = trailing.group(0)
                line = line[:-len(carry)]
            elif line and line[-1] in OPENING:
                carry, line = line[-1], line[:-1]
            if line.strip():
                lines.append(line.rstrip())
            line = carry + token.lstrip()
            if draw.textlength(line, font=font) > width:
                raise ValueError('Punctuation cannot fit the editorial text area.')
        else:
            line += token
    if line.strip():
        lines.append(line.rstrip())
    return lines


def fit_text(draw, text, font_path, width, height, *, target, minimum, max_lines, leading=1.25, single_first=False, break_words=False):
    searches = [1, max_lines] if single_first and max_lines > 1 else [max_lines]
    for line_limit in searches:
        for size in range(target, minimum - 1, -1):
            font = ImageFont.truetype(str(font_path), size)
            try:
                lines = wrap_editorial(draw, text, font, width, break_words=break_words)
            except ValueError:
                continue
            step = int(size * leading)
            if 1 <= len(lines) <= line_limit and len(lines) * step <= height:
                return font, lines, step
    raise ValueError('Editorial text would overflow at its minimum readable font size.')


def scene_crop(scene, box, focal=(0.5, 0.625)):
    """Use a true aspect-preserving crop centered near the scene's lower middle."""
    left, top, right, bottom = box
    width, height = right-left, bottom-top
    ratio = width / height
    crop_width = min(float(scene.width), scene.height * ratio)
    crop_height = crop_width / ratio
    x = max(0.0, min(scene.width-crop_width, scene.width*focal[0]-crop_width/2))
    y = max(0.0, min(scene.height-crop_height, scene.height*focal[1]-crop_height/2))
    bounds = (x, y, x+crop_width, y+crop_height)
    image = scene.resize((width,height), resample=Image.Resampling.LANCZOS, box=bounds)
    normalized = [round(bounds[0]/scene.width,6),round(bounds[1]/scene.height,6),round(bounds[2]/scene.width,6),round(bounds[3]/scene.height,6)]
    return image, normalized


def compose_editorial(scene, manifest, regular_font, bold_font):
    editorial = validate_editorial(manifest.get('editorial'), required=True, present=True)
    layout = editorial['layout']
    canvas = Image.new('RGB',(WIDTH,HEIGHT),IVORY)
    draw = ImageDraw.Draw(canvas)
    regions = []

    def paint(role,text,box,*,target=48,minimum=42,max_lines=2,bold=False,color=NAVY,single_first=False,leading=1.25,break_words=False):
        x,y,right,bottom=box
        try:
            font,lines,step=fit_text(draw,text,bold_font if bold else regular_font,right-x,bottom-y,target=target,minimum=minimum,max_lines=max_lines,leading=leading,single_first=single_first,break_words=break_words)
        except ValueError as error:
            raise ValueError(f'{role}: {error}') from error
        for index,line in enumerate(lines):
            draw.text((x,y+index*step),line,font=font,fill=color,anchor='lt')
        regions.append({'role':role,'box':list(box),'font_size':font.size,'lines':lines,'line_step':step})
        return font.size,len(lines)*step

    # A small amber spine grounds the masthead without overlaying the illustration.
    draw.rectangle((96,64,168,74),fill=AMBER)
    headline_size,headline_height=paint('headline',manifest['headline'],(96,100,1440,360),target=100,minimum=72,max_lines=2,bold=True,single_first=True)
    conclusion_top=100+headline_height+24
    _,conclusion_height=paint('conclusion',manifest['subtitle'],(96,conclusion_top,1440,conclusion_top+130),target=52,minimum=48,max_lines=2,color=MUTED)
    header_bottom=conclusion_top+conclusion_height
    offset=header_bottom-488

    if layout=='comparison':
        pair=editorial['comparison']
        paint('comparison_label',pair['label'],(96,528+offset,1440,584+offset),target=44,minimum=42,max_lines=1,bold=True)
        draw.line((768,602+offset,768,884+offset),fill=RULE,width=3)
        for side,x in [('left',96),('right',816)]:
            metric=pair[side]
            paint(side+'_name',metric['name'],(x,602+offset,x+624,664+offset),target=48,minimum=44,max_lines=1,bold=True)
            paint(side+'_value',metric['value'],(x,674+offset,x+624,822+offset),target=132,minimum=64,max_lines=2,bold=True,color=NAVY if side=='left' else '#9B691A',leading=1.12,break_words=True)
            paint(side+'_unit',metric['unit'],(x,842+offset,x+624,898+offset),target=44,minimum=42,max_lines=1,color=MUTED)
        scene_box=(96,930+offset,1440,1330+offset)
        section_box=(96,1362+offset,1440,1930)
    elif layout=='insight':
        scene_box=(96,header_bottom+40,1440,header_bottom+670)
        section_box=(96,header_bottom+712,1440,1930)
    else:
        scene_box=(1040,header_bottom+44,1440,1924)
        section_box=(96,header_bottom+76,980,1910)

    sections=editorial['sections']
    if layout in ('comparison','insight'):
        font=ImageFont.truetype(str(regular_font),48)
        try:
            required=sum(61+len(wrap_editorial(draw,s['body'],font,1344))*60 for s in sections)+24*(len(sections)-1)+40
        except ValueError:
            required=section_box[3]-section_box[1]
        extra=min(400,max(0,section_box[3]-section_box[1]-required))
        scene_box=(*scene_box[:3],scene_box[3]+extra)
        section_box=(section_box[0],section_box[1]+extra,section_box[2],section_box[3])
    scenic,crop=scene_crop(scene,scene_box)
    canvas.paste(scenic,scene_box[:2])
    body_size=None
    if layout in ('comparison','insight'):
        # All body descriptions share one size; no per-row visual inconsistency.
        available=section_box[3]-section_box[1]
        chosen=None
        for size in range(48,41,-1):
            font=ImageFont.truetype(str(regular_font),size)
            try:
                wrapped=[wrap_editorial(draw,s['body'],font,section_box[2]-section_box[0]) for s in sections]
            except ValueError:
                continue
            heights=[55+6+len(lines)*int(size*1.25) for lines in wrapped]
            if all(len(lines)<=2 for lines in wrapped) and sum(heights)+12*(len(sections)-1)<=available:
                chosen=size
                break
        if chosen is None:
            raise ValueError('Editorial sections cannot fit at 42 px or larger.')
        body_size=chosen
        cursor=section_box[1]
        for index,section in enumerate(sections):
            paint('section_heading',section['heading'],(96,cursor,1440,cursor+55),target=44,minimum=44,max_lines=1,bold=True)
            cursor+=61
            _,used=paint('section_body',section['body'],(96,cursor,1440,cursor+2*int(chosen*1.25)),target=chosen,minimum=chosen,max_lines=2)
            cursor+=used+12
        if cursor-12>section_box[3]:
            raise ValueError('Editorial sections exceed the reading area.')
    else:
        # Numbers convey order only in the process layout.
        cursor=section_box[1]
        for index,section in enumerate(sections):
            paint('step_number',str(index+1),(96,cursor,194,cursor+110),target=84,minimum=72,max_lines=1,bold=True,color='#9B691A')
            paint('section_heading',section['heading'],(218,cursor+6,980,cursor+72),target=52,minimum=48,max_lines=1,bold=True)
            _,used=paint('section_body',section['body'],(218,cursor+90,980,cursor+350),target=48,minimum=42,max_lines=4)
            body_size=min(body_size or 48,regions[-1]['font_size'])
            cursor+=max(330,90+used+36)
        if cursor-36>section_box[3]:
            raise ValueError('Editorial steps exceed the reading area.')

    source=urlsplit(manifest['source'])
    if source.scheme not in ('http','https') or not source.hostname or source.username or source.password:
        raise ValueError('Editorial source must be an HTTP(S) URL without credentials.')
    draw.line((96,1954,1440,1954),fill=RULE,width=2)
    paint('source',f'来源：{source.hostname} · AI插画',(96,1972,1440,2022),target=34,minimum=32,max_lines=1,color=MUTED)
    metadata={'layout':layout,'headline_font_size':headline_size,'body_font_size':body_size,'scene_box':list(scene_box),'scene_crop':crop,'section_count':len(sections),'text_regions':regions}
    return canvas,metadata
