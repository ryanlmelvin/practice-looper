import { test, expect } from '@playwright/test';
import { mockYouTube, loadVideo, setPoint, seek, VIDEO_ID } from './fixtures.js';

test.beforeEach(async ({ page }) => {
  await mockYouTube(page);
  await page.goto('./');
});

test('contacts YouTube only after Load, then cues silently', async ({ page }) => {
  const requests = [];
  page.on('request', request => {
    if (new URL(request.url()).hostname.includes('youtube')) requests.push(request.url());
  });
  // Observe a complete initial navigation, including any premature API request.
  await page.reload();
  await expect(page.locator('#workspace')).toBeHidden();
  await page.locator('#video-url').fill(`https://youtu.be/${VIDEO_ID}`);
  await expect(page.locator('#youtube-consent')).toContainText('By using, you agree');
  await expect(page.locator('#consent-checkbox')).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.locator('#load-button').click();
  await expect(page.locator('#playback-controls')).toBeVisible();
  await expect(page.locator('#youtube-consent')).toBeVisible();
  expect(requests.filter(url => new URL(url).pathname === '/iframe_api')).toHaveLength(1);
  await expect.poll(() => requests.filter(url => new URL(url).pathname === '/oembed').length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__fakeYT.state)).toBe(5);
  expect(await page.evaluate(() => window.__fakeYT.playCalls)).toBe(0);
  await expect(page.locator('#speed')).toHaveValue('1');
  await expect(page.locator('#point-a')).toHaveValue('0:00.0');
  await expect(page.locator('#point-b')).toHaveValue('0:05.0');
});

test('rejects unrelated links and recovers from an unavailable embed', async ({ page }) => {
  await page.locator('#video-url').fill('https://youtube.com.evil.example/watch?v=M7lc1UVf-VE');
  await page.locator('#load-button').click();
  await expect(page.locator('#status')).toContainText('Enter a YouTube video link');
  await expect(page.locator('#workspace')).toBeHidden();
  await loadVideo(page, 'blocked0001');
  await expect(page.locator('#status')).toContainText('owner does not allow');
  await expect(page.locator('#blocker-help')).toBeHidden();
  await expect(page.locator('#load-button')).toBeEnabled();
  await loadVideo(page);
  await expect(page.locator('#status')).toBeHidden();
});

test('repeats A–B, accepts slower playback, and obeys pause', async ({ page }) => {
  await loadVideo(page);
  await setPoint(page, 'a', '1');
  await setPoint(page, 'b', '1.6');
  await page.locator('#speed').selectOption('0.5');
  await expect.poll(() => page.evaluate(() => window.__fakeYT.rate)).toBe(0.5);
  await page.locator('#repeat-button').click();
  await expect(page.locator('#repeat-button')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__fakeYT.playCalls)).toBe(0);
  await page.locator('#play-button').click();
  await expect.poll(() => page.evaluate(() => window.__fakeYT.seekCalls.length), { timeout: 6000 }).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => window.__fakeYT.seekCalls.every(time => time === 1))).toBe(true);
  await page.locator('#play-button').click();
  await expect(page.locator('#play-button')).toHaveText('Play');
  const paused = await page.evaluate(() => ({ time: window.__fakeYT.currentTime, seeks: window.__fakeYT.seekCalls.length }));
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__fakeYT.currentTime)).toBe(paused.time);
  expect(await page.evaluate(() => window.__fakeYT.seekCalls.length)).toBe(paused.seeks);
});

test('invalid ranges cannot repeat and manually moving outside disables repeat', async ({ page }) => {
  await loadVideo(page);
  await setPoint(page, 'a', '5');
  await expect(page.locator('#range-error')).toBeVisible();
  await page.locator('#repeat-button').click();
  await expect(page.locator('#repeat-button')).toHaveAttribute('aria-pressed', 'false');
  await setPoint(page, 'b', '10');
  await expect(page.locator('#range-error')).toBeHidden();
  await page.locator('#repeat-button').click();
  await page.locator('#play-button').click();
  await expect.poll(() => page.evaluate(() => window.__fakeYT.currentTime)).toBeGreaterThanOrEqual(5);
  await seek(page, 30);
  await expect(page.locator('#repeat-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#status')).toContainText('outside A–B');
  await page.locator('#repeat-button').click();
  await expect(page.locator('#repeat-button')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.__fakeYT.currentTime)).toBeLessThan(10);
  await page.waitForTimeout(180);
  await page.evaluate(() => window.__fakeYT.externalSeek(45));
  await expect(page.locator('#repeat-button')).toHaveAttribute('aria-pressed', 'false');
});

test('seeking before first play keeps the passage and does not start sound', async ({ page }) => {
  await loadVideo(page);
  await setPoint(page, 'a', '10');
  await setPoint(page, 'b', '15');
  await seek(page, 12);
  await page.locator('#repeat-button').click();
  await expect(page.locator('#repeat-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#point-a')).toHaveValue('0:10.0');
  await expect(page.locator('#point-b')).toHaveValue('0:15.0');
  expect(await page.evaluate(() => window.__fakeYT.playCalls)).toBe(0);
  expect(await page.evaluate(() => window.__fakeYT.state)).toBe(5);
});

