/** Exercise actual list position helpers against changing row geometry. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
function helper(name) {
  const start = source.indexOf(`    function ${name}(`);
  const end = source.indexOf('\n    }', start) + '\n    }'.length;
  assert.ok(start >= 0 && end > start);
  return runInNewContext(`(${source.slice(start, end).trim()})`);
}
const capture = helper('captureListPosition');
const restore = helper('restoreListPosition');
function list(ids, top = 0, height = 200) {
  const element = { scrollTop: top, getBoundingClientRect: () => ({ top: 100, bottom: 100 + height }) };
  element.ids = ids;
  element.querySelectorAll = () => element.ids.map((id, index) => ({
    getAttribute: () => String(id),
    getBoundingClientRect: () => ({ top: 100 + index * 44 - element.scrollTop, bottom: 144 + index * 44 - element.scrollTop }),
  }));
  return element;
}
const plain = value => JSON.parse(JSON.stringify(value));
const ids = Array.from({ length: 200 }, (_, index) => index + 1);
const original = list(ids, 1807);
const saved = capture(original);
assert.equal(saved.top, 1807);
assert.deepEqual(plain(saved.anchors), [{ id: '42', offset: -3 }, { id: '43', offset: 41 }, { id: '44', offset: 85 }]);
const returned = list(ids);
restore(returned, saved);
assert.equal(returned.scrollTop, 1807, 'normal return preserves exact partial-row offset');
returned.ids = ids.filter(id => id !== 42);
returned.scrollTop = 0;
restore(returned, saved);
assert.equal(returned.scrollTop, 1763, 'removed unread anchor restores a visible neighbor at its prior offset');
returned.ids = [1001, 1002, ...ids];
returned.scrollTop = 0;
restore(returned, saved);
assert.equal(returned.scrollTop, 1895, 'inserted rows do not move the saved article on screen');
returned.ids = [9001, 9002];
restore(returned, saved);
assert.equal(returned.scrollTop, 1807, 'if every anchor vanished, fall back to saved pixels');
restore(null, saved);
restore(returned, null);
assert.deepEqual(plain(capture(null)), { top: 0, anchors: [] });
assert.match(source, /readerOpen\.current[\s\S]*timer = setTimeout\(run, POLL_IDLE_MS\)/, 'list polling checks reader state');
console.log('PASS list position: partial rows, deep pagination, removed unread anchor, inserted rows, missing anchors, absent containers.');
