"""Offline contract tests for the multi-image share manifest (share_images.py)."""
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from share_images import validate_images_manifest

SOURCE = 'https://source.example/article'
CACHED = '评测者花了约30小时通关，之后又重玩了一遍。游戏在主机与掌机模式下几乎全程保持60帧。'
CAPTION = '这项更新提供了可核查的技术线索，读者可以先阅读原文，再结合自己的使用场景判断是否值得尝试。实际操作前应确认版本和权限，保存现有配置，并在小范围验证效果，记录具体差异。文中的能力说明以原文为依据，具体表现仍需结合本地环境检查，避免直接套用未经验证的结论。'


def manifest():
    return {
        'title': '一次技术更新',
        'source': SOURCE,
        'caption': CAPTION + '\n来源：' + SOURCE,
        'images': [
            {
                'file': './assets/01-overview.png',
                'kicker': '技术观察',
                'headline': '值得关注的更新',
                'subtitle': '阅读原文后结合场景验证',
                'blocks': [
                    {'type': 'metrics', 'items': [{'value': '96', 'label': '综合评分'}]},
                    {'type': 'quote', 'text': '评测者花了约30小时通关', 'from': '原文评测'},
                    {'type': 'cards', 'items': [{'heading': '实际影响', 'body': '原文数据需要结合具体使用条件核对，不能直接套用。'}]},
                ],
            },
            {
                'file': './assets/02-detail.jpg',
                'headline': '第二张图聚焦限制',
                'width': 1536,
                'height': 1536,
                'theme': {'accent': '#AA5500', 'radius': 8},
                'blocks': [
                    {'type': 'material', 'path': './materials/01-source.png', 'caption': '原文配图'},
                    {'type': 'text', 'body': '这里是一段自由排版的说明文字，用来验证 text 块的规则。'},
                ],
            },
        ],
    }


class ContractTests(unittest.TestCase):
    def test_valid_manifest_normalizes_defaults(self):
        normalized = validate_images_manifest(manifest(), source=SOURCE, cached_content=CACHED)
        self.assertEqual(len(normalized['images']), 2)
        self.assertEqual(normalized['images'][0]['width'], 1536)
        self.assertEqual(normalized['images'][1]['width'], 1536)
        self.assertEqual(normalized['images'][1]['theme']['accent'], '#AA5500')
        self.assertEqual(normalized['images'][1]['theme']['background'], '#F5F1E7')

    def test_quote_segments_split_on_ellipsis(self):
        data = manifest()
        data['images'][0]['blocks'][1]['text'] = '评测者花了约30小时通关…之后又重玩了一遍'
        normalized = validate_images_manifest(data, cached_content=CACHED)
        self.assertEqual(normalized['images'][0]['blocks'][1]['type'], 'quote')

    def test_rejects_bad_structures(self):
        cases = []
        for count in (0, 4):
            data = manifest()
            images = data['images']
            data['images'] = (images * 2)[:count] if count else []
            cases.append(data)
        for name, change in [
            ('order', lambda d: d['images'][1].update(file='./assets/03-detail.jpg')),
            ('duplicate', lambda d: d['images'][1].update(file='./assets/01-overview.png')),
            ('quote', lambda d: d['images'][0]['blocks'][1].update(text='这句话并不存在于原文中，用来验证引语核对。')),
            ('no-quote', lambda d: d['images'][0].update(blocks=[{'type': 'text', 'body': '这里是一段没有引用原文的说明文字，不符合分享图要求。'}])),
            ('theme', lambda d: d['images'][1].update(theme={'accent': 'orange'})),
            ('width', lambda d: d['images'][1].update(width=500)),
            ('block-type', lambda d: d['images'][1]['blocks'].append({'type': 'video', 'path': './materials/01-source.png'})),
            ('mixed', lambda d: d.update(poster='./assets/01-overview.png')),
        ]:
            data = manifest()
            change(data)
            cases.append((name, data))
        for case in cases:
            name, data = case if isinstance(case, tuple) else ('case', case)
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    validate_images_manifest(data, source=SOURCE, cached_content=CACHED)

    def test_rejects_caption_source_and_title_problems(self):
        for change in (
            {'caption': CAPTION + '\n来源：https://other.example/'},
            {'title': '长' * 33},
            {'source': 'https://other.example/'},
        ):
            with self.subTest(change=change):
                with self.assertRaises(ValueError):
                    validate_images_manifest({**manifest(), **change}, source=SOURCE, cached_content=CACHED)


if __name__ == '__main__':
    unittest.main()
