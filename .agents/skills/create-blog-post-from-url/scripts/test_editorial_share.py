"""Offline editorial layouts: strict data contracts, actual pixels, overflow and compatibility."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image, ImageDraw, ImageChops
import test_rss_share as helper
from share_editorial import validate_editorial
from editorial_poster import fit_text, wrap_editorial

SECTIONS=[
 {'heading':'增长来源','body':'数据中心需求支持业务增长，但仍需结合客户需求、利润率变化与后续订单核对增长质量。'},
 {'heading':'比较边界','body':'不同公司的预测与已披露数据存在差异，比较之前应确认统计口径、时间区间以及实际适用条件。'},
 {'heading':'验证方式','body':'读者可回到原文核对关键指标，再结合自身业务场景评估影响，避免只根据单个排名作出判断。'},
]
COMPARISON={'label':'2026年第四季度营收预测','left':{'name':'AMD','value':'约170','unit':'亿美元'},'right':{'name':'Intel','value':'150–160','unit':'亿美元'}}


def editorial(layout,maximum=False):
    value={'layout':layout,'sections':copy.deepcopy(SECTIONS)}
    if layout=='comparison':value['comparison']=copy.deepcopy(COMPARISON)
    if maximum:
        value['sections']=[{'heading':'标'*12,'body':'内'*50} for _ in range(3)]
        if layout=='comparison':
            value['comparison']={'label':'期'*24,'left':{'name':'名'*12,'value':'1'*16,'unit':'单'*12},'right':{'name':'名'*12,'value':'2'*16,'unit':'单'*12}}
    return value


def make_editorial_fixtures(directory):
    """Persist neutral synthetic test-only layouts for visual review."""
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    scene=directory/'neutral-test-scene.png'
    image=Image.new('RGB',(1536,2048),'#D4E0DE');draw=ImageDraw.Draw(image)
    for y in range(0,2048,64):
        for x in range(0,1536,64):
            if (x//64+y//64)%2:draw.rectangle((x,y,x+63,y+63),fill='#B5CFCD')
    draw.rectangle((420,850,1110,1500),fill='#467181')
    draw.rectangle((500,1220,970,1420),fill='#D39A32')
    image.save(scene)
    results=[]
    for layout in ('comparison','insight','steps'):
        folder=directory/layout;folder.mkdir(exist_ok=True)
        (folder/'input.json').write_text(json.dumps({'mode':'rss-share','poster_layout':'editorial'}),encoding='utf-8')
        manifest=dict(title='编辑式海报布局测试',headline='编辑式海报的信息层次测试',subtitle='示例数据仅用于本地排版检查',source=helper.SOURCE,caption=helper.CAPTION+'\n来源：'+helper.SOURCE,poster='./assets/01-poster.png',editorial=editorial(layout))
        if layout=='steps':
            manifest['editorial']['sections']=[
                {'heading':'核对原始来源','body':'先确认原文发布日期与数据出处，记录关键事实对应的段落，避免把转述误当作直接证据。'},
                {'heading':'统一比较口径','body':'检查预测数据与已披露结果的时间区间、计量单位和业务范围，再决定是否适合放在一起比较。'},
                {'heading':'评估实际影响','body':'结合自身业务场景核对适用条件，先做小范围验证并记录效果，再判断是否扩大投入。'},
            ]
        if layout=='comparison':
            manifest['editorial']['comparison']={'label':'测试季度预测数据','left':{'name':'示例甲','value':'170','unit':'测试单位'},'right':{'name':'示例乙','value':'150–160','unit':'测试单位'}}
        path=folder/'share.json';path.write_text(json.dumps(manifest,ensure_ascii=False),encoding='utf-8')
        selected_scene=scene
        if layout=='steps':
            vertical=Image.new('RGB',(1536,2048),'#D4E0DE');vertical_draw=ImageDraw.Draw(vertical)
            for y in range(0,2048,64):
                for x in range(0,1536,64):
                    if (x//64+y//64)%2:vertical_draw.rectangle((x,y,x+63,y+63),fill='#B5CFCD')
            vertical_draw.rectangle((640,600,896,1800),fill='#467181')
            vertical_draw.rectangle((690,1280,846,1450),fill='#D39A32')
            selected_scene=directory/'neutral-test-scene-vertical.png';vertical.save(selected_scene)
        results.append(helper.RENDER.render(selected_scene,path))
    return results


class EditorialTests(unittest.TestCase):
    def setUp(self):
        self.f=helper.ShareTests('test_success_uses_single_image_newspic_and_exact_caption');self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.scene=self.f.task/'scene.png';Image.new('RGB',(1536,2048),'steelblue').save(self.scene)
        data=json.loads((self.f.task/'input.json').read_text(encoding='utf-8'));data['poster_layout']='editorial';self.f.write('input.json',data)

    def manifest(self,layout,maximum=False):
        value={**self.f.manifest,'editorial':editorial(layout,maximum)}
        if maximum:value.update(headline='题'*24,subtitle='结'*40)
        self.f.write('share.json',value)
        return value

    def test_all_layouts_actual_render_and_single_image_bridge_without_key_points(self):
        for layout in ('comparison','insight','steps'):
            with self.subTest(layout=layout):
                self.f.write('result.json',self.f.result);self.manifest(layout)
                result=helper.RENDER.render(self.scene,self.f.task/'share.json')
                meta=result['editorial'];self.assertEqual(meta['layout'],layout)
                self.assertGreaterEqual(meta['body_font_size'],42)
                self.assertGreaterEqual(meta['headline_font_size'],72)
                self.assertEqual(sum(r['role']=='step_number' for r in meta['text_regions']),3 if layout=='steps' else 0)
                for region in meta['text_regions']:
                    x,y,right,bottom=region['box'];self.assertTrue(0<=x<right<=1536 and 0<=y<bottom<=2048)
                    self.assertLessEqual(len(region['lines'])*region['line_step'],bottom-y)
                self.assertEqual(self.f.run_bridge()['status'],'succeeded')
                with Image.open(self.f.poster) as image:self.assertEqual(image.size,(1536,2048));self.assertEqual(image.getpixel((0,0)),(245,241,231))

    def test_header_conclusion_and_footer_pixels_preserved_across_layouts(self):
        images=[]
        for layout in ('comparison','insight','steps'):
            self.manifest(layout)
            helper.RENDER.render(self.scene,self.f.task/'share.json')
            with Image.open(self.f.poster) as image:images.append(image.convert('RGB'))
        for image in images[1:]:
            self.assertIsNone(ImageChops.difference(images[0].crop((0,0,1536,340)),image.crop((0,0,1536,340))).getbbox())
            self.assertIsNone(ImageChops.difference(images[0].crop((0,1954,1536,2048)),image.crop((0,1954,1536,2048))).getbbox())
        for image in images:
            header=image.crop((96,100,1440,225));footer=image.crop((96,1972,1440,2022))
            self.assertIsNotNone(ImageChops.difference(header,Image.new('RGB',header.size,(245,241,231))).getbbox())
            self.assertIsNotNone(ImageChops.difference(footer,Image.new('RGB',footer.size,(245,241,231))).getbbox())

    def test_editorial_output_and_metadata_are_deterministic(self):
        self.manifest('insight')
        first=helper.RENDER.render(self.scene,self.f.task/'share.json');pixels=self.f.poster.read_bytes()
        second=helper.RENDER.render(self.scene,self.f.task/'share.json')
        self.assertEqual(first,second);self.assertEqual(pixels,self.f.poster.read_bytes())

    def test_renderer_rejects_unknown_base_manifest_fields(self):
        value=self.manifest('comparison');value['unknown_field']='untrusted';self.f.write('share.json',value)
        with self.assertRaisesRegex(ValueError,'unknown fields'):helper.RENDER.render(self.scene,self.f.task/'share.json')
        self.f.assert_no_upload()

    def test_longest_legal_fields_render_all_layouts_at_readable_sizes(self):
        for layout in ('comparison','insight','steps'):
            with self.subTest(layout=layout):
                self.manifest(layout,maximum=True)
                result=helper.RENDER.render(self.scene,self.f.task/'share.json')
                self.assertGreaterEqual(result['editorial']['body_font_size'],42)
                self.assertGreaterEqual(result['editorial']['headline_font_size'],72)

    def test_comparison_uses_separate_values_units_and_full_period_label(self):
        self.manifest('comparison')
        meta=helper.RENDER.render(self.scene,self.f.task/'share.json')['editorial']
        regions={r['role']:r for r in meta['text_regions'] if not r['role'].startswith('section')}
        self.assertEqual(''.join(regions['comparison_label']['lines']),COMPARISON['label'])
        for side in ('left','right'):
            self.assertEqual(''.join(regions[side+'_value']['lines']),COMPARISON[side]['value'])
            self.assertEqual(''.join(regions[side+'_unit']['lines']),COMPARISON[side]['unit'])
            self.assertGreaterEqual(regions[side+'_value']['font_size'],64)

    def test_editorial_required_but_key_points_optional_and_legacy_editorial_valid(self):
        with self.assertRaises(ValueError):helper.RENDER.render(self.scene,self.f.task/'share.json')
        self.f.assert_no_upload()
        data=json.loads((self.f.task/'input.json').read_text(encoding='utf-8'));data.pop('poster_layout');self.f.write('input.json',data)
        self.f.write('result.json',self.f.result);self.manifest('insight')
        self.assertEqual(self.f.run_bridge()['status'],'succeeded')

    def test_strict_invalid_editorial_never_reaches_upload(self):
        bad_values=[None,{},[],{'layout':'unknown','sections':SECTIONS},{**editorial('insight'),'extra':1},{**editorial('insight'),'comparison':COMPARISON},{**editorial('steps'),'comparison':COMPARISON},{**editorial('comparison'),'comparison':None},{**editorial('insight'),'sections':SECTIONS[:1]},{**editorial('insight'),'sections':SECTIONS+[SECTIONS[0]]}]
        pair=editorial('comparison');pair['comparison']['right']['unit']='亿元';bad_values.append(pair)
        pair=editorial('comparison');pair['comparison']['left']['extra']=1;bad_values.append(pair)
        for field,value in [('heading','标'*13),('heading','English'),('body','短句'),('body','文'*51),('body','<b>这段文字包含不允许使用的标签</b>')]:
            bad=editorial('insight');bad['sections'][0][field]=value;bad_values.append(bad)
        for bad in bad_values:
            with self.subTest(bad=bad):
                self.f.write('result.json',self.f.result);self.f.write('share.json',{**self.f.manifest,'editorial':bad})
                with self.assertRaises(ValueError):helper.RENDER.render(self.scene,self.f.task/'share.json')
                self.f.assert_no_upload()

    def test_optional_key_points_still_validated(self):
        self.f.write('share.json',{**self.f.manifest,'editorial':editorial('insight'),'key_points':['短句']})
        with self.assertRaises(ValueError):helper.RENDER.render(self.scene,self.f.task/'share.json')
        self.f.assert_no_upload()

    def test_scene_crop_is_undistorted_and_lower_middle_survives(self):
        self.manifest('comparison')
        meta=helper.RENDER.render(self.scene,self.f.task/'share.json')['editorial']
        left,top,right,bottom=meta['scene_crop'];x,y,endx,endy=meta['scene_box']
        self.assertAlmostEqual(((right-left)*1536)/((bottom-top)*2048),(endx-x)/(endy-y),places=4)
        self.assertLess(top,0.625);self.assertGreater(bottom,0.625)

    def test_two_sections_reallocate_spare_space_to_scene(self):
        self.manifest('comparison');first=helper.RENDER.render(self.scene,self.f.task/'share.json')['editorial']
        value=self.manifest('comparison');value['editorial']['sections']=value['editorial']['sections'][:2];self.f.write('share.json',value)
        second=helper.RENDER.render(self.scene,self.f.task/'share.json')['editorial']
        self.assertGreater(second['scene_box'][3]-second['scene_box'][1],first['scene_box'][3]-first['scene_box'][1])

    def test_unreadable_word_fails_with_role_diagnostic(self):
        self.manifest('insight');value=json.loads((self.f.task/'share.json').read_text(encoding='utf-8'));value['headline']='W'*24;self.f.write('share.json',value)
        with self.assertRaisesRegex(ValueError,'headline:'):helper.RENDER.render(self.scene,self.f.task/'share.json')
        draw=ImageDraw.Draw(Image.new('RGB',(100,100)))
        with self.assertRaises(ValueError):fit_text(draw,'无法在狭窄范围完整排版',helper.RENDER.local_font(),10,10,target=48,minimum=42,max_lines=2)

    def test_editorial_preserves_latin_names_and_chinese_punctuation(self):
        draw=ImageDraw.Draw(Image.new('RGB',(1536,2048)))
        font=__import__('PIL.ImageFont',fromlist=['ImageFont']).truetype(str(helper.RENDER.local_font()),48)
        lines=wrap_editorial(draw,'比较 AMD 与 Intel 的业务表现，仍需核对实际增长来源。',font,700)
        self.assertTrue(any('Intel' in line for line in lines));self.assertFalse(any(line.startswith(('，','。','、')) for line in lines))

if __name__=='__main__':unittest.main()
