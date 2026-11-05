#!/usr/bin/env node
/** Offline structural validation. The private Python bridge also decodes the image before upload. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

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
  const fields = ['title','caption','source','headline','subtitle','poster'];
  if (Object.keys(manifest).some(key => !fields.includes(key)) || fields.some(key => typeof manifest[key] !== 'string' || !manifest[key].trim())) throw new Error('share.json requires only title, caption, source, headline, subtitle and poster strings.');
  for (const [key, limit] of [['title',32],['headline',24],['subtitle',40]]) {
    if ([...manifest[key]].length > limit || /[\r\n<>]/.test(manifest[key])) throw new Error(`${key} exceeds its length or plain-text constraint.`);
  }
  const url = new URL(manifest.source);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.href !== manifest.source || (source !== undefined && source !== manifest.source)) throw new Error('source must exactly match the normalized HTTP(S) source URL.');
  const caption = fs.readFileSync(check(path.join(dir,'caption.txt')), 'utf8').replace(/^\uFEFF/, '').trim();
  if (caption !== manifest.caption.trim()) throw new Error('caption.txt must match share.json caption.');
  const suffix = `来源：${manifest.source}`;
  if (!caption.endsWith(`\n${suffix}`)) throw new Error('Caption must end with a separate 来源：source URL line.');
  const body = caption.slice(0,-suffix.length).trim();
  const count = [...body.replace(/\s/g,'')].length;
  if (count < 100 || count > 200 || !/\p{Script=Han}/u.test(body) || /<[^>]*>|!\[[^\]]*\]\(/.test(caption)) throw new Error('Caption requires 100–200 characters of Chinese plain text, plus its source line.');
  if (!/^\.\/assets\/01-poster\.(png|jpg)$/.test(manifest.poster)) throw new Error('poster must be ./assets/01-poster.png or .jpg.');
  const poster = check(path.join(dir,manifest.poster));
  if (!fs.statSync(poster).isFile()) throw new Error('Poster must be a regular file.');
  const assets = check(path.join(dir,'assets'));
  if (fs.readdirSync(assets).length !== 1 || fs.readdirSync(assets)[0] !== path.basename(poster)) throw new Error('Assets must contain exactly one final poster and no extra files.');
  return {...manifest, caption, cover:poster, inline:[], digest:'', article_type:'newspic', image_count:1};
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
