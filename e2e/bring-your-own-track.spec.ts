import { test, expect } from '@playwright/test';
import { makeWav, waitForAudio, stampAt, row, expectRowStart, inspectorValues } from './helpers';

test('a brought track is stamped, abuts, persists across reload and does not leak the seeded sheet', async ({ page }) => {
  const title = `BYO ${Date.now()}`;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'You Verse You' })).toBeVisible();

  await page.getByRole('button', { name: 'Load song' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Audio file').setInputFiles({ name: 'byo.wav', mimeType: 'audio/wav', buffer: makeWav(20) });
  await dialog.getByLabel('Title').fill(title);
  await dialog
    .getByRole('textbox', { name: 'Lyrics' })
    .fill('Hello there\n# a comment\n\nSame line\nSame line\nthird one\nlast words');
  await dialog.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await waitForAudio(page);
  await expect(page.getByTestId('line-count')).toContainText('5');
  await expect(page.getByRole('listbox', { name: 'Lyrics' }).getByRole('option')).toHaveCount(5);

  const starts = [1, 3, 5.5, 8, 12];
  const labels = ['0:01.000', '0:03.000', '0:05.500', '0:08.000', '0:12.000'];
  for (const s of starts) await stampAt(page, s);
  await expect(page.getByTestId('placed-count')).toContainText('5');

  const check = async () => {
    for (let i = 0; i < 5; i++) await expectRowStart(page, i + 1, labels[i]);
    // Duplicate texts are distinct lines with distinct ids.
    const ids = await page.getByRole('listbox', { name: 'Lyrics' }).getByRole('option').evaluateAll((els) => els.map((e) => e.getAttribute('data-line-id')));
    expect(new Set(ids).size).toBe(5);
    await expect(row(page, 2)).toHaveAccessibleName(/^2\. Same line, starts 0:03\.000$/);
    await expect(row(page, 3)).toHaveAccessibleName(/^3\. Same line, starts 0:05\.500$/);
    await expect(page.getByText('You Verse You')).toHaveCount(0);
  };
  await check();

  // Lines abut: end of N == start of N+1.
  for (let i = 1; i <= 4; i++) {
    await row(page, i).click();
    await expect(page.getByLabel('Start', { exact: true })).toHaveValue(labels[i - 1]);
    await expect(page.getByLabel('End', { exact: true })).toHaveValue(labels[i]);
  }

  // Autosave is debounced (500 ms); wait for it, then reload.
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByRole('listbox', { name: 'Lyrics' }).getByRole('option')).toHaveCount(5);
  await check();
});
