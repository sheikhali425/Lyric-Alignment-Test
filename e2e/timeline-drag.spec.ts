import { test, expect } from '@playwright/test';
import { openServerTrack, restampLine, row, expectRowStart, fmt } from './helpers';

const parseMs = (s: string) => {
  const [m, rest] = s.split(':');
  return Number(m) * 60000 + Math.round(Number(rest) * 1000);
};

test('dragging a segment block moves its start by the dragged distance (Alt: no snap) and undo restores it', async ({ page }) => {
  await openServerTrack(page);
  // Row 1 at 2 s, row 2 at 6 s. Explicit restamps: the shared server track may carry saved timings.
  await restampLine(page, 1, 2);
  await restampLine(page, 2, 6);
  for (let i = 0; i < 9; i++) await page.getByRole('button', { name: 'Zoom in' }).click();

  // Zooming keeps the viewport centre fixed, so scroll back to the start where both blocks live.
  await page.getByTestId('timeline').evaluate((root) => {
    for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
      if (el.scrollWidth > el.clientWidth + 1) el.scrollLeft = 0;
    }
  });
  await page.waitForTimeout(100);

  const id1 = await row(page, 1).getAttribute('data-line-id');
  const id2 = await row(page, 2).getAttribute('data-line-id');
  const seg1 = page.locator(`[aria-label^="Segment:"][data-line-id="${id1}"]`);
  const seg2 = page.locator(`[aria-label^="Segment:"][data-line-id="${id2}"]`);
  await expect(seg1).toBeVisible();
  await expect(seg2).toBeVisible();

  // px per second derived from two blocks whose starts differ by exactly 4 s (not hard-coded zoom).
  const box1 = (await seg1.boundingBox())!;
  const box2 = (await seg2.boundingBox())!;
  const pps = (box2.x - box1.x) / 4;
  expect(pps).toBeGreaterThan(20);

  // Drag by 1.5 s worth of pixels in small steps with Alt held (snapping off), grabbing well inside the body.
  const grabX = box2.x + Math.min(box2.width / 2, 40);
  const y = box2.y + box2.height / 2;
  const dx = 1.5 * pps;
  await page.mouse.move(grabX, y);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) await page.mouse.move(grabX + (dx * i) / 15, y);
  await page.mouse.up();
  await page.keyboard.up('Alt');

  await row(page, 2).click(); // select it so the Inspector shows the precise start
  await page.evaluate(() => document.querySelector('audio')!.pause());
  const startField = page.getByLabel('Start', { exact: true });
  await expect(startField).not.toHaveValue(fmt(6000));
  const ms = parseMs(await startField.inputValue());
  const tolMs = (2 / pps) * 1000; // two pixels of slack
  expect(Math.abs(ms - 7500)).toBeLessThanOrEqual(tolMs);
  await expectRowStart(page, 1, fmt(2000)); // row 1 untouched by the drag

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ControlOrMeta+z');
  await expectRowStart(page, 2, fmt(6000));
  await expectRowStart(page, 1, fmt(2000));
});
