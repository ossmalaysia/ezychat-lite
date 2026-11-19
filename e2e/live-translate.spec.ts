import type { Page } from '@playwright/test';
import {
  chatItem,
  customerJid,
  expect,
  expectNoHorizontalScroll,
  fakeIncoming,
  inboxHeading,
  test,
} from './helpers';

// Never contacts a model. The five Live translate routes are answered in the browser (as the reply-suggestion
// spec does), so the whole flow runs against the real web app and the real inbox, with no provider. The server's
// own checks (protected items, limits, the cache, `translation_changed`) are covered by the server tests.
const STATE = {
  on: false,
  customerLanguage: null,
  detected: 'zh',
  mixed: null,
  outgoingLanguage: null,
  outgoingDetected: null,
};
const CUSTOMER_TEXT = '你好，Kopi O 粉多少钱？';
const TRANSLATED = 'Hello, how much is Kopi O powder?';
const DRAFT = {
  status: 'ok',
  translation: '一盒 RM42.00。',
  from: 'ms',
  protected: ['RM42.00'],
  draftId: 'draft-1',
};

async function stubLiveTranslate(page: Page, jid: string, sent: unknown[]) {
  const state = { ...STATE };
  await page.route('**/api/live-translate', (route) =>
    route.fulfill({ json: { enabled: true, dailyLimit: 200, connected: true, usedToday: 2 } }),
  );
  await page.route('**/api/me', async (route) => {
    const res = await route.fetch();
    const me = (await res.json()) as Record<string, unknown>;
    await route.fulfill({
      response: res,
      json: { ...me, translateLanguage: 'ms', sendWithoutPreview: false },
    });
  });
  await page.route(`**/api/chats/${encodeURIComponent(jid)}/live-translate`, async (route) => {
    if (route.request().method() === 'PUT')
      Object.assign(state, route.request().postDataJSON() as object);
    await route.fulfill({ json: state });
  });
  await page.route(`**/api/chats/${encodeURIComponent(jid)}/translations`, async (route) => {
    const body = route.request().postDataJSON() as { messageIds: string[] };
    await route.fulfill({
      json: {
        translations: Object.fromEntries(
          body.messageIds.map((id) => [id, { status: 'ok', text: TRANSLATED, from: 'zh' }]),
        ),
      },
    });
  });
  await page.route(`**/api/chats/${encodeURIComponent(jid)}/translate-draft`, (route) =>
    route.fulfill({ json: DRAFT }),
  );
  // The send is answered here too: the draft id above exists only in this stub.
  await page.route(`**/api/chats/${encodeURIComponent(jid)}/messages`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    sent.push(body);
    await route.fulfill({
      status: 201,
      json: {
        id: 'sent-1',
        chatJid: jid,
        senderJid: null,
        senderName: 'Admin',
        fromMe: true,
        sentByUserId: 1,
        type: 'text',
        body: body.text,
        mediaUrl: null,
        mediaMime: null,
        mediaName: null,
        mediaStatus: 'none',
        quotedId: null,
        status: 'sent',
        error: null,
        timestamp: Date.now(),
        clientId: body.clientId,
        reactions: [],
        typed: body.translation
          ? {
              typedText: (body.translation as { typedText: string }).typedText,
              typedLanguage: 'ms',
              sentLanguage: 'zh',
              edited: false,
            }
          : null,
      },
    });
  });
}

