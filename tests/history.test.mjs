import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryStore, historyKey, segmentKey } from '../src/history.js';

const path = '/practice-looper/';
const example = (patch = {}) => ({
  schema: 1, source: 'youtube', videoId: 'M7lc1UVf-VE',
  a: 10.5, b: 15.5, position: 12.25, rate: 0.5, repeat: true, ...patch,
});

function memoryStorage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test('history persists complete segments with newest practice first', () => {
  const storage = memoryStorage();
  const store = createHistoryStore(storage, path);
  assert.deepEqual(store.read(), []);
  store.record(example(), { title: ' First video ', practicedAt: 20 });
  store.record(example({ videoId: 'abcdefghijk' }), { title: 'Second video', practicedAt: 40 });
  store.record(example({ a: 30, b: 40 }), { title: 'First video', practicedAt: 30 });
  const entries = createHistoryStore(storage, path).read();
  assert.deepEqual(entries.map(entry => entry.practicedAt), [40, 30, 20]);
  assert.deepEqual(entries[2], { ...example(), title: 'First video', practicedAt: 20 });
  assert.equal(new Set(entries.map(segmentKey)).size, 3);
});

test('revisiting a segment moves it to the top and updates settings without duplicating it', () => {
  const store = createHistoryStore(memoryStorage(), path);
  store.record(example(), { title: 'Video title', practicedAt: 1 });
  store.record(example({ a: 30, b: 40 }), { practicedAt: 2 });
  const updated = example({ position: 14, rate: 0.75, repeat: false });
  const entries = store.record(updated, { practicedAt: 3 });
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { ...updated, title: 'Video title', practicedAt: 3 });
  assert.deepEqual(store.read(), entries);
});

test('each write includes other windows’ latest history', () => {
  const storage = memoryStorage();
  const firstWindow = createHistoryStore(storage, path);
  const secondWindow = createHistoryStore(storage, path);
  firstWindow.read();
  secondWindow.record(example(), { practicedAt: 1 });
  firstWindow.record(example({ a: 30, b: 40 }), { practicedAt: 2 });
  assert.deepEqual(secondWindow.read().map(entry => entry.a), [30, 10.5]);
});

test('stale window saves preserve newer practice settings, recency, and titles', () => {
  const storage = memoryStorage();
  const olderWindow = createHistoryStore(storage, path);
  const newerWindow = createHistoryStore(storage, path);
  olderWindow.record(example(), { practicedAt: 1 });
  newerWindow.record(example({ position: 14, rate: 1, repeat: false }), { title: 'Current title', practicedAt: 3 });
  newerWindow.record(example({ a: 30, b: 40 }), { practicedAt: 2 });
  const entries = olderWindow.record(example(), { title: 'Old title', practicedAt: 1 });
  assert.deepEqual(entries[0], {
    ...example({ position: 14, rate: 1, repeat: false }), title: 'Current title', practicedAt: 3,
  });
  assert.equal(entries.length, 2);
  // A late metadata response may still fill an otherwise missing title.
  const otherSegment = example({ a: 30, b: 40 });
  const enriched = olderWindow.record(otherSegment, { title: 'Found title', practicedAt: 0 });
  assert.equal(enriched[1].practicedAt, 2);
  assert.equal(enriched[1].title, 'Found title');
});

test('history reads skip invalid rows, remove unrelated data, sort and deduplicate', () => {
  const storage = memoryStorage();
  storage.setItem(historyKey(path), JSON.stringify([
    { ...example(), title: 'Old title', practicedAt: 1 },
    null,
    { ...example(), title: 'Wrong time', practicedAt: '3' },
    { ...example(), title: 'Negative time', practicedAt: -1 },
    { ...example(), title: 5, practicedAt: 3 },
    { ...example(), b: 0, title: 'Wrong range', practicedAt: 3 },
    { ...example(), title: '  New title  ', practicedAt: 4, unrelated: 'discard' },
    { ...example({ a: 30, b: 40 }), title: 'Other passage', practicedAt: 2 },
  ]));
  const entries = createHistoryStore(storage, path).read();
  assert.deepEqual(entries, [
    { ...example(), title: 'New title', practicedAt: 4 },
    { ...example({ a: 30, b: 40 }), title: 'Other passage', practicedAt: 2 },
  ]);
});

