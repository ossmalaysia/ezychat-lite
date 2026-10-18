import { MessageListResponse } from '@ezychat/shared';
import { chatHref, customerJid, expect, fakeIncoming, test } from './helpers';

// Chromium's fake microphone (a test tone) is set up for the desktop project only.
test('records a voice note, reviews it and sends it as a WhatsApp voice note', async ({
  page,
  baseURL,
}, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'fake microphone: desktop Chromium only');
  const jid = customerJid(info, 41);
  await page.goto('/');
  await fakeIncoming(
    page,
    { chatJid: jid, text: 'Can I order for 1pm?', senderName: 'Nurul' },
    baseURL!,
  );
  await page.goto(chatHref(jid));

  await page.getByRole('button', { name: 'Record a voice note' }).click();
  const timer = page.getByRole('timer');
  await expect(timer).toBeVisible();
  // Record about two seconds of the fake microphone's tone.
  await expect(timer).toHaveText('0:02', { timeout: 5_000 });
  await page.getByRole('button', { name: 'Review' }).click();
  const review = page.getByTestId('voice-review');
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Send voice note' }).click();

  // The bubble is labelled, and the server stored and sent a real Ogg/Opus voice note.
  await expect(page.getByText('Voice note ·')).toBeVisible();
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/chats/${encodeURIComponent(jid)}/messages`);
      const last = MessageListResponse.parse(await res.json()).messages.at(-1);
      return (
        last && {
          voiceNote: last.voiceNote,
          mime: last.mediaMime,
          reachedWhatsApp: ['sent', 'delivered', 'read'].includes(last.status),
        }
      );
    })
    .toEqual({ voiceNote: true, mime: 'audio/ogg; codecs=opus', reachedWhatsApp: true });
  await expect(page.getByRole('button', { name: 'Record a voice note' })).toBeVisible();
});