test('a teammate reads a customer in their language, checks the translation, and sends it', async ({
  page,
  baseURL,
}, info) => {
  const jid = customerJid(info, 94);
  const sent: Record<string, unknown>[] = [];
  await stubLiveTranslate(page, jid, sent);
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  await fakeIncoming(
    page,
    { chatJid: jid, text: CUSTOMER_TEXT, senderName: 'Tan Wei Jie' },
    baseURL!,
  );
  await chatItem(page, jid).click();

  // Off: the real message, and a hint that only offers.
  const log = page.getByRole('log', { name: 'Messages' });
  await expect(log.getByText(CUSTOMER_TEXT)).toBeVisible();
  await expect(page.getByTestId('translate-hint')).toContainText('Customer writes in 中文');
  await expectNoHorizontalScroll(page, `translate off ${info.project.name}`);

  // On: the bubble in my language, the original one tap away.
  await page.locator('[data-testid="translate-toggle"]:visible').click();
  await expect(page.getByTestId('translate-bar')).toContainText('中文 → Bahasa Melayu');
  await expect(log.getByText(TRANSLATED)).toBeVisible();
  await log.getByRole('button', { name: 'Show original' }).click();
  await expect(log.getByText(CUSTOMER_TEXT)).toBeVisible();
  await expectNoHorizontalScroll(page, `translate on ${info.project.name}`);

  // Send shows what the customer will get; nothing is sent until the person agrees.
  const composer = page.getByLabel('Message', { exact: true });
  await expect(composer).toHaveAttribute(
    'placeholder',
    'You type Bahasa Melayu, the customer gets 中文',
  );
  await composer.fill('Satu kotak RM42.00.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const preview = page.getByTestId('translate-preview');
  await expect(preview).toContainText('Customer will get · 中文');
  await expect(preview.getByTestId('translate-preview-result')).toHaveText(DRAFT.translation);
  await expect(preview).toContainText('RM42.00');
  expect(sent).toHaveLength(0);
  await expectNoHorizontalScroll(page, `translate preview ${info.project.name}`);
  await preview.getByTestId('translate-send').click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({
    text: DRAFT.translation,
    translation: { draftId: 'draft-1', typedText: 'Satu kotak RM42.00.', typedLanguage: 'ms' },
  });

  // My bubble shows what I typed; the sent text is one tap away.
  await expect(log.getByText('Sent in 中文')).toBeVisible();
  await log.getByRole('button', { name: 'Show sent text' }).click();
  await expect(log.getByText(DRAFT.translation)).toBeVisible();

  // Turning it off brings back the real messages.
  await page.getByTestId('translate-languages').click();
  await page.getByTestId('translate-off').click();
  await expect(page.getByTestId('translate-bar')).toHaveCount(0);
  await expect(log.getByText(CUSTOMER_TEXT)).toBeVisible();
  await expect(log.getByText('Written in Bahasa Melayu')).toBeVisible();
});

test('a refused translation sends nothing, and the original can still go', async ({
  page,
  baseURL,
}, info) => {
  const jid = customerJid(info, 95);
  const sent: Record<string, unknown>[] = [];
  await stubLiveTranslate(page, jid, sent);
  await page.route(`**/api/chats/${encodeURIComponent(jid)}/translate-draft`, (route) =>
    route.fulfill({ json: { status: 'refused', item: 'RM42.00', became: 'RM24.00' } }),
  );
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  await fakeIncoming(
    page,
    { chatJid: jid, text: CUSTOMER_TEXT, senderName: 'Tan Wei Jie' },
    baseURL!,
  );
  await chatItem(page, jid).click();
  await page.locator('[data-testid="translate-toggle"]:visible').click();
  const composer = page.getByLabel('Message', { exact: true });
  await composer.fill('Satu kotak RM42.00.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByTestId('translate-preview')).toContainText(
    'RM42.00 became RM24.00. Nothing was sent.',
  );
  expect(sent).toHaveLength(0);
  await expectNoHorizontalScroll(page, `translate refused ${info.project.name}`);
  await page.getByTestId('translate-send-original').click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ text: 'Satu kotak RM42.00.', sentOriginal: true });
});

test('Account shows My language and Send without preview; Settings → AI has the admin switch', async ({
  page,
}, info) => {
  await page.route('**/api/live-translate', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        dailyLimit: 200,
        connected: true,
        usedToday: 0,
        peopleToday: 2,
        translationsToday: 17,
      },
    }),
  );
  await page.goto('/account');
  const mine = page.getByTestId('my-language');
  await expect(mine).toContainText('My language');
  await expect(mine.getByTestId('send-without-preview')).toHaveAttribute('aria-checked', 'false');
  await expectNoHorizontalScroll(page, `account my language ${info.project.name}`);

  // The admin card is the same install-wide setting for every project.
  test.skip(info.project.name !== 'desktop-chromium');
  await page.goto('/admin/settings/ai');
  const card = page.getByTestId('live-translate-settings');
  await expect(card.getByText('Live translate', { exact: true }).first()).toBeVisible();
  await expect(card.getByRole('switch', { name: 'Live translate for everyone' })).toBeChecked();
  await expect(card.getByTestId('live-translate-usage')).toContainText(
    '17 translations by 2 people',
  );
  await expectNoHorizontalScroll(page, 'settings/ai live translate');
});
