import { test as base, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const PREFIX = '/practice-looper/';
const SETTINGS_KEY = `practice-looper:${PREFIX}:settings:v1`;
const savedPractice = {
  schema: 1, source: 'youtube', videoId: 'M7lc1UVf-VE',
  a: 12.5, b: 17.5, position: 14.2, rate: 0.5, repeat: true,
};
const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

async function readBuiltFiles(directory, relative = '') {
  const entries = await readdir(join(directory, relative), { withFileTypes: true });
  const files = new Map();
  for (const entry of entries) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) {
      for (const [name, bytes] of await readBuiltFiles(directory, path)) files.set(name, bytes);
    } else files.set(path, await readFile(join(directory, path)));
  }
  return files;
}

// Each test serves immutable app assets plus independently generated A/B
// shells and workers. Production output is never rewritten by this fixture.
const test = base.extend({
  releaseServer: async ({}, use) => {
    const files = await readBuiltFiles(new URL('../../docs/', import.meta.url).pathname);
    const originalWorker = files.get('sw.js').toString();
    if (!/const RELEASE = '[^']+';/.test(originalWorker)) throw new Error('Build the worker before running the PWA tests.');
    let release = 'a';
    let failedAsset = null;
    const requests = [];
    const server = createServer((request, response) => {
      const url = new URL(request.url, 'http://localhost');
      requests.push(url.pathname);
      if (!url.pathname.startsWith(PREFIX)) { response.writeHead(404).end(); return; }
      let name = decodeURIComponent(url.pathname.slice(PREFIX.length)) || 'index.html';
      let body = files.get(name);
      if (name === failedAsset) { response.writeHead(503).end('Unavailable for this release test'); return; }
      if (!body) { response.writeHead(404).end('Not found'); return; }
      if (name === 'sw.js') {
        body = originalWorker.replace(/const RELEASE = '[^']+';/, `const RELEASE = 'fixture-${release}';`);
      } else if (name === 'index.html') {
        body = body.toString().replace('</head>', `<meta name="fixture-release" content="${release}"></head>`);
      }
      response.writeHead(200, {
        'Content-Type': contentTypes[extname(name)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        ...(name === 'sw.js' ? { 'Service-Worker-Allowed': PREFIX } : {}),
      });
      response.end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      await use({
        url: `http://127.0.0.1:${server.address().port}${PREFIX}`,
        publish(nextRelease) { release = nextRelease; },
        fail(name) { failedAsset = name; },
        files,
        requests,
      });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
});

async function waitForControl(page) {
  await expect.poll(() => page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    return {
      controlled: Boolean(navigator.serviceWorker.controller),
      active: Boolean(registrations[0]?.active),
    };
  }), { message: 'The real worker must install and control the page' }).toEqual({ controlled: true, active: true });
}

async function downloadUpdate(page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
    if (registration.waiting) return;
    await new Promise((resolve, reject) => {
      const worker = registration.installing;
      if (!worker) { reject(new Error('The second worker did not start installing.')); return; }
      const check = () => {
        if (worker.state === 'installed') resolve();
        if (worker.state === 'redundant') reject(new Error('The second worker failed to install.'));
      };
      worker.addEventListener('statechange', check);
      check();
    });
  });
}

test('installed app shell and saved setup reopen offline with a query string', async ({ page, context, releaseServer }) => {
  await page.goto(releaseServer.url);
  await waitForControl(page);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SETTINGS_KEY, value: savedPractice });
  await context.setOffline(true);
  await page.goto(`${releaseServer.url}?practice=offline`);
  await expect(page.locator('meta[name="fixture-release"]')).toHaveAttribute('content', 'a');
  await expect(page.locator('#video-url')).toHaveValue('https://www.youtube.com/watch?v=M7lc1UVf-VE');
  await expect(page.locator('#status')).toContainText('offline');
  await expect(page.locator('#workspace')).toBeHidden();
  await expect(page.locator('#install-button')).toBeVisible();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SETTINGS_KEY);
  expect(saved).toEqual(savedPractice);
});

