import test from 'node:test';
import assert from 'node:assert/strict';
import { LoopController, validateRange } from '../src/loop-controller.js';

function fixture({ time = 10, state = 'paused', duration = 100 } = {}) {
  let now = 0;
  const events = [];
  const errors = [];
  const player = {
    time, state, duration, rate: 1, seeks: [], plays: 0,
    getCurrentTime() { return this.time; },
    getDuration() { return this.duration; },
    getState() { return this.state; },
    getRate() { return this.rate; },
    seek(target) { this.seeks.push(target); },
    play() { this.plays += 1; },
  };
  const controller = new LoopController({ player, now: () => now,
    onRepeatChange: (...args) => events.push(args), onError: message => errors.push(message) });
  controller.setRange(10, 15);
  function tick(ms = 80, values = {}) {
    now += ms;
    Object.assign(player, values);
    controller.tick();
  }
  return { controller, player, events, errors, tick };
}

test('range validation rejects non-numbers, reversed, too-short, and out-of-track points', () => {
  assert.equal(validateRange(0, 0.5, 10), true);
  assert.equal(validateRange(9.5, 10, 10), true);
  for (const args of [[0, 0.49, 10], [5, 5, 10], [6, 5, 10], [-1, 5, 10], [0, 11, 10],
    [NaN, 5, 10], [0, Infinity, 10], [null, 5, 10], ['0', 5, 10], [0, 1, 0]]) {
    assert.equal(validateRange(...args), false, JSON.stringify(args));
  }
});

test('enabling requires valid range and reports an error', () => {
  const f = fixture();
  f.controller.setRange(12, 12.1);
  assert.equal(f.controller.setEnabled(true), false);
  assert.equal(f.controller.enabled, false);
  assert.equal(f.errors.length, 1);
});

test('enabling paused playback may reposition but never starts sound', () => {
  const f = fixture({ time: 40 });
  assert.equal(f.controller.setEnabled(true), true);
  assert.deepEqual(f.player.seeks, [10]);
  assert.equal(f.player.plays, 0);
  f.tick(80, { time: 10 });
  f.tick(80, { time: 15 });
  assert.equal(f.player.seeks.length, 1);
  assert.equal(f.player.plays, 0);
});

test('cued and ended playback wait for user play before repositioning', () => {
  for (const state of ['cued', 'unstarted', 'ended']) {
    const f = fixture({ time: 0, state });
    f.controller.setEnabled(true);
    f.tick(80);
    assert.equal(f.player.seeks.length, 0);
    f.tick(80, { state: 'playing' });
    assert.deepEqual(f.player.seeks, [10]);
    assert.equal(f.player.plays, 0);
  }
});

test('crossing B seeks once and does not queue another seek before landing', () => {
  const f = fixture({ time: 14.9, state: 'playing' });
  f.controller.setEnabled(true);
  f.tick(80);
  f.tick(160, { time: 15.06 });
  assert.deepEqual(f.player.seeks, [10]);
  for (let index = 0; index < 12; index += 1) f.tick(80, { state: 'buffering' });
  assert.equal(f.player.seeks.length, 1);
  f.tick(80, { time: 10.1, state: 'playing' });
  f.tick(4800, { time: 14.9 });
  f.tick(160, { time: 15.06 });
  assert.deepEqual(f.player.seeks, [10, 10]);
  assert.equal(f.player.plays, 0);
});

test('paused playback at or beyond B is never forced to resume', () => {
  const f = fixture({ time: 14.9, state: 'playing' });
  f.controller.setEnabled(true);
  f.tick();
  f.tick(100, { time: 15, state: 'paused' });
  f.tick(1000, { state: 'ended' });
  assert.equal(f.player.seeks.length, 0);
  assert.equal(f.player.plays, 0);
});

test('buffering does not seek until playback resumes', () => {
  const f = fixture({ time: 14.9, state: 'playing' });
  f.controller.setEnabled(true);
  f.tick();
  f.tick(100, { time: 15, state: 'buffering' });
  assert.equal(f.player.seeks.length, 0);
  f.tick(2000, { state: 'playing' });
  assert.deepEqual(f.player.seeks, [10]);
});

