import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, formatTime, validateSnapshot, restoreForDuration, createSettingsStore } from '../src/state.js';

const example = () => ({
  schema: 1, source: 'youtube', videoId: 'M7lc1UVf-VE',
  a: 10.5, b: 15.5, position: 12.25, rate: 0.5, repeat: true,
});

function memoryStorage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) };
}

test('time entry accepts seconds or minutes:seconds with decimal precision', () => {
  for (const [text, seconds] of [['0', 0], ['90', 90], ['2.5', 2.5], ['1:02.5', 62.5],
    ['12:00', 720], [' 0:00.5 ', 0.5]]) assert.equal(parseTime(text), seconds);
});

test('time entry rejects ambiguous, negative, malformed, and overflowing seconds fields', () => {
  for (const text of ['', ' ', '-1', '-0:10', '1:60', '2:60.5', '1:02:03', '1:', ':30',
    '1e3', 'Infinity', 'NaN', '1,5', '1.2.3', '1:2:3:4']) {
    assert.equal(Number.isNaN(parseTime(text)), true, text);
  }
});

test('time formatting handles minute boundaries and distinguishes editing from display', () => {
  assert.equal(formatTime(59.99), '0:59');
  assert.equal(formatTime(59.99, true), '1:00.0');
  assert.equal(formatTime(62.55, true), '1:02.6');
  assert.equal(formatTime(3600), '60:00');
  assert.equal(formatTime(NaN), '0:00');
  assert.equal(formatTime(-1, true), '0:00.0');
});

test('settings validation preserves a complete valid setup and removes unrelated data', () => {
  const input = { ...example(), token: 'not-settings', title: 'not-needed', extra: { arbitrary: true } };
  assert.deepEqual(validateSnapshot(input), example());
  assert.equal(input.token, 'not-settings');
});

test('settings validation rejects wrong versions, sources, and identifiers', () => {
  for (const patch of [{ schema: 0 }, { schema: 2 }, { schema: '1' }, { source: 'apple' },
    { videoId: '' }, { videoId: 'short' }, { videoId: 'abcdefghij!' },
    { videoId: ['M7lc1UVf-VE'] }, { videoId: 12345678901 }]) {
    assert.equal(validateSnapshot({ ...example(), ...patch }), null, JSON.stringify(patch));
  }
  for (const input of [undefined, null, false, [], 'settings']) assert.equal(validateSnapshot(input), null);
});

test('settings validation rejects invalid range, position, speed, and repeat values', () => {
  for (const patch of [{ a: -1 }, { a: '10.5' }, { a: null }, { a: NaN }, { a: 16 },
    { b: 10.5 }, { b: 10.99 }, { b: Infinity }, { b: 604801 }, { position: -1 },
    { position: 604801 }, { position: '12.25' }, { position: Infinity },
    { rate: 0 }, { rate: -0.5 }, { rate: Infinity }, { rate: 17 },
    { repeat: 'true' }, { repeat: 1 }, { repeat: undefined }]) {
    assert.equal(validateSnapshot({ ...example(), ...patch }), null, JSON.stringify(patch));
  }
  assert.notEqual(validateSnapshot({ ...example(), a: 15, b: 15.5, repeat: false }), null);
});

test('restoring validates points against actual loaded duration and clamps only position', () => {
  const original = { ...example(), position: 99 };
  assert.deepEqual(restoreForDuration(original, 20), { ...original, position: 20 });
  assert.equal(original.position, 99);
  assert.deepEqual(restoreForDuration(example(), 15.5), example());
  assert.equal(restoreForDuration(example(), 15.49), null);
  for (const duration of [0, -1, NaN, Infinity, '20']) {
    assert.equal(restoreForDuration(example(), duration), null);
  }
  assert.equal(restoreForDuration({ ...example(), b: 1 }, 20), null);
});

test('settings round-trip through app and path scoped storage without touching neighbors', () => {
  const storage = memoryStorage();
  storage.values.set('other-app:settings', 'preserve');
  const first = createSettingsStore(storage, '/practice-looper/');
  const second = createSettingsStore(storage, '/preview/');
  assert.equal(first.read(), null);
  first.write(example());
  assert.deepEqual(first.read(), example());
  assert.equal(second.read(), null);
  second.write({ ...example(), a: 40, b: 45, position: 42, repeat: false });
  assert.deepEqual(first.read(), example());
  assert.equal(second.read().a, 40);
  assert.equal(storage.values.get('other-app:settings'), 'preserve');
});

test('invalid saves cannot overwrite an earlier valid setup', () => {
  const storage = memoryStorage();
  const store = createSettingsStore(storage, '/practice-looper/');
  store.write(example());
  assert.throws(() => store.write({ ...example(), b: 2 }), /valid/);
  assert.deepEqual(store.read(), example());
});

test('malformed and unsupported stored data fail visibly for the caller to recover', () => {
  const storage = memoryStorage();
  const key = 'practice-looper:/practice-looper/:settings:v1';
  const store = createSettingsStore(storage, '/practice-looper/');
  storage.values.set(key, '{not-json');
  assert.throws(() => store.read(), SyntaxError);
  storage.values.set(key, JSON.stringify({ ...example(), schema: 2 }));
  assert.throws(() => store.read(), /invalid/);
});

test('storage failures propagate instead of claiming data was read or saved', () => {
  const failure = new Error('Storage unavailable');
  const store = createSettingsStore({ getItem() { throw failure; }, setItem() { throw failure; } }, '/practice-looper/');
  assert.throws(() => store.read(), error => error === failure);
  assert.throws(() => store.write(example()), error => error === failure);
});