test('two real releases expose waiting updates, preserve settings, and respect each window’s reload choice', async ({ page, context, releaseServer }) => {
  await context.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
    window.fixtureLoadCount = Number(sessionStorage.getItem('fixture-loads') || 0) + 1;
    sessionStorage.setItem('fixture-loads', String(window.fixtureLoadCount));
  }, { key: SETTINGS_KEY, value: savedPractice });
  await page.goto(releaseServer.url);
  await waitForControl(page);
  const firstLoadCount = await page.evaluate(() => window.fixtureLoadCount);
  releaseServer.publish('b');
  await downloadUpdate(page);
  await expect(page.locator('header [data-update]')).toBeVisible();
  await expect(page.locator('meta[name="fixture-release"]')).toHaveAttribute('content', 'a');

  const second = await context.newPage();
  await second.goto(releaseServer.url);
  await waitForControl(second);
  // Its worker was already waiting before this page's update controller ran.
  await expect(second.locator('header [data-update]')).toBeVisible();
  await expect(second.locator('meta[name="fixture-release"]')).toHaveAttribute('content', 'a');
  const secondLoadCount = await second.evaluate(() => window.fixtureLoadCount);

  // The downloaded update must also be usable after the network goes away.
  await context.setOffline(true);
  await page.locator('#about-button').click();
  await expect(page.locator('#about-dialog [data-update]')).toBeVisible();
  await page.locator('#about-dialog [data-update]').click();
  await expect(page.locator('meta[name="fixture-release"]')).toHaveAttribute('content', 'b');
  expect(await page.evaluate(() => window.fixtureLoadCount)).toBe(firstLoadCount + 1);
  await expect(page.locator('#video-url')).toHaveValue('https://www.youtube.com/watch?v=M7lc1UVf-VE');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SETTINGS_KEY)).toEqual(savedPractice);

  // A controller change by itself must not restart the other open session.
  await expect(second.locator('header [data-update]')).toHaveText('Reload update');
  await expect(second.locator('meta[name="fixture-release"]')).toHaveAttribute('content', 'a');
  expect(await second.evaluate(() => window.fixtureLoadCount)).toBe(secondLoadCount);
  await second.locator('header [data-update]').click();
  await expect(second.locator('meta[name="fixture-release"]')).toHaveAttribute('content', 'b');
  expect(await second.evaluate(() => window.fixtureLoadCount)).toBe(secondLoadCount + 1);
  const cacheNames = await second.evaluate(() => caches.keys());
  expect(cacheNames).toContain('practice-looper:/practice-looper/:fixture-a');
  expect(cacheNames).toContain('practice-looper:/practice-looper/:fixture-b');
});

test('a failed release asset leaves the installed app and settings usable', async ({ page, context, releaseServer }) => {
  await page.goto(releaseServer.url);
  await waitForControl(page);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SETTINGS_KEY, value: savedPractice });
  const script = [...releaseServer.files.keys()].find((name) => /^assets\/.*\.js$/.test(name));
  expect(script).toBeTruthy();
  releaseServer.publish('b');
  releaseServer.fail(script);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const failure = new Promise((resolve) => registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker.addEventListener('statechange', () => { if (worker.state === 'redundant') resolve(); });
    }, { once: true }));
    await registration.update();
    await failure;
  });
  await expect(page.locator('#status')).toContainText('could not finish downloading');
  await expect(page.locator('header [data-update]')).toBeHidden();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('meta[name="fixture-release"]')).toHaveAttribute('content', 'a');
  await expect(page.locator('#video-url')).toHaveValue('https://www.youtube.com/watch?v=M7lc1UVf-VE');
});

test('independent recovery installs a release without clearing saved settings', async ({ page, releaseServer }) => {
  await page.goto(releaseServer.url);
  await waitForControl(page);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SETTINGS_KEY, value: savedPractice });
  releaseServer.publish('b');
  await page.goto(`${releaseServer.url}update.html`);
  await expect(page.getByRole('heading', { name: 'Update Practice Looper' })).toBeVisible();
  await page.getByRole('button', { name: 'Check and update' }).click();
  await expect(page).toHaveURL(releaseServer.url);
  await expect(page.locator('meta[name="fixture-release"]')).toHaveAttribute('content', 'b');
  await expect(page.locator('#video-url')).toHaveValue('https://www.youtube.com/watch?v=M7lc1UVf-VE');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SETTINGS_KEY)).toEqual(savedPractice);
});
