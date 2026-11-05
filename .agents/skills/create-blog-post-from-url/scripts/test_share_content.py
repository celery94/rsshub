"""Content-poster contract, readability and legacy regression tests; no network."""
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image, ImageChops, ImageDraw
import test_rss_share as helper

RENDER=helper.RENDER
POINTS=[
    '数据中心业务增长带动整体表现，但仍需结合客户需求、利润率变化与下一季度订单指引核对增长质量。',
    '产品更新可以改善特定工作负载，企业采用之前应先确认版本、部署成本以及现有系统的兼容条件。',
    '短期市场反应无法替代长期验证，读者可回到原文检查关键数据，再根据自身场景评估投入价值。',
]


def make_review_fixture(directory):
    """Synthetic neutral background for layout review only, never a generated HD2D deliverable."""
    directory=Path(directory)
    directory.mkdir(parents=True,exist_ok=True)
    scene=directory/'neutral-test-scene.png'
    image=Image.new('RGB',(1536,2048),(49,76,87))
    draw=ImageDraw.Draw(image)
    # A neutral checker and center marker expose exactly how much scene stays visible.
    for y in range(0,2048,64):
        for x in range(0,1536,64):
            if (x//64+y//64)%2:
                draw.rectangle((x,y,x+63,y+63),fill=(57,87,96))
    draw.rectangle((450,650,1086,1130),outline=(171,216,209),width=8)
    image.save(scene)
    manifest=dict(title='技术更新的主要内容',headline='技术更新的实际影响',subtitle='增长表现需要结合具体条件核对',source=helper.SOURCE,caption=helper.CAPTION+'\n来源：'+helper.SOURCE,poster='./assets/01-poster.png',key_points=POINTS)
    (directory/'input.json').write_text(json.dumps(dict(version=1,mode='rss-share',poster_layout='content',task_id=directory.name,source_url=helper.SOURCE)),encoding='utf-8')
    manifest_path=directory/'share.json'
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False),encoding='utf-8')
    return RENDER.render(scene,manifest_path)


