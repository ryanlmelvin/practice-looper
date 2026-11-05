import { test, expect } from '@playwright/test';
import { mockYouTube, loadVideo, setPoint, VIDEO_ID } from './fixtures.js';

const entries = page => page.locator('#history-list .history-entry');
const rangeEntry = (page, start) => entries(page).filter({ hasText: start });

async function practice(page, a, b) {
  await setPoint(page, 'b', String(b));
  await setPoint(page, 'a', String(a));
  if (await page.locator('#repeat-button').getAttribute('aria-pressed') !== 'true') {
    await page.locator('#repeat-button').click();
  }
  await page.locator('#play-button').click();
  await expect(page.locator('#play-button')).toHaveText('Pause');
  await expect(page.locator('#history')).toBeVisible();
  await page.locator('#play-button').click();
  await expect(page.locator('#play-button')).toHaveText('Play');
}

test.beforeEach(async ({ page }) => {
  await mockYouTube(page);
  await page.goto('./');
});

test('keeps history hidden until a valid segment is practiced', async ({ page }) => {
  await expect(page.locator('#history')).toBeHidden();
  await loadVideo(page);
  await setPoint(page, 'b', '15');
  await setPoint(page, 'a', '10');
  // Give the existing settings debounce time to run; editing is not practice.
  await page.waitForTimeout(350);
  await expect(page.locator('#history')).toBeHidden();
  await page.locator('#play-button').click();
  await expect(entries(page)).toHaveCount(1);
  await expect(entries(page).first()).toContainText('0:10.0');
  await expect(entries(page).first()).toContainText('0:15.0');
});

test('persists history across reload and recalls the selected video, points, speed, and repeat silently', async ({ page }) => {
  await loadVideo(page);
  await page.locator('#speed').selectOption('0.5');
  await expect.poll(() => page.evaluate(() => window.__fakeYT.rate)).toBe(0.5);
  await practice(page, 10.5, 15.5);
  await expect(entries(page)).toHaveCount(1);

  await loadVideo(page, 'abcdefghijk');
  await practice(page, 30, 40);
  await expect(entries(page)).toHaveCount(2);
  await expect(entries(page).first()).toContainText('0:30.0');

  const youtubeRequests = [];
  page.on('request', request => {
    if (new URL(request.url()).hostname.includes('youtube')) youtubeRequests.push(request.url());
  });
  await page.reload();
  await expect(entries(page)).toHaveCount(2);
  await expect(page.locator('#workspace')).toBeHidden();
  expect(youtubeRequests).toEqual([]);

  await rangeEntry(page, '0:10.5').click();
  await expect(page.locator('#playback-controls')).toBeVisible();
  await expect(page.locator('#video-url')).toHaveValue(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
  await expect(page.locator('#point-a')).toHaveValue('0:10.5');
  await expect(page.locator('#point-b')).toHaveValue('0:15.5');
  await expect(page.locator('#repeat-button')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.__fakeYT.rate)).toBe(0.5);
  expect(await page.evaluate(() => window.__fakeYT.currentTime)).toBe(10.5);
  expect(await page.evaluate(() => window.__fakeYT.playCalls)).toBe(0);
  await expect(entries(page).first()).toContainText('0:30.0');
  await page.locator('#play-button').click();
  await expect(entries(page).first()).toContainText('0:10.5');
  await expect(entries(page)).toHaveCount(2);
});

test('retains distinct ranges from one video and moves revisited segments to the top without duplicates', async ({ page }) => {
  await loadVideo(page);
  await practice(page, 2, 4);
  await expect(entries(page)).toHaveCount(1);
  await practice(page, 10, 12);
  await expect(entries(page)).toHaveCount(2);
  await expect(entries(page).first()).toContainText('0:10.0');

  await rangeEntry(page, '0:02.0').click();
  await expect(page.locator('#point-a')).toHaveValue('0:02.0');
  await page.locator('#play-button').click();
  await expect(entries(page).first()).toContainText('0:02.0');
  await page.locator('#play-button').click();
  await page.locator('#play-button').click();
  await expect(entries(page)).toHaveCount(2);
  await expect(entries(page).first()).toContainText('0:02.0');
});

