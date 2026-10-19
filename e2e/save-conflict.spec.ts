import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { API, authHeaders, fmt, openServerTrack, restampLine, row, expectRowStart } from './helpers';

// These tests write to the one shared server track, so they must not run in parallel with each other.
test.describe.configure({ mode: 'serial' });

interface ServerSeg { line_id: string; start_ms: number; end_ms: number }

async function getServer(request: APIRequestContext) {
  const res = await request.get(`${API}/api/v1/track`, { headers: await authHeaders() });
  expect(res.ok()).toBeTruthy();
  const t = await res.json();
  return {
    version: t.version as number,
    lines: t.lines as { id: string; index: number; text: string }[],
    segments: (t.alignment?.segments ?? []) as ServerSeg[],
  };
}

const startOf = (segs: ServerSeg[], id: string) => segs.find((s) => s.line_id === id)?.start_ms;

/**
 * Stamp line 1 and save it, then move the server on behind the app's back, then make
 * a second UI edit (line 2) and Save. Leaves the conflict dialog open.
 */
async function arrangeConflict(page: Page, request: APIRequestContext) {
  const before = await getServer(request);
  const [id1, id2] = before.lines;
  // Whole-second times, chosen to differ from whatever earlier runs left on the server.
  const pick = (cur: number | undefined, base: number) => {
    let s = base;
    while (cur === s * 1000) s += 1;
    return s;
  };
  const s1 = pick(startOf(before.segments, id1.id), 20 + (Date.now() % 20));
  const s2 = pick(startOf(before.segments, id2.id), 50 + (Date.now() % 20));

  await openServerTrack(page);
  await restampLine(page, 1, s1);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
  const mine = await getServer(request);
  expect(startOf(mine.segments, id1.id)).toBe(s1 * 1000);

  // Someone else saves: same lines, line 1 retimed, version bumped.
  const theirs = mine.segments.map((s) =>
    s.line_id === id1.id ? { ...s, start_ms: s.start_ms + 7000, end_ms: s.end_ms + 7000 } : s,
  );
  const put = await request.put(`${API}/api/v1/track/alignment`, {
    headers: await authHeaders(),
    data: { version: mine.version, lines: mine.lines, segments: theirs },
  });
  expect(put.ok()).toBeTruthy();
  const server = await getServer(request);
  expect(server.version).toBe(mine.version + 1);

  await restampLine(page, 2, s2);
  await expect(page.getByTestId('save-status')).toHaveText('Unsaved changes');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep mine' })).toBeVisible();
  return { id1: id1.id, id2: id2.id, s1, s2, theirs1: startOf(server.segments, id1.id)!, theirs2: startOf(server.segments, id2.id) };
}

test('a stale save raises the conflict dialog; "Keep mine" overwrites the server with the UI timings', async ({ page, request }) => {
  const c = await arrangeConflict(page, request);
  expect(c.theirs1).toBe(c.s1 * 1000 + 7000);

  await page.getByRole('button', { name: 'Keep mine' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveText('Saved');

  const after = await getServer(request);
  expect(startOf(after.segments, c.id1)).toBe(c.s1 * 1000);
  expect(startOf(after.segments, c.id2)).toBe(c.s2 * 1000);
  await expectRowStart(page, 1, fmt(c.s1 * 1000));
});

test('"Use server\'s" restores the server timing and is undoable back to mine', async ({ page, request }) => {
  const c = await arrangeConflict(page, request);

  await page.getByRole('button', { name: "Use server's" }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectRowStart(page, 1, fmt(c.theirs1));
  if (c.theirs2 !== undefined) await expectRowStart(page, 2, fmt(c.theirs2));
  else await expect(row(page, 2)).toHaveAccessibleName(/untimed$/);
  await expect(page.getByTestId('save-status')).toHaveText('Saved');

  // Server is untouched by the choice.
  const server = await getServer(request);
  expect(startOf(server.segments, c.id1)).toBe(c.theirs1);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ControlOrMeta+z');
  await expectRowStart(page, 1, fmt(c.s1 * 1000));
  await expectRowStart(page, 2, fmt(c.s2 * 1000));
  await expect(page.getByTestId('save-status')).toHaveText('Unsaved changes');
});

// Leave the shared track untimed again so other specs see a clean sheet.
test.afterAll(async ({ request }) => {
  const cur = await getServer(request);
  await request.put(`${API}/api/v1/track/alignment`, {
    headers: await authHeaders(),
    data: { version: cur.version, lines: cur.lines, segments: [] },
  });
});