test('a failed seek times out with retry feedback and leaves playback alone', () => {
  const f = fixture({ time: 40, state: 'playing' });
  f.controller.setEnabled(true);
  f.tick(9999, { state: 'buffering' });
  assert.equal(f.controller.enabled, true);
  f.tick(1);
  assert.equal(f.controller.enabled, false);
  assert.equal(f.errors.length, 1);
  assert.equal(f.player.seeks.length, 1);
  assert.equal(f.player.plays, 0);
});

test('a native-player seek outside A/B disables repeat instead of seeking back', () => {
  for (const target of [0, 70]) {
    const f = fixture({ time: 11, state: 'playing' });
    f.controller.setEnabled(true);
    f.tick();
    f.tick(80, { time: target });
    assert.equal(f.controller.enabled, false);
    assert.equal(f.player.seeks.length, 0);
    assert.match(f.events.at(-1)[1], /outside/);
  }
});

test('a native-player seek within A/B keeps repeat', () => {
  const f = fixture({ time: 11, state: 'playing' });
  f.controller.setEnabled(true);
  f.tick();
  f.tick(80, { time: 14 });
  assert.equal(f.controller.enabled, true);
  assert.equal(f.player.seeks.length, 0);
});

test('manual seeks replace pending seeks and disable repeat outside the range', () => {
  const f = fixture({ time: 40, state: 'playing' });
  f.controller.setEnabled(true);
  f.controller.manualSeek(12);
  assert.deepEqual(f.player.seeks, [10, 12]);
  assert.equal(f.controller.enabled, true);
  f.tick(80, { time: 12 });
  f.controller.manualSeek(50);
  assert.equal(f.controller.enabled, false);
  assert.deepEqual(f.player.seeks, [10, 12, 50]);
  assert.equal(f.player.plays, 0);
});

test('manual seeks reject invalid input and clamp to the track', () => {
  const f = fixture();
  assert.equal(f.controller.manualSeek(NaN), false);
  f.controller.manualSeek(-1);
  f.controller.manualSeek(200);
  assert.deepEqual(f.player.seeks, [0, 100]);
});

test('natural track end can restart a loop ending at the duration', () => {
  const f = fixture({ time: 99.8, state: 'playing' });
  f.controller.setRange(95, 100);
  f.controller.setEnabled(true);
  f.tick();
  f.tick(200, { time: 100, state: 'ended' });
  assert.deepEqual(f.player.seeks, [95]);
  assert.equal(f.player.plays, 1);
  f.tick(80);
  assert.equal(f.player.plays, 1);
});

test('a manual jump to track end does not restart sound', () => {
  const f = fixture({ time: 50, state: 'playing' });
  f.controller.setRange(40, 100);
  f.controller.setEnabled(true);
  f.tick();
  f.tick(80, { time: 100, state: 'ended' });
  assert.equal(f.controller.enabled, false);
  assert.equal(f.player.plays, 0);
});

test('speed changes use elapsed media time, including a delayed poll', () => {
  const f = fixture({ time: 10, state: 'playing' });
  f.controller.setEnabled(true);
  f.tick();
  f.tick(2400, { time: 14.8, rate: 2 });
  assert.equal(f.controller.enabled, true);
  f.tick(200, { time: 15.2 });
  assert.deepEqual(f.player.seeks, [10]);
});

test('editing to an invalid range stops repeat; a changed valid range is used', () => {
  const f = fixture({ time: 12, state: 'playing' });
  f.controller.setEnabled(true);
  f.controller.setRange(20, 30);
  f.tick();
  assert.deepEqual(f.player.seeks, [20]);
  assert.equal(f.controller.setRange(30, 20), false);
  assert.equal(f.controller.enabled, false);
  f.tick(10000, { time: 30 });
  assert.equal(f.errors.length, 0);
});

test('changed video duration invalidates points', () => {
  const f = fixture({ state: 'playing' });
  f.controller.setEnabled(true);
  f.tick(80, { duration: 12 });
  assert.equal(f.controller.enabled, false);
  assert.match(f.events.at(-1)[1], /do not fit/);
});

test('reset and destroy discard pending work and cannot produce a late seek', () => {
  const f = fixture({ time: 40, state: 'playing' });
  f.controller.setEnabled(true);
  f.controller.reset();
  assert.equal(f.controller.enabled, false);
  assert.equal(f.controller.a, null);
  f.tick(10000);
  assert.equal(f.errors.length, 0);
  f.controller.destroy();
  assert.equal(f.controller.setEnabled(true), false);
  assert.equal(f.controller.manualSeek(15), false);
});
