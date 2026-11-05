"""Offline editorial poster composition. No text is painted over a busy scene."""
import re
from urllib.parse import urlsplit
from PIL import Image, ImageDraw, ImageFont
from share_editorial import validate_editorial

WIDTH, HEIGHT = 1536, 2048
LEFT, RIGHT = 96, 1440
IVORY, NAVY, MUTED, AMBER, RULE = '#F5F1E7', '#14283D', '#536779', '#D39A32', '#D7D9D8'
AMBER_DARK, CARD, CARD_EDGE = '#9B691A', '#FCFAF4', '#E4DDCB'
BRAND = 'Aide Hub'
CLOSING = '，。、；：！？）》】」』％…'
OPENING = '（《【「『'
# Card geometry shared by fitting and painting, so measured and drawn heights agree.
CARD_PAD, HEADING_STEP, BODY_LEADING = 26, 56, 1.3


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


def balanced(draw, text, font, width, break_words=False):
    """Wrap, then narrow the measure so a last line is not left with a few characters."""
    lines = wrap_editorial(draw, text, font, width, break_words)
    short = lambda line: len(re.sub(r'[\s' + CLOSING + OPENING + ']', '', line)) <= 4
    if len(lines) < 2 or not short(lines[-1]):
        return lines
    for narrower in range(int(width) - 8, int(width * 0.7), -8):
        try:
            candidate = wrap_editorial(draw, text, font, narrower, break_words)
        except ValueError:
            break
        if len(candidate) != len(lines):
            break
        if not short(candidate[-1]):
            return candidate
    return lines