test('scrolls older segments within history and fits a narrow mobile screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await loadVideo(page);
  for (let index = 0; index < 10; index++) {
    await practice(page, index * 5, index * 5 + 3);
    await expect(entries(page)).toHaveCount(index + 1);
  }
  await expect(entries(page).first()).toContainText('0:45.0');
  await page.locator('#history').screenshot({ path: testInfo.outputPath('history-mobile.png') });
  const list = page.locator('#history-list');
  expect(await list.evaluate(element => {
    const style = getComputedStyle(element);
    return ['auto', 'scroll'].includes(style.overflowY) && element.scrollHeight > element.clientHeight;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await entries(page).last().focus();
  expect(await list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('#point-a')).toHaveValue('0:00.0');
  await expect(page.locator('#point-b')).toHaveValue('0:03.0');
});

test('records a range edited during playback even when paused before the save debounce', async ({ page }) => {
  await loadVideo(page);
  await page.locator('#play-button').click();
  await expect(entries(page)).toHaveCount(1);
  // Deliver the edits and the iframe pause together so no save timer can run
  // between the new range being practiced and playback stopping.
  await page.evaluate(() => {
    const a = document.getElementById('point-a');
    const b = document.getElementById('point-b');
    b.value = '15';
    b.dispatchEvent(new Event('change', { bubbles: true }));
    a.value = '10';
    a.dispatchEvent(new Event('change', { bubbles: true }));
    window.__fakeYT.emitState(2);
  });
  await expect(page.locator('#play-button')).toHaveText('Play');
  await expect(entries(page)).toHaveCount(2);
  await expect(entries(page).first()).toContainText('0:10.0');
  await expect(entries(page).first()).toContainText('0:15.0');
  await page.reload();
  await expect(entries(page)).toHaveCount(2);
  await expect(entries(page).first()).toContainText('0:10.0');
});

test('reflects deletion and clearing in another tab without later saves resurrecting history', async ({ page, context }) => {
  await loadVideo(page);
  await practice(page, 2, 4);
  await practice(page, 10, 12);
  await expect(entries(page)).toHaveCount(2);
  const other = await context.newPage();
  await mockYouTube(other);
  await other.goto('./');
  await expect(entries(other)).toHaveCount(2);

  await other.locator('#history-list li').filter({ hasText: '0:10.0' }).locator('.history-delete').click();
  await expect(entries(page)).toHaveCount(1);
  await expect(entries(page).first()).toContainText('0:02.0');
  await expect(page.locator('#point-a')).toHaveValue('0:10.0');
  await page.evaluate(() => window.__fakeYT.emitState(2));
  await page.waitForTimeout(350);
  await expect(entries(page)).toHaveCount(1);
  await expect(entries(other)).toHaveCount(1);

  // Practice the remaining range in the original tab, then clear it remotely.
  await rangeEntry(page, '0:02.0').click();
  await expect(page.locator('#point-a')).toHaveValue('0:02.0');
  await page.locator('#play-button').click();
  await expect(page.locator('#play-button')).toHaveText('Pause');
  await other.locator('#clear-history').click();
  await expect(page.locator('#history')).toBeHidden();
  await page.evaluate(() => window.__fakeYT.emitState(2));
  await page.waitForTimeout(350);
  await expect(page.locator('#history')).toBeHidden();
  await expect(other.locator('#history')).toBeHidden();
  await page.reload();
  await other.reload();
  await expect(page.locator('#history')).toBeHidden();
  await expect(other.locator('#history')).toBeHidden();
});

test('deletes one segment without affecting other entries or restoring it on a background save', async ({ page }) => {
  await loadVideo(page);
  await practice(page, 2, 4);
  await practice(page, 10, 12);
  await expect(entries(page)).toHaveCount(2);
  await page.locator('#play-button').click();
  await page.locator('#history-list li').filter({ hasText: '0:10.0' }).locator('.history-delete').click();
  await expect(entries(page)).toHaveCount(1);
  await expect(entries(page).first()).toContainText('0:02.0');
  await page.locator('#play-button').click();
  await page.reload();
  await expect(entries(page)).toHaveCount(1);
  await expect(entries(page).first()).toContainText('0:02.0');
});

test('clears all history and keeps it empty across saves and reload', async ({ page }) => {
  await loadVideo(page);
  await practice(page, 2, 4);
  await practice(page, 10, 12);
  await expect(entries(page)).toHaveCount(2);
  await page.locator('#play-button').click();
  await page.locator('#clear-history').click();
  await expect(page.locator('#history')).toBeHidden();
  await page.locator('#play-button').click();
  await page.reload();
  await expect(page.locator('#history')).toBeHidden();
});

test('forgetting saved settings also removes history', async ({ page }) => {
  await loadVideo(page);
  await practice(page, 10, 15);
  await expect(entries(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'About and settings' }).click();
  await page.locator('#privacy-details > summary').click();
  await page.locator('#forget-settings').click();
  await expect(page.locator('#history')).toBeHidden();
  await page.reload();
  await expect(page.locator('#history')).toBeHidden();
  await expect(page.locator('#video-url')).toHaveValue('');
});
