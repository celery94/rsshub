import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { packAndCheck } from './package-utils.mjs';

const destination = mkdtempSync(join(tmpdir(), 'rss-brief-package-check-'));
try { packAndCheck(destination); }
finally { rmSync(destination, { recursive: true, force: true }); }
