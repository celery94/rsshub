"""Offline share publisher and legacy compatibility tests. No live API imports."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from PIL import Image


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

BRIDGE = load('share_bridge', 'publish-rss-draft.py')
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
        self.publisher = SimpleNamespace(load_env_from_dotenv=Mock(),validate_args=Mock(),get_access_token=Mock(return_value='offline-token'),build_news_article=Mock(),build_newspic_article=Mock(return_value={'article_type':'newspic','image_info':{'image_list':[{'image_media_id':'offline-image'}]}}),add_draft=Mock(return_value='offline-media'),submit_publish=Mock(side_effect=AssertionError('Publication must never be called')))
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
        self.assertEqual(result['media_id'],'offline-media')
        self.assertNotIn('publish_status',result)
        self.assertNotIn('publish_id',result)
        self.publisher.submit_publish.assert_not_called()
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

    def test_generation_output_is_not_decoded_again(self):
        self.poster.write_bytes(b'generated output is passed through without pixel inspection')
        self.assertEqual(self.run_bridge()['status'], 'succeeded')

    def test_empty_or_missing_image_stops_before_upload(self):
        self.poster.write_bytes(b'')
        self.assert_no_upload()
        self.write('result.json', self.result)
        self.poster.unlink()
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
        for change in [{'title':'长'*33},{'poster':'./assets/%30%31-poster.png'},{'source':'https://other.example/'},{'caption':'短句'}]:
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

    def test_legacy_content_fields_are_preserved_without_revalidation(self):
        self.write('input.json', dict(version=1, mode='rss-share', task_id='share-1',
                                     source_url=SOURCE, poster_layout='content'))
        manifest = {**self.manifest, 'key_points': ['历史要点']}
        self.write('share.json', manifest)
        self.assertEqual(self.run_bridge()['status'], 'succeeded')
        self.assertEqual(json.loads((self.task / 'share.json').read_text(encoding='utf-8')), manifest)

    def test_legacy_editorial_no_longer_requires_template(self):
        self.write('input.json', dict(version=1, mode='rss-share', task_id='share-1',
                                     source_url=SOURCE, poster_layout='editorial'))
        self.assertEqual(self.run_bridge()['status'], 'succeeded')

    def test_article_bridge_rejects_share_only_layout_field(self):
        import test_publish_rss_draft as article_helper
        fixture = article_helper.BridgeTests('test_success_uses_original_load_env_and_namespace_contract')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.write_json('input.json', {**fixture.input, 'poster_layout': 'content'})
        with self.assertRaises(article_helper.BRIDGE.BridgeError):
            fixture.run_bridge()
        fixture.publisher.get_access_token.assert_not_called()
        fixture.publisher.add_draft.assert_not_called()

if __name__ == '__main__':
    unittest.main()