test('history bounds titles and retains only the 100 most recently practiced segments', () => {
  const storage = memoryStorage();
  const store = createHistoryStore(storage, path);
  for (let i = 0; i < 105; i++) {
    store.record(example({ a: i, b: i + 5 }), { title: 'x'.repeat(500), practicedAt: i });
  }
  const entries = store.read();
  assert.equal(entries.length, 100);
  assert.equal(entries[0].a, 104);
  assert.equal(entries.at(-1).a, 5);
  assert.ok(entries.every(entry => entry.title.length === 300));
  assert.equal(JSON.parse(storage.getItem(historyKey(path))).length, 100);
});

test('record defaults to current time and an empty title', () => {
  const store = createHistoryStore(memoryStorage(), path);
  const before = Date.now();
  const [entry] = store.record(example());
  assert.equal(entry.title, '');
  assert.ok(entry.practicedAt >= before && entry.practicedAt <= Date.now());
});

test('history keys and clearing are isolated from settings and neighboring apps', () => {
  const storage = memoryStorage();
  const first = createHistoryStore(storage, path);
  const second = createHistoryStore(storage, '/preview/');
  storage.setItem('practice-looper:/practice-looper/:settings:v1', 'preserve');
  first.record(example(), { practicedAt: 1 });
  assert.deepEqual(second.read(), []);
  second.record(example({ a: 30, b: 40 }), { practicedAt: 2 });
  first.clear();
  assert.deepEqual(first.read(), []);
  assert.equal(second.read().length, 1);
  assert.equal(storage.getItem('practice-looper:/practice-looper/:settings:v1'), 'preserve');
});

test('removing one segment preserves other segments and other storage paths', () => {
  const storage = memoryStorage();
  const store = createHistoryStore(storage, path);
  const otherPath = createHistoryStore(storage, '/preview/');
  const otherWindow = createHistoryStore(storage, path);
  store.record(example(), { practicedAt: 1 });
  store.read();
  otherWindow.record(example({ a: 30, b: 40 }), { practicedAt: 2 });
  otherPath.record(example(), { practicedAt: 1 });
  const entries = store.remove(segmentKey(example()));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].a, 30);
  assert.deepEqual(store.read(), entries);
  assert.equal(otherPath.read().length, 1);
  assert.deepEqual(store.remove('unknown-segment'), entries);
  assert.deepEqual(store.remove(segmentKey(entries[0])), []);
});

test('invalid records cannot replace valid history', () => {
  const store = createHistoryStore(memoryStorage(), path);
  const original = store.record(example(), { practicedAt: 1 });
  for (const patch of [{ b: 0 }, { videoId: 'invalid' }, { rate: 0 }]) {
    assert.throws(() => store.record(example(patch)), /valid/);
  }
  for (const options of [{ title: null }, { practicedAt: -1 }, { practicedAt: Infinity }, { practicedAt: '2' }]) {
    assert.throws(() => store.record(example(), options), /valid/);
  }
  assert.deepEqual(store.read(), original);
});

test('malformed history roots produce actionable errors and are never overwritten', () => {
  const storage = memoryStorage();
  const store = createHistoryStore(storage, path);
  for (const raw of ['{not-json', '{}', 'null', '42', '"history"', '']) {
    storage.setItem(historyKey(path), raw);
    assert.throws(() => store.read(), /history is invalid/);
    assert.throws(() => store.record(example()), /history is invalid/);
    assert.equal(storage.getItem(historyKey(path)), raw);
  }
});

test('history storage failures propagate without claiming a successful save or clear', () => {
  const failure = new Error('Storage unavailable');
  const unavailable = createHistoryStore({ getItem() { throw failure; } }, path);
  assert.throws(() => unavailable.read(), error => error === failure);
  assert.throws(() => unavailable.record(example()), error => error === failure);
  assert.throws(() => unavailable.remove(segmentKey(example())), error => error === failure);
  const unwritable = createHistoryStore({ getItem: () => null,
    setItem() { throw failure; }, removeItem() { throw failure; } }, path);
  assert.throws(() => unwritable.record(example()), error => error === failure);
  assert.throws(() => unwritable.remove(segmentKey(example())), error => error === failure);
  assert.throws(() => unwritable.clear(), error => error === failure);
});
