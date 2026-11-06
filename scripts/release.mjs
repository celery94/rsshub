import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { packAndCheck, root } from './package-utils.mjs';

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${manifest.version}`) {
  throw new Error('Release tag must match package.json version.');
}
const archive = packAndCheck(join(root, 'artifacts'));
const checksum = createHash('sha256').update(readFileSync(archive)).digest('hex');
const checksumPath = `${archive}.sha256`;
writeFileSync(checksumPath, `${checksum}  ${basename(archive)}\n`);
console.log(`Verified release package: ${archive}\nSHA-256: ${checksumPath}`);
