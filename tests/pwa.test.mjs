import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { setupPWA } from '../src/pwa.js';

const workerTemplate = await readFile(new URL('../scripts/sw-template.js', import.meta.url), 'utf8');

function createWorker({ failAsset = false } = {}) {
  const listeners = new Map();
  const cacheData = new Map();
  const downloads = [];
  let claimed = 0;
  let skipped = 0;
  const scope = 'https://example.test/practice-looper/';
  const caches = {
    async open(name) {
      if (!cacheData.has(name)) cacheData.set(name, new Map());
      const entries = cacheData.get(name);
      return {
        async put(url, response) { entries.set(url, response.clone()); },
        async match(url) { return entries.get(url)?.clone(); },
      };
    },
    async keys() { return [...cacheData.keys()]; },
    async delete(name) { return cacheData.delete(name); },
  };
  const self = {
    registration: { scope },
    clients: { async claim() { claimed++; } },
    async skipWaiting() { skipped++; },
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  vm.runInNewContext(workerTemplate.replace('__RELEASE__', 'release-b').replace('__PRECACHE__', JSON.stringify(['./index.html', './assets/app-ABCDEFGH.js'])), {
    self, caches, URL, Response,
    fetch: async (url) => {
      downloads.push(url);
      return new Response(failAsset && String(url).includes('/assets/') ? 'missing' : 'release-b', { status: failAsset && String(url).includes('/assets/') ? 404 : 200 });
    },
  });
  return {
    caches, cacheData, downloads,
    get claimed() { return claimed; }, get skipped() { return skipped; },
    async dispatch(type, value = {}) {
      let result;
      listeners.get(type)({ ...value, waitUntil(promise) { result = promise; }, respondWith(promise) { result = promise; } });
      return result;
    },
  };
}

test('worker installs a coherent release without activating it automatically', async () => {
  const worker = createWorker();
  await worker.dispatch('install');
  assert.equal(worker.downloads.length, 2);
  assert.ok(worker.downloads.every((url) => url.endsWith('?release=release-b')));
  assert.equal(worker.skipped, 0);
  const cache = await worker.caches.open('practice-looper:/practice-looper/:release-b');
  assert.equal(await (await cache.match('https://example.test/practice-looper/index.html')).text(), 'release-b');
  await worker.dispatch('message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(worker.skipped, 1);
});

test('a failed required download preserves the old release and unrelated apps', async () => {
  const worker = createWorker({ failAsset: true });
  await worker.caches.open('practice-looper:/practice-looper/:release-a');
  await worker.caches.open('other-app:release-a');
  await assert.rejects(worker.dispatch('install'), /Required app asset failed/);
  assert.deepEqual(await worker.caches.keys(), ['practice-looper:/practice-looper/:release-a', 'other-app:release-a']);
});

test('activation retains old hashed assets for other open windows', async () => {
  const worker = createWorker();
  const oldCache = await worker.caches.open('practice-looper:/practice-looper/:release-a');
  await oldCache.put('https://example.test/practice-looper/assets/app-OLDABCDE.js', new Response('old-module'));
  await worker.dispatch('install');
  await worker.dispatch('activate');
  assert.equal(worker.claimed, 1);
  const response = await worker.dispatch('fetch', { request: { method: 'GET', mode: 'cors', url: 'https://example.test/practice-looper/assets/app-OLDABCDE.js' } });
  assert.equal(await response.text(), 'old-module');
});

test('worker normalizes app navigation but bypasses streaming, recovery and other projects', async () => {
  const worker = createWorker();
  await worker.dispatch('install');
  const response = await worker.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: 'https://example.test/practice-looper/?song=anything' } });
  assert.equal(await response.text(), 'release-b');
  for (const url of ['https://www.youtube.com/embed/abcdefghijk', 'https://example.test/practice-looper/update.html', 'https://example.test/another-app/', 'https://example.test/practice-looper/unrelated.json']) {
    assert.equal(await worker.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url } }), undefined);
  }
});

class Element extends EventTarget {
  hidden = false;
  disabled = false;
  open = false;
  attributes = {};
  setAttribute(key, value) { this.attributes[key] = value; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
}

function setupPage(t, { save = async () => true, waiting = true } = {}) {
  const old = Object.fromEntries(['window', 'document', 'navigator'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const updates = [new Element(), new Element()];
  const install = new Element();
  const dialog = new Element();
  const media = Object.assign(new EventTarget(), { matches: false });
  const worker = Object.assign(new EventTarget(), { state: 'installed', postMessage() { worker.messages++; }, messages: 0 });
  const registration = Object.assign(new EventTarget(), { waiting: waiting ? worker : null, installing: null, async update() {} });
  const serviceWorker = Object.assign(new EventTarget(), { controller: {}, async register() { return registration; } });
  let reloads = 0;
  const window = Object.assign(new EventTarget(), { isSecureContext: true, matchMedia: () => media, setInterval() {}, location: { reload() { reloads++; } } });
  const document = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
    querySelectorAll: () => updates,
    querySelector: (selector) => selector === '#install-button' ? install : dialog,
  });
  const navigator = { serviceWorker, onLine: true };
  for (const [key, value] of Object.entries({ window, document, navigator })) Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => {
    for (const [key, descriptor] of Object.entries(old)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const messages = [];
  const api = setupPWA({ beforeUpdate: save, onStatus: (...args) => messages.push(args) });
  return { api, worker, registration, serviceWorker, updates, install, dialog, window, media, messages, get reloads() { return reloads; } };
}

test('an already waiting update is exposed and a failed save prevents activation', async (t) => {
  const page = setupPage(t, { save: async () => false });
  await Promise.resolve();
  assert.ok(page.updates.every((button) => !button.hidden));
  assert.equal(await page.api.applyUpdate(), false);
  assert.equal(page.worker.messages, 0);
  assert.equal(page.reloads, 0);
  assert.ok(page.updates.every((button) => !button.disabled));
  assert.equal(page.messages.length, 0, 'the save callback retains its own actionable error');
});

test('an accepted update saves before activation and reloads only once', async (t) => {
  let saved = false;
  const page = setupPage(t, { save: async () => { saved = true; return true; } });
  await Promise.resolve();
  page.worker.postMessage = () => assert.equal(saved, true);
  await page.api.applyUpdate();
  page.serviceWorker.dispatchEvent(new Event('controllerchange'));
  page.serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(page.reloads, 1);
});

test('another window updating never reloads this session until it accepts', async (t) => {
  const page = setupPage(t, { waiting: false });
  await Promise.resolve();
  page.serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(page.reloads, 0);
  assert.equal(page.updates[0].textContent, 'Reload update');
  await page.api.applyUpdate();
  assert.equal(page.reloads, 1);
});

test('stalled activation restores a retry and late activation does not reload', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = setupPage(t);
  await Promise.resolve();
  await page.api.applyUpdate();
  t.mock.timers.tick(12_001);
  assert.equal(page.updates[0].disabled, false);
  assert.match(page.messages.at(-1)[0], /did not finish/);
  page.serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(page.reloads, 0);
});

test('browser Install remains available without a native prompt and disappears on installation', async (t) => {
  const page = setupPage(t);
  assert.equal(page.install.hidden, false);
  page.install.dispatchEvent(new Event('click'));
  assert.equal(page.dialog.open, true);
  page.window.dispatchEvent(new Event('appinstalled'));
  assert.equal(page.install.hidden, true);
  assert.equal(page.dialog.open, false);
});
