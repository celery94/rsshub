"""Offline share publisher and deterministic renderer tests. No live API imports."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from PIL import Image, ImageChops


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

BRIDGE = load('share_bridge', 'publish-rss-draft.py')
RENDER = load('share_render', 'render-share-poster.py')
SOURCE = 'https://source.example/article'
CAPTION = '根据原文介绍，这项更新提供了新的技术线索。读者可以先核对版本、权限和适用条件，再结合自己的使用场景判断是否值得尝试。实际操作前保存现有配置，并在小范围验证效果，记录具体差异。文中的能力说明以原文为依据，具体表现仍需结合本地环境检查，避免直接套用未经验证的结论。'


class ShareTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='rss-share-python-')
        self.addCleanup(temporary.cleanup)
        self.workspace = Path(temporary.name).resolve()
        self.task = self.workspace / 'output/rss-shares/share-1'
        self.assets = self.task / 'assets'
        self.assets.mkdir(parents=True)
        self.poster = self.assets / '01-poster.png'
        Image.new('RGB',(1080,1440),'navy').save(self.poster)
        caption = CAPTION + '\n\n来源：' + SOURCE
        self.manifest = dict(title='中文标题',caption=caption,source=SOURCE,headline='技术更新带来的变化',subtitle='先阅读原文，再验证使用条件',poster='./assets/01-poster.png')
        self.write('share.json',self.manifest)
        (self.task / 'caption.txt').write_text(caption,encoding='utf-8')
        data = dict(version=1,mode='rss-share',task_id='share-1',source_url=SOURCE)
        self.write('input.json',data)
        self.result = dict(**data,status='running',stage='wechat_draft',title='中文标题',article_type='newspic',image_count=1,article_path='output/rss-shares/share-1/caption.txt',caption_path='output/rss-shares/share-1/caption.txt',cover_path='output/rss-shares/share-1/assets/01-poster.png',poster_path='output/rss-shares/share-1/assets/01-poster.png',inline_image_paths=[],media_id=None,error=None)
        self.write('result.json',self.result)
        self.write('.lock',dict(token='offline-lock'))
        self.publisher = SimpleNamespace(load_env_from_dotenv=Mock(),validate_args=Mock(),get_access_token=Mock(return_value='offline-token'),build_news_article=Mock(),build_newspic_article=Mock(return_value={'article_type':'newspic','image_info':{'image_list':[{'image_media_id':'offline-image'}]}}),add_draft=Mock(return_value='offline-media'))
        env = patch.dict(os.environ,dict(WECHAT_APP_ID='configured-app',WECHAT_APP_SECRET='configured-secret'),clear=True)
        env.start(); self.addCleanup(env.stop)

    def write(self,name,data):
        (self.task/name).write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')

    def run_bridge(self):
        return BRIDGE.run_bridge(self.task,'offline-lock','中文标题','',SOURCE,workspace=self.workspace,module_loader=lambda:self.publisher)

    def assert_no_upload(self):
        self.assertEqual(self.run_bridge()['error']['code'],'WECHAT_PREPARATION_FAILED')
        self.publisher.get_access_token.assert_not_called()
        self.publisher.build_newspic_article.assert_not_called()
        self.publisher.add_draft.assert_not_called()

    def test_success_uses_single_image_newspic_and_exact_caption(self):
        result = self.run_bridge()
        self.assertEqual(result['status'],'succeeded')
        args, token = self.publisher.build_newspic_article.call_args.args
        self.assertEqual(args.article_type,'newspic')
        self.assertEqual(args.content,self.manifest['caption'])
        self.assertEqual(args.image,[str(self.poster)])
        self.assertIsNone(args.cover_image)
        self.assertIsNone(args.content_file)
        self.publisher.build_news_article.assert_not_called()
        self.assertEqual(self.run_bridge(),result)
        self.publisher.add_draft.assert_called_once()

    def test_jpeg_poster_is_supported(self):
        self.poster.unlink()
        self.poster = self.assets / '01-poster.jpg'
        Image.new('RGB',(1080,1440),'navy').save(self.poster)
        self.manifest['poster'] = './assets/01-poster.jpg'
        self.write('share.json',self.manifest)
        poster_path = 'output/rss-shares/share-1/assets/01-poster.jpg'
        self.write('result.json',{**self.result,'cover_path':poster_path,'poster_path':poster_path})
        self.assertEqual(self.run_bridge()['status'],'succeeded')

    def test_fake_extension_and_corrupt_image_stop_before_token(self):
        self.poster.write_bytes(b'not an image')
        self.assert_no_upload()

    def test_actual_format_must_match_extension(self):
        Image.new('RGB',(1080,1440)).save(self.poster,format='JPEG')
        self.assert_no_upload()

    def test_low_resolution_wrong_ratio_and_truncated_image(self):
        for dimensions in [(810,1080),(1536,1536)]:
            with self.subTest(dimensions=dimensions):
                self.write('result.json',self.result)
                Image.new('RGB',dimensions).save(self.poster)
                self.assert_no_upload()
        self.write('result.json',self.result)
        Image.new('RGB',(1080,1440)).save(self.poster)
        self.poster.write_bytes(self.poster.read_bytes()[:100])
        self.assert_no_upload()

    def test_extra_image_stops_before_upload(self):
        Image.new('RGB',(10,10)).save(self.assets/'extra.png')
        self.assert_no_upload()

    def test_symlink_even_within_task_stops_before_upload(self):
        actual = self.task/'actual-assets'
        self.assets.rename(actual)
        if os.name == 'nt':
            import subprocess
            subprocess.run(['cmd','/c','mklink','/J',str(self.assets),str(actual)],check=True,stdout=subprocess.DEVNULL)
        else:
            self.assets.symlink_to(actual,target_is_directory=True)
        with self.assertRaises(BRIDGE.BridgeError):
            self.run_bridge()
        self.publisher.get_access_token.assert_not_called()
        self.publisher.add_draft.assert_not_called()

    def test_manifest_and_result_tampering_stop_before_upload(self):
        for change in [{'headline':'长'*25},{'subtitle':'长'*41},{'title':'长'*33},{'poster':'./assets/%30%31-poster.png'},{'source':'https://other.example/'},{'caption':'短句'}]:
            with self.subTest(change=change):
                self.write('result.json',self.result)
                self.write('share.json',{**self.manifest,**change})
                self.assert_no_upload()
        self.write('share.json',self.manifest)
        self.write('result.json',{**self.result,'poster_path':'../escape.png'})
        self.assert_no_upload()

    def test_unknown_submission_is_durable_and_prevents_retry(self):
        self.publisher.add_draft.side_effect=TimeoutError('DO_NOT_LEAK_SECRET')
        first=self.run_bridge()
        self.assertEqual(first['status'],'needs_attention')
        self.assertNotIn('DO_NOT_LEAK',json.dumps(first))
        self.assertEqual(self.run_bridge(),first)
        self.publisher.add_draft.assert_called_once()

    def test_prepared_newspic_requires_exactly_one_image(self):
        for images in [[],[{}],[{'image_media_id':'a'},{'image_media_id':'b'}]]:
            self.write('result.json',self.result)
            self.publisher.build_newspic_article.return_value={'article_type':'newspic','image_info':{'image_list':images}}
            self.assertEqual(self.run_bridge()['error']['code'],'WECHAT_PREPARATION_FAILED')
        self.publisher.add_draft.assert_not_called()

    def test_renderer_is_deterministic_high_resolution_and_preserves_raw(self):
        scene=self.task/'raw-scene.png'
        Image.new('RGB',(1536,2048),'steelblue').save(scene)
        raw=scene.read_bytes()
        result=RENDER.render(scene,self.task/'share.json')
        self.assertEqual((result['width'],result['height']),(1536,2048))
        with Image.open(self.poster) as image:
            first=image.copy()
        RENDER.render(scene,self.task/'share.json')
        with Image.open(self.poster) as image:
            self.assertIsNone(ImageChops.difference(first,image).getbbox())
        self.assertEqual(scene.read_bytes(),raw)
        self.assertEqual(self.run_bridge()['status'],'succeeded')

    def test_renderer_rejects_small_scene_and_text_overflow(self):
        scene=self.task/'raw-scene.png'
        Image.new('RGB',(500,700)).save(scene)
        with self.assertRaises(ValueError): RENDER.render(scene,self.task/'share.json')
        Image.new('RGB',(1080,1440)).save(scene)
        self.write('share.json',{**self.manifest,'headline':'长'*25})
        with self.assertRaises(ValueError): RENDER.render(scene,self.task/'share.json')

if __name__ == '__main__':
    unittest.main()