class ContentPosterTests(unittest.TestCase):
    def setUp(self):
        self.fixture=helper.ShareTests('test_success_uses_single_image_newspic_and_exact_caption')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.scene=self.fixture.task/'raw-scene.png'
        Image.new('RGB',(1536,2048),'steelblue').save(self.scene)

    def modern(self):
        f=self.fixture
        data=json.loads((f.task/'input.json').read_text(encoding='utf-8'))
        data['poster_layout']='content'
        f.write('input.json',data)

    def test_modern_requires_points_before_render_or_upload(self):
        self.modern()
        with self.assertRaises(ValueError):RENDER.render(self.scene,self.fixture.task/'share.json')
        self.fixture.assert_no_upload()

    def test_three_long_points_render_and_publish_with_readable_font(self):
        self.modern()
        f=self.fixture
        f.write('share.json',{**f.manifest,'key_points':POINTS})
        self.assertTrue(all(40<=len(point)<=50 for point in POINTS))
        result=RENDER.render(self.scene,f.task/'share.json')
        self.assertEqual((result['width'],result['height']),(1536,2048))
        draw=ImageDraw.Draw(Image.new('RGB',(1536,2048)))
        font,wrapped,step=RENDER.layout_points(draw,POINTS)
        self.assertGreaterEqual(font.size,42)
        self.assertLessEqual(font.size,48)
        self.assertTrue(all(len(lines)<=2 for lines in wrapped))
        self.assertLessEqual(sum(len(lines)*step for lines in wrapped)+56,500)
        self.assertEqual(f.run_bridge()['status'],'succeeded')

    def test_maximum_points_wrap_without_overflow_or_small_font(self):
        draw=ImageDraw.Draw(Image.new('RGB',(1536,2048)))
        points=['中'*50,'文'*50,'字'*50]
        font,wrapped,step=RENDER.layout_points(draw,points)
        self.assertGreaterEqual(font.size,42)
        self.assertTrue(all(len(lines)==2 for lines in wrapped))
        self.assertTrue(all(draw.textlength(line,font=font)<=1160 for lines in wrapped for line in lines))
        self.assertLessEqual(sum(len(lines)*step for lines in wrapped)+56,500)
        with self.assertRaises(ValueError):RENDER.layout_points(draw,points,width=200,height=100)

    def test_legacy_without_points_retains_original_scene_area(self):
        f=self.fixture
        RENDER.render(self.scene,f.task/'share.json')
        with Image.open(f.poster) as old:
            original=old.copy()
        f.write('share.json',{**f.manifest,'key_points':POINTS[:2]})
        RENDER.render(self.scene,f.task/'share.json')
        with Image.open(f.poster) as modern:
            self.assertIsNone(ImageChops.difference(original.crop((0,540,1536,1190)),modern.crop((0,540,1536,1190))).getbbox())
            self.assertIsNotNone(ImageChops.difference(original.crop((64,1190,1472,1848)),modern.crop((64,1190,1472,1848))).getbbox())
        self.assertEqual(f.run_bridge()['status'],'succeeded')

    def test_invalid_points_rejected_for_modern_and_legacy(self):
        f=self.fixture
        invalid=[None,{},'主要内容',[],[POINTS[0]],POINTS+[POINTS[0]],[POINTS[0],42],[POINTS[0],'短句'],[POINTS[0],'中'*51],[POINTS[0],'a'*20],[POINTS[0],'**需要验证部署成本以及权限条件**'],[POINTS[0],'需要验证部署成本\n以及使用条件'],[POINTS[0],' '+POINTS[1]]]
        for modern in (False,True):
            if modern:self.modern()
            for value in invalid:
                with self.subTest(modern=modern,value=value):
                    f.write('result.json',f.result)
                    f.write('share.json',{**f.manifest,'key_points':value})
                    with self.assertRaises(ValueError):RENDER.render(self.scene,f.task/'share.json')
                    f.assert_no_upload()

    def test_actual_mixed_headline_fits_one_line_without_lonely_glyph(self):
        draw=ImageDraw.Draw(Image.new('RGB',(1536,2048)))
        title='AMD 单季营收有望首超 Intel'
        font,lines,step=RENDER.layout_headline(draw,title)
        self.assertEqual(lines,[title])
        self.assertGreaterEqual(font.size,72)
        self.assertLessEqual(draw.textlength(lines[0],font=font),1280)

    def test_maximum_chinese_headline_keeps_readable_two_lines(self):
        draw=ImageDraw.Draw(Image.new('RGB',(1536,2048)))
        title='中'*24
        font,lines,step=RENDER.layout_headline(draw,title)
        self.assertEqual(len(lines),2)
        self.assertEqual(''.join(lines),title)
        self.assertGreaterEqual(font.size,72)
        self.assertLessEqual(len(lines)*step,280)
        self.assertTrue(all(draw.textlength(line,font=font)<=1280 for line in lines))

    def test_fallback_headline_never_splits_latin_name(self):
        draw=ImageDraw.Draw(Image.new('RGB',(1536,2048)))
        title='中'*19+'Intel'
        font,lines,step=RENDER.layout_headline(draw,title)
        self.assertEqual(len(lines),2)
        self.assertEqual(''.join(lines),title)
        self.assertTrue(any('Intel' in line for line in lines))
        self.assertFalse(any(line=='l' for line in lines))
        self.assertTrue(all(draw.textlength(line,font=font)<=1280 for line in lines))

    def test_modern_render_is_deterministic(self):
        self.modern()
        f=self.fixture
        f.write('share.json',{**f.manifest,'key_points':POINTS})
        RENDER.render(self.scene,f.task/'share.json')
        first=f.poster.read_bytes()
        RENDER.render(self.scene,f.task/'share.json')
        self.assertEqual(first,f.poster.read_bytes())

    def test_bad_layout_value_is_rejected_even_with_points(self):
        f=self.fixture
        data=json.loads((f.task/'input.json').read_text(encoding='utf-8'))
        data['poster_layout']='legacy'
        f.write('input.json',data)
        f.write('share.json',{**f.manifest,'key_points':POINTS})
        with self.assertRaises(ValueError):RENDER.render(self.scene,f.task/'share.json')
        with self.assertRaises(helper.BRIDGE.BridgeError):f.run_bridge()
        f.publisher.get_access_token.assert_not_called()

    def test_article_bridge_rejects_share_only_layout_field(self):
        import test_publish_rss_draft as article_helper
        fixture=article_helper.BridgeTests('test_success_uses_original_load_env_and_namespace_contract')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.write_json('input.json',{**fixture.input,'poster_layout':'content'})
        with self.assertRaises(article_helper.BRIDGE.BridgeError):fixture.run_bridge()
        fixture.publisher.get_access_token.assert_not_called()
        fixture.publisher.add_draft.assert_not_called()

    def test_content_wrap_keeps_chinese_punctuation_off_line_start(self):
        draw=ImageDraw.Draw(Image.new('RGB',(1536,2048)))
        font,wrapped,step=RENDER.layout_points(draw,POINTS)
        self.assertTrue(all(not line.startswith(tuple('，。、；：！？）》】」』')) for lines in wrapped for line in lines))
        self.assertTrue(all(draw.textlength(line,font=font)<=1160 for lines in wrapped for line in lines))

if __name__=='__main__':unittest.main()
