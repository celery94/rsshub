"""Legacy editorial manifest validation for the private publishing bridge."""
import re

LAYOUTS = ('comparison', 'insight', 'steps')


def plain(value, minimum, maximum, *, chinese=False):
    if not isinstance(value, str) or value != value.strip() or not minimum <= len(value) <= maximum or re.search(r'[\x00-\x1f\x7f<>`]|\*\*|!\[|\]\(', value):
        raise ValueError(f'Editorial text requires {minimum}–{maximum} plain-text codepoints.')
    if chinese and not re.search(r'[\u3400-\u9fff\U00020000-\U000323af]', value):
        raise ValueError('Editorial section text must contain Chinese.')


def exact_object(value, required, optional=()):
    if not isinstance(value, dict) or not set(required).issubset(value) or set(value) - set(required) - set(optional):
        raise ValueError('Editorial objects contain missing or unknown fields.')


def validate_editorial(editorial, *, required=False, present=False):
    if not required and not present:
        return None
    exact_object(editorial, ('layout', 'sections'), ('comparison', 'kicker', 'highlights'))
    layout = editorial['layout']
    if 'kicker' in editorial:
        plain(editorial['kicker'], 2, 8, chinese=True)
    if 'highlights' in editorial:
        if layout == 'comparison':
            raise ValueError('The comparison layout already shows its metrics; highlights are not accepted.')
        highlights = editorial['highlights']
        if not isinstance(highlights, list) or not 2 <= len(highlights) <= 3:
            raise ValueError('Editorial highlights require two or three items.')
        for item in highlights:
            exact_object(item, ('value', 'label'))
            plain(item['value'], 1, 8)
            plain(item['label'], 2, 12, chinese=True)
            if not re.search(r'\d', item['value']):
                raise ValueError('Each highlight value must contain a number from the source.')
    if layout not in LAYOUTS:
        raise ValueError('Editorial layout must be comparison, insight or steps.')
    sections = editorial['sections']
    if not isinstance(sections, list) or not 2 <= len(sections) <= 5:
        raise ValueError('Editorial requires two to five sections.')
    for section in sections:
        exact_object(section, ('heading', 'body'))
        plain(section['heading'], 1, 12, chinese=True)
        plain(section['body'], 12, 80, chinese=True)
    if layout == 'comparison':
        comparison = editorial.get('comparison')
        exact_object(comparison, ('label', 'left', 'right'))
        plain(comparison['label'], 1, 24)
        for side in ('left', 'right'):
            metric = comparison[side]
            exact_object(metric, ('name', 'value', 'unit'))
            for key, maximum in (('name', 12), ('value', 16), ('unit', 12)):
                plain(metric[key], 1, maximum)
        if comparison['left']['unit'] != comparison['right']['unit']:
            raise ValueError('Comparison units must match exactly.')
    elif 'comparison' in editorial:
        raise ValueError('Only the comparison layout accepts comparison metrics.')
    return editorial
