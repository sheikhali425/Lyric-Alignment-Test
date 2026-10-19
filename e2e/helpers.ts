import { expect, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const API = 'http://localhost:4000';

// The API config is ESM and the e2e loader is CJS, so import it natively (bypassing the transpiler).
const nativeImport = new Function('u', 'return import(u)') as (u: string) => Promise<{ AUTH_TOKEN: string }>;
export async function authHeaders() {
  const { AUTH_TOKEN } = await nativeImport(pathToFileURL(resolve(__dirname, '../apps/api/src/config.js')).href);
  return { Authorization: `Bearer ${AUTH_TOKEN}` };
}

/** 16-bit PCM mono 8 kHz WAV of `seconds` seconds with sine bursts. */
export function makeWav(seconds: number): Buffer {
  const rate = 8000;
  const n = Math.floor(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const burst = Math.floor(t * 2) % 2 === 0 ? 1 : 0.2;
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * t) * 8000 * burst), 44 + i * 2);
  }
  return buf;
}

export async function waitForAudio(page: Page) {
  await page.waitForFunction(() => {
    const a = document.querySelector('audio');
    return !!a && a.readyState >= 1 && Number.isFinite(a.duration) && a.duration > 0;
  });
}

/** Seek the single <audio> element, then press Enter to stamp the cursor line. */
export async function stampAt(page: Page, sec: number) {
  await page.evaluate((s) => {
    document.querySelector('audio')!.pause();
    (document.activeElement as HTMLElement | null)?.blur();
    document.querySelector('audio')!.currentTime = s;
  }, sec);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
}

export const row = (page: Page, n: number) =>
  page.getByRole('listbox', { name: 'Lyrics' }).getByRole('option').nth(n - 1);

export async function expectRowStart(page: Page, n: number, label: string) {
  await expect(row(page, n)).toHaveAccessibleName(new RegExp(`starts ${label.replace('.', '\\.')}$`));
}

/** Read the Inspector Start/End inputs of the current selection. */
export async function inspectorValues(page: Page) {
  return {
    start: await page.getByLabel('Start', { exact: true }).inputValue(),
    end: await page.getByLabel('End', { exact: true }).inputValue(),
  };
}

export async function openServerTrack(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'You Verse You' })).toBeVisible();
  await waitForAudio(page);
}

export const fmt = (ms: number) => {
  const m = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(sec).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};

/** Make line n the stamp cursor (clearing its timing if needed) and stamp it at `sec`. */
export async function restampLine(page: Page, n: number, sec: number) {
  const r = row(page, n);
  await r.click();
  if ((await r.getAttribute('data-timed')) === 'true') {
    await page.getByRole('button', { name: 'Clear timing' }).click();
  }
  await expect(r).toHaveAttribute('data-cursor', 'true');
  await stampAt(page, sec);
  await expectRowStart(page, n, fmt(Math.round(sec * 1000)));
}
