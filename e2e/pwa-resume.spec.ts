import type { Page } from '@playwright/test';
import { chatItem, customerJid, expect, fakeIncoming, inboxHeading, test } from './helpers';

/**
 * Freezes the page clock at the page's own "now". Under load the page clock runs ahead of this
 * process's `new Date()`, and pausing in the past throws "Cannot fast-forward to the past".
 */
async function pauseClockNow(page: Page): Promise<void> {
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 50);
}

declare global {
  interface Window {
    pwaReconnectAttempts: number;
  }
}

test('resuming reconnects before the retry timer and restores missed inbox messages', async ({
  page,
  context,
  baseURL,
}, info) => {
  await page.addInitScript(() => {
    window.pwaReconnectAttempts = 0;
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        window.pwaReconnectAttempts++;
      }
    };
  });
  const authenticated = new Promise<void>((resolve) => {
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        if (String(payload).startsWith('40')) resolve();
      });
    });
  });
  // Install before Socket.IO captures its timer functions, then freeze only after connecting.
  await page.clock.install();
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  await authenticated;
  await page.waitForLoadState('networkidle');
  await pauseClockNow(page);
  const warning = page.getByText('Reconnecting to server…', { exact: true });
  const jid = customerJid(info, 81);
  try {
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(warning).toBeVisible();
    await fakeIncoming(page, { chatJid: jid, text: 'Arrived while the PWA slept' }, baseURL!);
    await expect(chatItem(page, jid)).toHaveCount(0);

    // Restoring the network can dispatch online before the explicit foreground events.
    const beforeRestore = await page.evaluate(() => window.pwaReconnectAttempts);
    await context.setOffline(false);
    const attempts = await page.evaluate((before) => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
      window.dispatchEvent(new Event('online'));
      return window.pwaReconnectAttempts - before;
    }, beforeRestore);
    // Page timers remain frozen: the scheduled backoff cannot be responsible for this attempt.
    expect(attempts).toBe(1);
    await page.clock.resume();
    await expect(warning).toBeHidden();
    await expect(chatItem(page, jid)).toContainText('Arrived while the PWA slept');

    await page.waitForLoadState('networkidle');
    await pauseClockNow(page);
    const lateDropAttempts = await page.evaluate(async () => {
      const before = window.pwaReconnectAttempts;
      document.dispatchEvent(new Event('visibilitychange'));
      // The browser reports the suspended transport's close after the page becomes visible.
      window.dispatchEvent(new Event('offline'));
      await Promise.resolve();
      return window.pwaReconnectAttempts - before;
    });
    expect(lateDropAttempts).toBe(1);
    await page.clock.resume();
    await expect(warning).toBeHidden();
    await expect(chatItem(page, jid)).toContainText('Arrived while the PWA slept');
  } finally {
    await context.setOffline(false);
    await page.clock.resume();
  }
});
