import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShareLink, readShareLink } from '../src/share-link.js';

const loop = { schema:1, source:'youtube', videoId:'M7lc1UVf-VE', a:12.5, b:25, position:20, rate:0.75, repeat:true };
test('share URLs contain a validated loop and start at A, clearing old query and fragment', () => {
  const url = new URL(createShareLink({ ...loop, title:'private history' }, 'https://example.com/app/?old=1#old'));
  assert.equal(url.search, '');
  assert.deepEqual(readShareLink(url.hash), { ...loop, position:12.5 });
  assert.equal(readShareLink('#other'), null);
});
test('invalid and oversized shared loops are rejected', () => {
  for (const hash of ['#share=bad', '#share=1.e30', '#share=1.' + 'a'.repeat(3000)]) assert.throws(() => readShareLink(hash));
  assert.throws(() => createShareLink({ ...loop, b:1 }, 'https://example.com/'));
});