def fit_text(draw, text, font_path, width, height, *, target, minimum, max_lines, leading=1.25, single_first=False, break_words=False):
    searches = [1, max_lines] if single_first and max_lines > 1 else [max_lines]
    for line_limit in searches:
        for size in range(target, minimum - 1, -1):
            font = ImageFont.truetype(str(font_path), size)
            try:
                lines = balanced(draw, text, font, width, break_words=break_words)
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
    steps = layout == 'steps'
    canvas = Image.new('RGB',(WIDTH,HEIGHT),IVORY)
    draw = ImageDraw.Draw(canvas)
    regions = []

    def paint(role,text,box,*,target=48,minimum=42,max_lines=2,bold=False,color=NAVY,single_first=False,leading=1.25,break_words=False,align='left'):
        x,y,right,bottom=box
        try:
            font,lines,step=fit_text(draw,text,bold_font if bold else regular_font,right-x,bottom-y,target=target,minimum=minimum,max_lines=max_lines,leading=leading,single_first=single_first,break_words=break_words)
        except ValueError as error:
            raise ValueError(f'{role}: {error}') from error
        for index,line in enumerate(lines):
            if align=='right':
                draw.text((right,y+index*step),line,font=font,fill=color,anchor='rt')
            else:
                draw.text((x,y+index*step),line,font=font,fill=color,anchor='lt')
        regions.append({'role':role,'box':list(box),'font_size':font.size,'lines':lines,'line_step':step})
        return font.size,len(lines)*step

    # Masthead: an optional column label in an amber tab, otherwise a short amber spine.
    if 'kicker' in editorial:
        tab=ImageFont.truetype(str(bold_font),30)
        tab_width=int(draw.textlength(editorial['kicker'],font=tab))+44
        draw.rounded_rectangle((LEFT,36,LEFT+tab_width,84),radius=10,fill=AMBER)
        paint('kicker',editorial['kicker'],(LEFT+22,44,LEFT+tab_width,80),target=30,minimum=30,max_lines=1,bold=True,leading=1.1)
    else:
        draw.rectangle((LEFT,64,168,74),fill=AMBER)
    headline_size,headline_height=paint('headline',manifest['headline'],(LEFT,100,RIGHT,360),target=100,minimum=72,max_lines=2,bold=True,single_first=True)
    conclusion_top=100+headline_height+24
    _,conclusion_height=paint('conclusion',manifest['subtitle'],(LEFT,conclusion_top,RIGHT,conclusion_top+130),target=52,minimum=48,max_lines=2,color=MUTED)
    header_bottom=conclusion_top+conclusion_height
    offset=header_bottom-488

    # Key figures sit directly under the conclusion so the numbers read first.
    top=header_bottom
    highlights=editorial.get('highlights',[])
    if highlights:
        top+=36
        column=(RIGHT-LEFT)//len(highlights)
        for index,item in enumerate(highlights):
            x=LEFT+index*column
            if index:
                draw.line((x-24,top+8,x-24,top+176),fill=RULE,width=3)
            paint('highlight_value',item['value'],(x,top,x+column-48,top+118),target=104,minimum=56,max_lines=1,bold=True,color=AMBER_DARK,leading=1.12,break_words=True)
            paint('highlight_label',item['label'],(x,top+124,x+column-48,top+176),target=38,minimum=34,max_lines=1,color=MUTED)
        top+=176

    if layout=='comparison':
        pair=editorial['comparison']
        paint('comparison_label',pair['label'],(LEFT,528+offset,RIGHT,584+offset),target=44,minimum=42,max_lines=1,bold=True)
        draw.line((768,602+offset,768,884+offset),fill=RULE,width=3)
        for side,x in [('left',LEFT),('right',816)]:
            metric=pair[side]
            paint(side+'_name',metric['name'],(x,602+offset,x+624,664+offset),target=48,minimum=44,max_lines=1,bold=True)
            _,value_height=paint(side+'_value',metric['value'],(x,674+offset,x+624,822+offset),target=132,minimum=64,max_lines=2,bold=True,color=NAVY if side=='left' else AMBER_DARK,leading=1.12,break_words=True)
            # The unit follows the value it qualifies instead of a fixed two-line slot.
            unit_top=674+offset+value_height+8
            paint(side+'_unit',metric['unit'],(x,unit_top,x+624,unit_top+56),target=44,minimum=42,max_lines=1,color=MUTED)
        scene_box=(LEFT,926+offset,RIGHT,1186+offset)
        section_box=(LEFT,1216+offset,RIGHT,1930)
    elif layout=='insight':
        scene_box=(LEFT,top+36,RIGHT,top+436)
        section_box=(LEFT,top+468,RIGHT,1930)
    else:
        scene_box=(1100,top+44,RIGHT,1924)
        section_box=(LEFT,top+44,1068,1924)

    # Each section is a card; one shared body size, chosen as large as the content allows.
    sections=editorial['sections']
    indent=96 if steps else 24
    text_width=section_box[2]-section_box[0]-2*CARD_PAD-indent
    available=section_box[3]-section_box[1]
    gap=20
    chosen=None
    for size in range(44,33,-1):
        font=ImageFont.truetype(str(regular_font),size)
        try:
            wrapped=[balanced(draw,s['body'],font,text_width) for s in sections]
        except ValueError:
            continue
        heights=[2*CARD_PAD+HEADING_STEP+len(lines)*int(size*BODY_LEADING) for lines in wrapped]
        need=sum(heights)+gap*(len(sections)-1)
        if all(len(lines)<=3 for lines in wrapped) and need<=available:
            chosen=size
            break
    if chosen is None:
        raise ValueError('Editorial sections cannot fit at 34 px or larger; shorten them.')
    body_size=chosen
    spare=available-need
    if not steps:
        # Spare room goes to the illustration first, then opens the card rhythm.
        grow=min(520,spare)
        scene_box=(*scene_box[:3],scene_box[3]+grow)
        section_box=(section_box[0],section_box[1]+grow,section_box[2],section_box[3])
        spare-=grow
    if len(sections)>1:
        gap+=min(28,spare//(len(sections)-1))

    scenic,crop=scene_crop(scene,scene_box)
    mask=Image.new('L',scenic.size,0)
    ImageDraw.Draw(mask).rounded_rectangle((0,0,scenic.width-1,scenic.height-1),radius=24,fill=255)
    canvas.paste(scenic,scene_box[:2],mask)

    cursor=section_box[1]
    for index,(section,height) in enumerate(zip(sections,heights)):
        card=(section_box[0],cursor,section_box[2],cursor+height)
        draw.rounded_rectangle(card,radius=18,fill=CARD,outline=CARD_EDGE,width=2)
        x=card[0]+CARD_PAD
        inner=cursor+CARD_PAD
        if steps:
            paint('step_number',str(index+1),(x,inner-4,x+80,inner+76),target=64,minimum=56,max_lines=1,bold=True,color=AMBER_DARK)
            x+=96
        else:
            draw.rounded_rectangle((x,inner+8,x+8,inner+44),radius=4,fill=AMBER)
            x+=24
        paint('section_heading',section['heading'],(x,inner,card[2]-CARD_PAD,inner+HEADING_STEP-6),target=40,minimum=36,max_lines=1,bold=True,color=AMBER_DARK)
        paint('section_body',section['body'],(x,inner+HEADING_STEP,card[2]-CARD_PAD,inner+HEADING_STEP+3*int(chosen*BODY_LEADING)),target=chosen,minimum=chosen,max_lines=3,leading=BODY_LEADING)
        cursor+=height+gap
    if cursor-gap>section_box[3]:
        raise ValueError('Editorial sections exceed the reading area.')

    source=urlsplit(manifest['source'])
    if source.scheme not in ('http','https') or not source.hostname or source.username or source.password:
        raise ValueError('Editorial source must be an HTTP(S) URL without credentials.')
    draw.line((LEFT,1954,RIGHT,1954),fill=RULE,width=2)
    paint('source',f'来源：{source.hostname} · AI插画',(LEFT,1972,1180,2022),target=34,minimum=28,max_lines=1,color=MUTED)
    paint('brand',BRAND,(1200,1972,RIGHT,2022),target=34,minimum=34,max_lines=1,bold=True,align='right')
    metadata={'layout':layout,'headline_font_size':headline_size,'body_font_size':body_size,'scene_box':list(scene_box),'scene_crop':crop,'section_count':len(sections),'highlight_count':len(highlights),'text_regions':regions}
    return canvas,metadata
