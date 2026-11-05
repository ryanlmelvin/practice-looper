import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeURL, createYouTubePlayer, fetchYouTubeTitle } from '../src/youtube.js';

test('extracts one video from supported YouTube link formats', () => {
  const id = 'M7lc1UVf-VE';
  for (const input of [
    id, `  ${id}  `,
    `https://www.youtube.com/watch?v=${id}`,
    `youtube.com/watch?v=${id}&list=PL123&t=4`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=share&t=13`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `http://youtube.com/v/${id}`,
  ]) assert.equal(parseYouTubeURL(input), id, input);
});

test('rejects malformed links, unrelated hosts, and missing video IDs', () => {
  for (const input of [
    null, undefined, 123, {}, '', '   ', 'short', 'ABCDEFGHIJKL', 'M7lc1UVf-VE!',
    'https://www.youtube.com/playlist?list=PL123',
    'https://youtube.com/watch', 'https://youtu.be/',
    'https://youtube.com.evil.example/watch?v=M7lc1UVf-VE',
    'https://evilyoutube.com/watch?v=M7lc1UVf-VE',
    'https://youtube.com@evil.example/watch?v=M7lc1UVf-VE',
    'https://evil.example@youtube.com/watch?v=M7lc1UVf-VE',
    'https://youtu.be/M7lc1UVf-VE/extra',
    'https://youtube.com/embed/M7lc1UVf-VE/extra',
    'https://youtube-nocookie.com/watch?v=M7lc1UVf-VE',
    'https://youtube.com:1234/watch?v=M7lc1UVf-VE',
    'javascript:alert(1)', 'ftp://youtube.com/watch?v=M7lc1UVf-VE',
  ]) assert.equal(parseYouTubeURL(input), null, String(input));
});

test('fetches only a bounded title without credentials and forwards cancellation', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const controller = new AbortController();
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ title: `  ${'A'.repeat(400)}  `, html: '<iframe></iframe>' }) };
  };
  assert.equal(await fetchYouTubeTitle('M7lc1UVf-VE', { signal: controller.signal }), 'A'.repeat(300));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.origin, 'https://www.youtube.com');
  assert.equal(requests[0].url.pathname, '/oembed');
  assert.equal(requests[0].url.searchParams.get('url'), 'https://www.youtube.com/watch?v=M7lc1UVf-VE');
  assert.equal(requests[0].url.searchParams.get('format'), 'json');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.signal, controller.signal);
  for (const input of ['', null, undefined, [], 'short', 'https://youtu.be/M7lc1UVf-VE']) {
    assert.equal(await fetchYouTubeTitle(input), '');
  }
  assert.equal(requests.length, 1);
});

test('missing, malformed, unavailable, and failed title responses fall back silently', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const metadata of [null, {}, { title: null }, { title: 42 }, { title: ['wrong'] }, { title: '   ' }]) {
    globalThis.fetch = async () => ({ ok: true, json: async () => metadata });
    assert.equal(await fetchYouTubeTitle('M7lc1UVf-VE'), '');
  }
  globalThis.fetch = async () => ({ ok: false, json: async () => { throw new Error('Do not read error bodies'); } });
  assert.equal(await fetchYouTubeTitle('M7lc1UVf-VE'), '');
  globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('Bad JSON'); } });
  assert.equal(await fetchYouTubeTitle('M7lc1UVf-VE'), '');
  globalThis.fetch = async () => { throw new Error('Offline or cancelled'); };
  assert.equal(await fetchYouTubeTitle('M7lc1UVf-VE'), '');
});

function mockWindow(t, ready = true) {
  const original = globalThis.window;
  const calls = [];
  let instance;
  class Player {
    constructor(element, options) {
      instance = this;
      this.options = options;
      this.state = 5;
      this.rate = 1;
      this.iframe = {};
      queueMicrotask(() => {
        if (ready) options.events.onReady({ target: this });
        else options.events.onError({ data: 101 });
      });
    }
    getIframe() { return this.iframe; }
    getAvailablePlaybackRates() { return [1, 0.5, 1.5]; }
    getPlaybackRate() { return this.rate; }
    getPlayerState() { return this.state; }
    getCurrentTime() { return 12.5; }
    getDuration() { return 90; }
    cueVideoById(value) { calls.push(['cue', value]); }
    playVideo() { calls.push(['play']); }
    pauseVideo() { calls.push(['pause']); }
    seekTo(...args) { calls.push(['seek', ...args]); }
    setPlaybackRate(value) { calls.push(['rate', value]); }
    destroy() { calls.push(['destroy']); }
  }
  globalThis.window = { YT: { Player }, location: { origin: 'https://example.org' } };
  t.after(() => {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  });
  return { calls, get instance() { return instance; } };
}

test('restores by cueing, confirms speed events, and ignores events after destruction', async t => {
  const mock = mockWindow(t);
  const states = [];
  const rates = [];
  const accepted = [];
  const adapter = await createYouTubePlayer({
    element: {}, videoId: 'M7lc1UVf-VE', startSeconds: 12.5,
    onStateChange: value => states.push(value),
    onRatesChange: value => rates.push(value),
    onRateChange: value => accepted.push(value),
  });
  t.after(() => adapter.destroy());
  assert.equal(mock.instance.options.playerVars.autoplay, 0);
  assert.equal(mock.instance.options.playerVars.controls, 1);
  assert.equal(mock.instance.options.playerVars.origin, 'https://example.org');
  assert.deepEqual(mock.calls, [['cue', { videoId: 'M7lc1UVf-VE', startSeconds: 12.5 }]]);
  assert.deepEqual(rates, [[0.5, 1, 1.5]]);
  assert.deepEqual(states, ['cued']);
  assert.equal(adapter.setRate(0.25), false);
  assert.equal(adapter.setRate(0.5), true);
  assert.deepEqual(accepted, [1]);
  mock.instance.rate = 0.5;
  mock.instance.options.events.onPlaybackRateChange({ data: 0.5 });
  assert.deepEqual(accepted, [1, 0.5]);
  adapter.seek(15);
  assert.deepEqual(mock.calls.at(-1), ['seek', 15, true]);
  adapter.load('abcdefghijk', 7.25);
  assert.equal(adapter.getVideoId(), 'abcdefghijk');
  assert.deepEqual(mock.calls.at(-1), ['cue', { videoId: 'abcdefghijk', startSeconds: 7.25 }]);
  adapter.destroy();
  mock.instance.options.events.onStateChange({ data: 1 });
  mock.instance.options.events.onPlaybackRateChange({ data: 1.5 });
  assert.deepEqual(states, ['cued']);
  assert.deepEqual(accepted, [1, 0.5]);
  assert.equal(adapter.getState(), 'unstarted');
});

test('rejects a failed embed before readiness and releases the player', async t => {
  const mock = mockWindow(t, false);
  const errors = [];
  await assert.rejects(createYouTubePlayer({
    element: {}, videoId: 'M7lc1UVf-VE', onError: message => errors.push(message),
  }), /owner does not allow/);
  assert.equal(errors.length, 1);
  assert.deepEqual(mock.calls, [['destroy']]);
});
