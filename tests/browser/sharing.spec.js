import { test, expect } from '@playwright/test';
import { mockYouTube, loadVideo, setPoint } from './fixtures.js';

test('shares a loop from the player and opens it silently without replacing history', async ({ page, context }) => {
  await mockYouTube(page);
  await page.goto('./');
  await loadVideo(page);
  await setPoint(page, 'a', '12');
  await setPoint(page, 'b', '24');
  await page.locator('#share-loop').click();
  const link = await page.locator('#share-link').inputValue();
  const other = await context.newPage();
  const youtube = await mockYouTube(other);
  await other.goto(link);
  expect(youtube.requests).toBe(0);
  await expect(other.locator('#video-url')).toHaveValue(/M7lc1UVf-VE/);
  await loadVideo(other);
  await expect(other.locator('#point-a')).toHaveValue('0:12.0');
  await expect(other.locator('#point-b')).toHaveValue('0:24.0');
  await expect(other.locator('#play-button')).toHaveText('Play');
});

test('exports the whole history and merges imports, rejecting invalid entries atomically', async ({ page }) => {
  await mockYouTube(page);
  await page.goto('./');
  const entry = { schema:1, source:'youtube', videoId:'M7lc1UVf-VE', a:10, b:20, position:10, rate:1, repeat:true, title:'First', practicedAt:1 };
  const upload = history => page.locator('#import-settings').setInputFiles({ name:'history.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify({ schema:1, app:'riffbolt', history })) });
  await page.locator('#about-button').click();
  await upload([entry]);
  await expect(page.locator('#history-list li')).toHaveCount(1);
  await page.locator('#about-button').click();
  await upload([{ ...entry, a:30, b:40, title:'Second', practicedAt:2 }]);
  await expect(page.locator('#history-list li')).toHaveCount(2);
  await page.locator('.history-share').first().click();
  expect(await page.locator('#share-link').inputValue()).toContain('#share=1.');
  await page.locator('#share-dialog').getByRole('button', { name:'Close' }).click();
  await page.locator('#about-button').click();
  const download = page.waitForEvent('download');
  await page.locator('#export-settings').click();
  const file = await download;
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString()).history).toHaveLength(2);
  await upload([entry, { ...entry, b:0 }]);
  await expect(page.locator('#history-list li')).toHaveCount(2);
  await expect(page.locator('#status')).toContainText('not a valid');
});
