import { test, expect } from '@playwright/test';
import { openServerTrack, restampLine, row, expectRowStart } from './helpers';

test('Shift+Right on a range moves only the selection by 100 ms per press; one undo reverts the burst', async ({ page }) => {
  await openServerTrack(page);
  const starts = ['0:02.000', '0:04.000', '0:06.000', '0:08.000'];
  // Re-stamp rows 1-4 explicitly: the shared server track may already carry saved timings.
  for (const [i, s] of [2, 4, 6, 8].entries()) await restampLine(page, i + 1, s);

  await row(page, 2).click();
  await row(page, 4).click({ modifiers: ['Shift'] });
  await expect(row(page, 2)).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 3)).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 4)).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 1)).toHaveAttribute('aria-selected', 'false');

  // Clicking a timed row plays it; pause and drop focus so keys go to the shortcut layer.
  await page.evaluate(() => { const a = document.querySelector('audio')!; a.pause(); (document.activeElement as HTMLElement)?.blur(); });
  const shifted = ['0:04.300', '0:06.300', '0:08.300'];
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');

  await expectRowStart(page, 1, starts[0]);
  for (let i = 0; i < 3; i++) await expectRowStart(page, i + 2, shifted[i]);

  await page.keyboard.press('ControlOrMeta+z');
  for (let i = 0; i < 4; i++) await expectRowStart(page, i + 1, starts[i]);

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expectRowStart(page, 1, starts[0]);
  for (let i = 0; i < 3; i++) await expectRowStart(page, i + 2, shifted[i]);
});
