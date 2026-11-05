#!/usr/bin/env node
/** Offline structural validation. The private Python bridge also decodes every image before upload. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const IMAGES_FIELDS = ['title', 'source', 'caption', 'images'];
const LEGACY_FIELDS = ['title', 'caption', 'source', 'headline', 'subtitle', 'poster', 'key_points', 'editorial'];
const BLOCK_TYPES = ['quote', 'metrics', 'cards', 'text', 'scene', 'material'];
const THEME_COLORS = ['background', 'ink', 'muted', 'accent', 'card'];
const DEFAULT_THEME = {background: '#F5F1E7', ink: '#14283D', muted: '#536779', accent: '#D39A32', card: '#FCFAF4', radius: 18};
const DEFAULT_WIDTH = 1536;
const DEFAULT_HEIGHT = 2048;
const MIN_SIDE = 1080;
const MAX_WIDTH = 2048;
const MAX_HEIGHT = 2560;
const MAX_IMAGES = 3;
const ASSET_PATH = /^\.\/assets\/(\d{2})-([a-z0-9][a-z0-9-]{0,23})\.(png|jpg)$/;
const SCENE_PATH = /^\.\/scenes\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(png|jpg|jpeg)$/;
const MATERIAL_PATH = /^\.\/materials\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(png|jpg|jpeg)$/;
const COLOR = /^#[0-9A-Fa-f]{6}$/;
const HAN = /\p{Script=Han}/u;
const CONTROL = /[\x00-\x1f\x7f<>`]|\*\*|!\[|\]\(/;

const count = value => [...value].length;

function plainText(value, minimum, maximum, {chinese = false, field = 'text'} = {}) {
  if (typeof value !== 'string' || value !== value.trim()) throw new Error(`${field} must be a trimmed string.`);
  if (count(value) < minimum || count(value) > maximum) throw new Error(`${field} requires ${minimum}–${maximum} plain-text codepoints.`);
  if (CONTROL.test(value)) throw new Error(`${field} must be plain text without markup or control characters.`);
  if (chinese && !HAN.test(value)) throw new Error(`${field} must contain Chinese.`);
  return value;
}

function exactObject(value, required, optional = [], field = 'object') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  const missing = required.filter(key => !Object.hasOwn(value, key));
  const unknown = Object.keys(value).filter(key => !required.includes(key) && !optional.includes(key));
  if (missing.length || unknown.length) throw new Error(`${field} has missing or unknown fields.`);
  return value;
}

const normalizeProse = text => text.replace(/[\s\u3000]+/g, '');

function missingQuoteSegments(text, cachedContent) {
  if (typeof cachedContent !== 'string' || !cachedContent.trim()) return [];
  const haystack = normalizeProse(cachedContent);
  return text.split(/…+|\.{3,}|⋯+/).filter(Boolean)
    .filter(part => normalizeProse(part).length >= 4 && !haystack.includes(normalizeProse(part)));
}

function validateTheme(value) {
  if (value === undefined) return undefined;
  exactObject(value, [], [...THEME_COLORS, 'radius'], 'theme');
  const theme = {...DEFAULT_THEME};
  for (const key of THEME_COLORS) {
    if (Object.hasOwn(value, key)) {
      if (typeof value[key] !== 'string' || !COLOR.test(value[key])) throw new Error('Theme colors must be #RRGGBB strings.');
      theme[key] = value[key].toUpperCase();
    }
  }
  if (Object.hasOwn(value, 'radius')) {
    if (!Number.isInteger(value.radius) || value.radius < 0 || value.radius > 48) throw new Error('Theme radius must be an integer between 0 and 48.');
    theme.radius = value.radius;
  }
  return theme;
}

function validateBlock(block, cachedContent) {
  if (!block || typeof block !== 'object' || Array.isArray(block) || !BLOCK_TYPES.includes(block.type)) throw new Error('Each block requires a supported type.');
  if (block.type === 'quote') {
    exactObject(block, ['type', 'text'], ['from'], 'quote');
    const normalized = {type: 'quote', text: plainText(block.text, 8, 120, {field: 'quote text'})};
    if (Object.hasOwn(block, 'from')) normalized.from = plainText(block.from, 1, 20, {field: 'quote from'});
    if (missingQuoteSegments(normalized.text, cachedContent).length) throw new Error('Quote text must appear verbatim in the cached article; use text blocks for paraphrase.');
    return normalized;
  }
  if (block.type === 'metrics') {
    exactObject(block, ['type', 'items'], [], 'metrics');
    if (!Array.isArray(block.items) || !block.items.length || block.items.length > 4) throw new Error('metrics requires one to four items.');
    const items = block.items.map(item => {
      exactObject(item, ['value', 'label'], [], 'metrics item');
      plainText(item.value, 1, 8, {field: 'metric value'});
      if (!/\d/.test(item.value)) throw new Error('Each metric value must contain a digit.');
      plainText(item.label, 2, 12, {chinese: true, field: 'metric label'});
      return {value: item.value, label: item.label};
    });
    return {type: 'metrics', items};
  }
  if (block.type === 'cards') {
    exactObject(block, ['type', 'items'], [], 'cards');
    if (!Array.isArray(block.items) || !block.items.length || block.items.length > 5) throw new Error('cards requires one to five items.');
    const items = block.items.map(item => {
      exactObject(item, ['heading', 'body'], [], 'cards item');
      plainText(item.heading, 1, 12, {chinese: true, field: 'card heading'});
      plainText(item.body, 12, 80, {chinese: true, field: 'card body'});
      return {heading: item.heading, body: item.body};
    });
    return {type: 'cards', items};
  }
  if (block.type === 'text') {
    exactObject(block, ['type', 'body'], [], 'text');
    return {type: 'text', body: plainText(block.body, 12, 160, {chinese: true, field: 'text body'})};
  }
  if (block.type === 'scene') {
    exactObject(block, ['type', 'path'], ['alt'], 'scene');
    if (typeof block.path !== 'string' || !SCENE_PATH.test(block.path)) throw new Error('Scene path must be ./scenes/<name>.png, .jpg or .jpeg.');
    const normalized = {type: 'scene', path: block.path};
    if (Object.hasOwn(block, 'alt')) normalized.alt = plainText(block.alt, 1, 40, {field: 'scene alt'});
    return normalized;
  }
  exactObject(block, ['type', 'path'], ['caption'], 'material');
  if (typeof block.path !== 'string' || !MATERIAL_PATH.test(block.path)) throw new Error('Material path must be ./materials/<name>.png, .jpg or .jpeg.');
  const normalized = {type: 'material', path: block.path};
  if (Object.hasOwn(block, 'caption')) normalized.caption = plainText(block.caption, 1, 40, {field: 'material caption'});
  return normalized;
}

export function validateImagesManifest(manifest, {source, cachedContent} = {}) {
  const field = 'share.json';
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error(`${field} must be an object.`);
  const unknown = Object.keys(manifest).filter(key => !IMAGES_FIELDS.includes(key));
  const missing = IMAGES_FIELDS.filter(key => !Object.hasOwn(manifest, key));
  if (unknown.length || missing.length) throw new Error('Multi-image share manifests accept only title, source, caption and images.');
  const title = plainText(manifest.title, 1, 32, {field: 'title'});
  const sourceUrl = validateSource(manifest.source);
  if (source !== undefined && sourceUrl !== source) throw new Error('source must exactly match the normalized task source URL.');
  validateCaption(manifest.caption, sourceUrl);
  if (!Array.isArray(manifest.images) || !manifest.images.length || manifest.images.length > MAX_IMAGES) throw new Error('images requires one to three entries.');
  const images = manifest.images.map((entry, index) => {
    exactObject(entry, ['file', 'headline', 'blocks'], ['kicker', 'subtitle', 'theme', 'width', 'height'], 'image');
    const match = typeof entry.file === 'string' ? ASSET_PATH.exec(entry.file) : null;
    if (!match || Number(match[1]) !== index + 1) throw new Error('Image file must be ./assets/NN-<slug>.png or .jpg with NN matching its order.');
    const image = {file: entry.file, headline: plainText(entry.headline, 1, 24, {field: 'headline'})};
    if (Object.hasOwn(entry, 'kicker')) image.kicker = plainText(entry.kicker, 2, 8, {chinese: true, field: 'kicker'});
    if (Object.hasOwn(entry, 'subtitle')) image.subtitle = plainText(entry.subtitle, 1, 40, {field: 'subtitle'});
    if (!Array.isArray(entry.blocks) || !entry.blocks.length || entry.blocks.length > 6) throw new Error('Each image requires one to six blocks.');
    image.blocks = entry.blocks.map(block => validateBlock(block, cachedContent));
    const types = image.blocks.map(block => block.type);
    if (!types.includes('quote') && !types.includes('material')) throw new Error('Each image needs at least one quote or material block from the source article.');
    if (types.filter(type => type === 'scene').length > 1 || types.filter(type => type === 'material').length > 2) throw new Error('Each image accepts at most one scene and two material blocks.');
    const theme = validateTheme(entry.theme);
    if (theme) image.theme = theme;
    const width = entry.width ?? DEFAULT_WIDTH;
    const height = entry.height ?? DEFAULT_HEIGHT;
    for (const [value, maximum, name] of [[width, MAX_WIDTH, 'width'], [height, MAX_HEIGHT, 'height']]) {
      if (!Number.isInteger(value) || value < MIN_SIDE || value > maximum) throw new Error(`Image ${name} must be an integer between ${MIN_SIDE} and ${maximum}.`);
    }
    image.width = width;
    image.height = height;
    return image;
  });
  const files = images.map(image => image.file);
  if (new Set(files).size !== files.length) throw new Error('Image files must be unique.');
  return {title, source: sourceUrl, caption: manifest.caption, images};
}

function validateSource(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.href !== value) throw new Error('source must exactly match the normalized HTTP(S) source URL.');
  return value;
}

function validateCaption(caption, source) {
  const suffix = `来源：${source}`;
  if (typeof caption !== 'string' || !caption.endsWith(`\n${suffix}`)) throw new Error('Caption must end with a separate 来源：source URL line.');
  const body = caption.slice(0, -suffix.length).trim();
  const length = count(body.replace(/\s/g, ''));
  if (length < 100 || length > 200 || !HAN.test(body) || /<[^>]*>|!\[[^\]]*\]\(/.test(caption)) throw new Error('Caption requires 100–200 characters of Chinese plain text, plus its source line.');
}

export function validateKeyPoints(points, required = false, present = points !== undefined) {
  if (!required && !present) return;
  if (!Array.isArray(points) || points.length < 2 || points.length > 3) throw new Error('Content posters require two or three key_points.');
  for (const point of points) {
    if (typeof point !== 'string' || point !== point.trim() || count(point) < 12 || count(point) > 50 || !HAN.test(point) || CONTROL.test(point) || /[\x00-\x1f\x7f]/.test(point)) throw new Error('key_points must be Chinese plain text of 12–50 codepoints.');
  }
}
function editorialObject(value, required, optional=[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(key=>!Object.hasOwn(value,key)) || Object.keys(value).some(key=>![...required,...optional].includes(key))) throw new Error('Editorial objects contain missing or unknown fields.');
}
function editorialText(value,min,max,chinese=false) {
  if (typeof value !== 'string' || value !== value.trim() || count(value) < min || count(value) > max || CONTROL.test(value) || (chinese && !HAN.test(value))) throw new Error(`Editorial text requires ${min}–${max} plain-text codepoints${chinese?' containing Chinese':''}.`);
}
export function validateEditorial(value,required=false,present=value!==undefined) {
  if(!required && !present) return;
  editorialObject(value,['layout','sections'],['comparison','kicker','highlights']);
  if(!['comparison','insight','steps'].includes(value.layout)) throw new Error('Editorial layout must be comparison, insight or steps.');
  if(Object.hasOwn(value,'kicker')) editorialText(value.kicker,2,8,true);
  if(Object.hasOwn(value,'highlights')){
    if(value.layout==='comparison') throw new Error('The comparison layout already shows its metrics; highlights are not accepted.');
    if(!Array.isArray(value.highlights) || value.highlights.length<2 || value.highlights.length>3) throw new Error('Editorial highlights require two or three items.');
    for(const item of value.highlights){editorialObject(item,['value','label']);editorialText(item.value,1,8);editorialText(item.label,2,12,true);if(!/\d/.test(item.value))throw new Error('Each highlight value must contain a number from the source.');}
  }
  if(!Array.isArray(value.sections) || value.sections.length<2 || value.sections.length>5) throw new Error('Editorial requires two to five sections.');
  for(const section of value.sections){editorialObject(section,['heading','body']);editorialText(section.heading,1,12,true);editorialText(section.body,12,80,true);}
  if(value.layout==='comparison'){
    const pair=value.comparison;editorialObject(pair,['label','left','right']);editorialText(pair.label,1,24);
    for(const side of ['left','right']){editorialObject(pair[side],['name','value','unit']);for(const [key,max] of [['name',12],['value',16],['unit',12]])editorialText(pair[side][key],1,max);}
    if(pair.left.unit!==pair.right.unit)throw new Error('Comparison units must match exactly.');
  }else if(Object.hasOwn(value,'comparison'))throw new Error('Only the comparison layout accepts comparison metrics.');
}

export function readShare(taskDir, {source} = {}) {
  const dir = path.resolve(taskDir);
  const check = file => {
    const absolute = path.resolve(file);
    const rel = path.relative(dir, absolute);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Share paths must remain inside the task.');
    for (let current = absolute;; current = path.dirname(current)) {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Share symbolic links and junctions are forbidden.');
      if (path.dirname(current) === current) break;
    }
    return absolute;
  };
  check(dir);
  const input = JSON.parse(fs.readFileSync(check(path.join(dir, 'input.json')), 'utf8').replace(/^\uFEFF/, ''));
  if (input.version !== 1 || input.mode !== 'rss-share' || input.task_id !== path.basename(dir) || typeof input.source_url !== 'string') throw new Error('Share input must match this task directory.');
  if (source !== undefined && source !== input.source_url) throw new Error('Share input source does not match the requested source.');
  source = input.source_url;
  const manifest = JSON.parse(fs.readFileSync(check(path.join(dir, 'share.json')), 'utf8').replace(/^\uFEFF/, ''));
  if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') throw new Error('share.json must be an object.');
  const caption = fs.readFileSync(check(path.join(dir,'caption.txt')), 'utf8').replace(/^\uFEFF/, '').trim();

  if (Object.hasOwn(manifest, 'images')) {
    if (Object.hasOwn(manifest, 'poster') || Object.hasOwn(manifest, 'editorial') || Object.hasOwn(manifest, 'key_points')) throw new Error('Multi-image share manifests cannot mix legacy poster or key_points fields.');
    let normalized;
    try { normalized = validateImagesManifest(manifest, {source, cachedContent: input.cached_content}); }
    catch (error) { throw new Error(error.message); }
    if (caption !== manifest.caption.trim()) throw new Error('caption.txt must match share.json caption.');
    validateCaption(caption, manifest.source);
    const files = normalized.images.map(image => check(path.join(dir, image.file)));
    files.forEach((file, index) => {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('Final poster images must exist inside this task.');
      for (const block of normalized.images[index].blocks) {
        if (block.type !== 'scene' && block.type !== 'material') continue;
        const assetFile = check(path.join(dir, block.path));
        if (!fs.existsSync(assetFile) || !fs.statSync(assetFile).isFile()) throw new Error('Scene and material images must exist inside this task.');
      }
    });
    const assets = check(path.join(dir, 'assets'));
    const names = fs.readdirSync(assets).sort();
    const expected = files.map(file => path.basename(file)).sort();
    if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) throw new Error('Assets must contain exactly the final poster images and no extra files.');
    return {
      ...manifest, caption,
      images: files,
      image_paths: normalized.images.map(image => image.file),
      image_count: normalized.images.length,
      cover: files[0],
      poster: normalized.images[0].file,
      inline: [],
      digest: '',
      article_type: 'newspic',
    };
  }

  const fields = ['title','caption','source','headline','subtitle','poster'];
  if (Object.keys(manifest).some(key => ![...fields,'key_points','editorial'].includes(key)) || fields.some(key => typeof manifest[key] !== 'string' || !manifest[key].trim())) throw new Error('share.json requires title, caption, source, headline, subtitle and poster strings; key_points and editorial are the optional fields.');
  if (Object.hasOwn(input,'poster_layout') && !['content','editorial'].includes(input.poster_layout)) throw new Error('poster_layout must be content or editorial when provided.');
  validateKeyPoints(manifest.key_points, input.poster_layout === 'content', Object.hasOwn(manifest,'key_points'));
  validateEditorial(manifest.editorial, input.poster_layout === 'editorial', Object.hasOwn(manifest,'editorial'));
  for (const [key, limit] of [['title',32],['headline',24],['subtitle',40]]) {
    if (count(manifest[key]) > limit || /[\r\n<>]/.test(manifest[key])) throw new Error(`${key} exceeds its length or plain-text constraint.`);
  }
  validateSource(manifest.source);
  if (source !== undefined && source !== manifest.source) throw new Error('source must exactly match the normalized HTTP(S) source URL.');
  if (caption !== manifest.caption.trim()) throw new Error('caption.txt must match share.json caption.');
  validateCaption(caption, manifest.source);
  if (!/^\.\/assets\/01-poster\.(png|jpg)$/.test(manifest.poster)) throw new Error('poster must be ./assets/01-poster.png or .jpg.');
  const poster = check(path.join(dir,manifest.poster));
  if (!fs.statSync(poster).isFile()) throw new Error('Poster must be a regular file.');
  const assets = check(path.join(dir,'assets'));
  if (fs.readdirSync(assets).length !== 1 || fs.readdirSync(assets)[0] !== path.basename(poster)) throw new Error('Assets must contain exactly one final poster and no extra files.');
  return {...manifest, caption, cover:poster, images:[poster], image_paths:[manifest.poster], image_count:1, inline:[], digest:'', article_type:'newspic'};
}

export function validateShare(taskDir, options = {}) {
  try { readShare(taskDir,options); return []; } catch (error) { return [error.message]; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const errors = args.length === 1 ? validateShare(args[0]) : ['Usage: validate-share.mjs <task-directory>'];
  console.log(JSON.stringify({ok:!errors.length,errors}));
  if (errors.length) process.exitCode = 1;
}