test('restores points, accepted speed, repeat, and position after reload without autoplay', async ({ page }) => {
  await loadVideo(page);
  await setPoint(page, 'a', '10');
  await setPoint(page, 'b', '15');
  await seek(page, 12);
  await page.locator('#speed').selectOption('0.5');
  await page.locator('#repeat-button').click();
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('practice-looper:/practice-looper/:settings:v1'));
    return saved?.repeat && saved?.rate === 0.5 && saved?.position === 12;
  })).toBe(true);
  await page.reload();
  await expect(page.locator('#workspace')).toBeHidden();
  await expect(page.locator('#video-url')).toHaveValue(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
  await expect(page.locator('#youtube-consent')).toBeVisible();
  await page.locator('#load-button').click();
  await expect(page.locator('#playback-controls')).toBeVisible();
  await expect(page.locator('#point-a')).toHaveValue('0:10.0');
  await expect(page.locator('#point-b')).toHaveValue('0:15.0');
  await expect(page.locator('#repeat-button')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.__fakeYT.rate)).toBe(0.5);
  expect(await page.evaluate(() => window.__fakeYT.currentTime)).toBe(12);
  expect(await page.evaluate(() => window.__fakeYT.playCalls)).toBe(0);
});

test('reports a rejected speed and rejects malformed import without replacing the session', async ({ page }) => {
  await loadVideo(page);
  await page.evaluate(() => { window.__fakeYT.rejectRate = true; });
  await page.locator('#speed').selectOption('0.5');
  await expect(page.locator('#status')).toContainText('kept the speed at 1×');
  await expect(page.locator('#speed')).toHaveValue('1');
  await page.getByRole('button', { name: 'About and settings' }).click();
  await page.locator('#import-settings').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":99}') });
  await expect(page.locator('#about-dialog')).not.toBeVisible();
  await expect(page.locator('#status')).toContainText('not a valid');
  await expect(page.locator('#point-b')).toHaveValue('0:05.0');
  await expect(page.locator('#playback-controls')).toBeVisible();
});

for (const [width, height] of [[320, 640], [390, 844], [844, 390]]) {
  test(`fits ${width}×${height} with visible controls and accessible dialogs`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await loadVideo(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    const frame = await page.locator('#player-container iframe').boundingBox();
    expect(frame.width).toBeGreaterThanOrEqual(200);
    expect(frame.height).toBeGreaterThanOrEqual(200);
    expect(await page.locator('#point-a').evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    await page.locator('#install-button').click();
    await expect(page.locator('#install-dialog')).toBeVisible();
    await expect(page.locator('#install-dialog details').nth(0)).toHaveAttribute('open', '');
    await expect(page.locator('#install-dialog details').nth(1)).toHaveAttribute('open', '');
    await page.getByText('Computer', { exact: true }).click();
    await expect(page.locator('#install-dialog details').nth(2)).toHaveAttribute('open', '');
    expect(await page.locator('#install-dialog').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#install-dialog')).not.toBeVisible();
    await expect(page.locator('#install-button')).toBeFocused();
    await page.getByRole('button', { name: 'About and settings' }).click();
    await expect(page.locator('#about-dialog')).toBeVisible();
    expect(await page.locator('#about-dialog').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.locator('#about-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('button', { name: 'About and settings' })).toBeFocused();
  });
}


test('explains a blocked YouTube script, clears the empty player, and retries', async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.abort('blockedbyclient'));
  await page.locator('#video-url').fill('https://www.youtube.com/watch?v=rn_YodiJO6k&ra=m');
  await page.locator('#load-button').click();
  await expect(page.locator('#status')).toContainText('player script');
  await expect(page.locator('#status')).toContainText('content blocker');
  await expect(page.locator('#blocker-help')).toBeVisible();
  await page.locator('#blocker-help summary').click();
  for (const browser of ['Safari on iPhone/iPad', 'Safari on Mac', 'Chrome / Edge', 'Firefox', 'Installed app:']) {
    await expect(page.locator('#blocker-help')).toContainText(browser);
  }
  await expect(page.locator('#workspace')).toBeHidden();
  await expect(page.locator('#player-container')).toBeEmpty();
  await expect(page.locator('#load-button')).toBeEnabled();
  await page.unroute('https://www.youtube.com/iframe_api');
  await mockYouTube(page);
  await page.locator('#load-button').click();
  await expect(page.locator('#playback-controls')).toBeVisible();
  expect(await page.evaluate(() => window.__fakeYT.videoId)).toBe('rn_YodiJO6k');
  await expect(page.locator('#blocker-help')).toBeHidden();
  expect(await page.locator('#blocker-help').evaluate(node => node.open)).toBe(false);
});

test('distinguishes a player API timeout from a blocked script', async ({ page }) => {
  await page.clock.install();
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType:'text/javascript', body:'' }));
  await page.locator('#video-url').fill(`https://youtu.be/${VIDEO_ID}`);
  await page.locator('#load-button').click();
  await page.clock.fastForward(30001);
  await expect(page.locator('#status')).toContainText('took too long');
  await expect(page.locator('#blocker-help')).toBeVisible();
  await expect(page.locator('#workspace')).toBeHidden();
  await expect(page.locator('#load-button')).toBeEnabled();
});


test('offers blocker instructions after player identity errors on a mobile screen', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await loadVideo(page);
  await page.evaluate(() => window.__fakeYT.options.events.onError({ data:153 }));
  await expect(page.locator('#status')).toContainText('content blocker');
  await page.locator('#blocker-help summary').click();
  await expect(page.locator('#blocker-help')).toContainText('Browser settings may not carry over');
  await expect(page.locator('#blocker-help a').first()).toHaveAttribute('href', 'https://ryanlmelvin.github.io/practice-looper/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
