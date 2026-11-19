import type { Page } from '@playwright/test';
import { chatHref, customerJid, expect, inboxHeading, test } from './helpers';

const FLAG_FONT = 'Twemoji Country Flags';

/** The state of the bundled flag font in this page ('missing' when the CSS does not declare it). */
function flagFontStatus(page: Page) {
  return page.evaluate(
    (family) =>
      [...document.fonts].find((face) => face.family.replaceAll('"', '') === family)?.status ??
      'missing',
    FLAG_FONT,
  );
}

test('country flags in a message come from the bundled flag font, so Windows shows the flag, not "MY"', async ({
  page,
  baseURL,
}, info) => {
  const jid = customerJid(info, 97);
  const origin = { Origin: new URL(baseURL!).origin };
  // Registered first: the chat list may already show a flag from a parallel project's chat.
  const fontFile = page.waitForResponse(
    (r) => /\.woff2(\?|$)/.test(r.url()) && r.url().includes('Twemoji'),
  );
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  // The app's CSS declares the font (it is downloaded only once a flag is on screen).
  expect(await flagFontStatus(page)).not.toBe('missing');

  const r = await page.request.post('/api/dev/fake-incoming', {
    headers: origin,
    data: { chatJid: jid, senderName: 'Flag Sender', text: 'Hello from 🇲🇾 and 🇸🇬' },
  });
  expect(r.status(), await r.text()).toBe(200);
  await page.goto(chatHref(jid));
  const bubble = page.locator('[data-message-id]').filter({ hasText: 'Hello from' });
  await expect(bubble).toBeVisible();

  // The flag font is first in the app's font stack and is fetched from the app itself (CSP font-src 'self').
  expect(await bubble.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(
    /^"?Twemoji Country Flags"?,/,
  );
  const response = await fontFile;
  expect(response.status()).toBe(200);
  expect(new URL(response.url()).origin).toBe(new URL(baseURL!).origin);
  await expect.poll(() => flagFontStatus(page)).toBe('loaded');

  // The font draws 🇲🇾 as a colour picture (same pixel whatever the fill colour), not as two grey letters.
  const colourGlyph = await page.evaluate((family) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.textBaseline = 'top';
    ctx.font = `100px "${family}"`;
    ctx.scale(0.01, 0.01);
    const pixel = (fill: string) => {
      ctx.clearRect(0, 0, 100, 100);
      ctx.fillStyle = fill;
      ctx.fillText('🇲🇾', 0, 0);
      return ctx.getImageData(0, 0, 1, 1).data.join(',');
    };
    const white = pixel('#fff');
    const black = pixel('#000');
    return white === black && !black.startsWith('0,0,0,');
  }, FLAG_FONT);
  expect(colourGlyph).toBe(true);
});
