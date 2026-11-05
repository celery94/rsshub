"""Offline bridge tests for multi-image share publishing. No live API calls."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from PIL import Image

SPEC = importlib.util.spec_from_file_location('share_bridge_images', Path(__file__).with_name('publish-rss-draft.py'))
BRIDGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BRIDGE)
SOURCE = 'https://source.example/article'
CAPTION = '这项更新提供了可核查的技术线索，读者可以先阅读原文，再结合自己的使用场景判断是否值得尝试。实际操作前应确认版本和权限，保存现有配置，并在小范围验证效果，记录具体差异。文中的能力说明以原文为依据，具体表现仍需结合本地环境检查，避免直接套用未经验证的结论。'
CACHED = '评测者花了约30小时通关，之后又重玩了一遍。游戏在主机与掌机模式下几乎全程保持60帧。'


class MultiImageBridgeTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='rss-share-images-bridge-')
        self.addCleanup(temporary.cleanup)
        self.workspace = Path(temporary.name).resolve()
        self.task = self.workspace / 'output/rss-shares/share-2'
        self.assets = self.task / 'assets'
        self.assets.mkdir(parents=True)
        (self.task / 'scenes').mkdir()
        (self.task / 'materials').mkdir()
        self.images = [self.assets / '01-overview.png', self.assets / '02-detail.jpg']
        Image.new('RGB', (1080, 1440), 'navy').save(self.images[0])
        Image.new('RGB', (1080, 1350), 'teal').save(self.images[1])
        Image.new('RGB', (600, 400), 'olive').save(self.task / 'materials/01-source.png')
        caption = CAPTION + '\n来源：' + SOURCE
        self.manifest = {
            'title': '中文标题',
            'source': SOURCE,
            'caption': caption,
            'images': [
                {
                    'file': './assets/01-overview.png',
                    'headline': '第一张图标题',
                    'blocks': [
                        {'type': 'quote', 'text': '评测者花了约30小时通关', 'from': '原文评测'},
                        {'type': 'metrics', 'items': [{'value': '96', 'label': '综合评分'}]},
                    ],
                },
                {
                    'file': './assets/02-detail.jpg',
                    'headline': '第二张图标题',
                    'width': 1080,
                    'height': 1350,
                    'blocks': [
                        {'type': 'material', 'path': './materials/01-source.png', 'caption': '原文配图'},
                        {'type': 'text', 'body': '这里是一段自由排版的说明文字，用来验证 text 块的规则。'},
                    ],
                },
            ],
        }
        self.write('share.json', self.manifest)
        (self.task / 'caption.txt').write_text(caption, encoding='utf-8')
        data = {'version': 1, 'mode': 'rss-share', 'task_id': 'share-2', 'source_url': SOURCE, 'cached_content': CACHED}
        self.write('input.json', data)
        self.result = {
            **{key: data[key] for key in ('version', 'mode', 'task_id', 'source_url')},
            'status': 'running', 'stage': 'wechat_draft', 'title': '中文标题',
            'article_type': 'newspic', 'image_count': 2,
            'article_path': 'output/rss-shares/share-2/caption.txt',
            'caption_path': 'output/rss-shares/share-2/caption.txt',
            'cover_path': 'output/rss-shares/share-2/assets/01-overview.png',
            'poster_path': 'output/rss-shares/share-2/assets/01-overview.png',
            'image_paths': ['output/rss-shares/share-2/assets/01-overview.png', 'output/rss-shares/share-2/assets/02-detail.jpg'],
            'inline_image_paths': [], 'media_id': None, 'error': None,
        }
        self.write('result.json', self.result)
        self.write('.lock', {'token': 'offline-lock'})
        self.publisher = SimpleNamespace(
            load_env_from_dotenv=Mock(), validate_args=Mock(), get_access_token=Mock(return_value='offline-token'),
            build_news_article=Mock(),
            build_newspic_article=Mock(return_value={'article_type': 'newspic', 'image_info': {'image_list': [{'image_media_id': 'media-1'}, {'image_media_id': 'media-2'}]}}),
            add_draft=Mock(return_value='offline-media'),
        )
        environment = patch.dict(os.environ, {'WECHAT_APP_ID': 'configured-app', 'WECHAT_APP_SECRET': 'configured-secret'}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    def write(self, name, data):
        (self.task / name).write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')

    def run_bridge(self):
        return BRIDGE.run_bridge(self.task, 'offline-lock', '中文标题', '', SOURCE,
                                 workspace=self.workspace, module_loader=lambda: self.publisher)

    def assert_no_upload(self):
        self.assertEqual(self.run_bridge()['error']['code'], 'WECHAT_PREPARATION_FAILED')
        self.publisher.get_access_token.assert_not_called()
        self.publisher.build_newspic_article.assert_not_called()
        self.publisher.add_draft.assert_not_called()

    def test_success_uploads_every_image_in_order(self):
        result = self.run_bridge()
        self.assertEqual(result['status'], 'succeeded')
        args, token = self.publisher.build_newspic_article.call_args.args
        self.assertEqual(args.article_type, 'newspic')
        self.assertEqual(args.image, [str(image) for image in self.images])
        self.assertEqual(args.content, self.manifest['caption'])
        self.assertIsNone(args.cover_image)
        self.assertEqual(self.run_bridge(), result)
        self.publisher.add_draft.assert_called_once()

    def test_image_count_and_paths_must_match(self):
        for change in ({'image_count': 1}, {'image_paths': self.result['image_paths'][:1]}, {'image_paths': []}, {'poster_path': self.result['image_paths'][1]}):
            with self.subTest(change=change):
                self.write('result.json', {**self.result, **change})
                self.assert_no_upload()
        self.write('result.json', self.result)

    def test_prepared_newspic_requires_one_media_id_per_image(self):
        for images in ([], [{'image_media_id': 'a'}], [{'image_media_id': 'a'}, {}], [{'image_media_id': 'a'}, {'image_media_id': 'b'}, {'image_media_id': 'c'}]):
            with self.subTest(images=len(images)):
                self.write('result.json', self.result)
                self.publisher.build_newspic_article.return_value = {'article_type': 'newspic', 'image_info': {'image_list': images}}
                self.assertEqual(self.run_bridge()['error']['code'], 'WECHAT_PREPARATION_FAILED')
        self.publisher.add_draft.assert_not_called()

    def test_low_resolution_or_extra_asset_stops_before_token(self):
        Image.new('RGB', (1000, 1000), 'navy').save(self.images[0])
        self.assert_no_upload()
        self.write('result.json', self.result)
        Image.new('RGB', (1080, 1440), 'navy').save(self.images[0])
        Image.new('RGB', (10, 10), 'white').save(self.assets / 'extra.png')
        self.assert_no_upload()

    def test_quote_must_match_cached_article(self):
        changed = json.loads(json.dumps(self.manifest))
        changed['images'][0]['blocks'][0]['text'] = '这句话并不存在于原文中，用来验证引语核对。'
        self.write('share.json', changed)
        self.assert_no_upload()

    def test_unknown_submission_is_durable(self):
        self.publisher.add_draft.side_effect = TimeoutError('DO_NOT_LEAK_SECRET')
        first = self.run_bridge()
        self.assertEqual(first['status'], 'needs_attention')
        self.assertNotIn('DO_NOT_LEAK', json.dumps(first))
        self.assertEqual(self.run_bridge(), first)
        self.publisher.add_draft.assert_called_once()


if __name__ == '__main__':
    unittest.main()
