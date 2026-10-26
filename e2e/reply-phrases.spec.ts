import {
  chatItem,
  customerJid,
  expect,
  expectNoHorizontalScroll,
  fakeIncoming,
  inboxHeading,
  test,
} from './helpers';

// Never contacts a model: the status, the phrase list and the admin answers come from the browser,
// so the real web app runs the whole phrase flow without any provider (the server side is tested
// against the real server in packages/server/test/reply-phrases.test.ts).
const PHRASES = [
  { id: 7, text: 'Thank you for your message! We will get back to you shortly.', language: 'en' },
  { id: 8, text: 'Our opening hours are 8am to 10pm daily.', language: 'en' },
  { id: 9, text: '谢谢您的留言！我们会尽快回复您。', language: 'zh' },
];
const ADMIN = {
  agentId: 1,
  status: {
    state: 'ready',
    count: 3,
    languages: [
      { language: 'en', count: 2 },
      { language: 'zh', count: 1 },
    ],
    updatedAt: Date.now() - 12 * 60_000,
    trigger: 'replies',
    newReplies: 18,
    nextAfterReplies: 30,
    aiCallsToday: 4,
    aiCallsLimit: 24,
  },
  phrases: PHRASES.map((p, i) => ({
    ...p,
    source: i === 1 ? 'context' : 'team',
    uses: 10 - i,
    fact: i === 1,
  })),
};

test('a phrase from the team list shows at once, with no model call, and Tab counts it', async ({
  page,
  baseURL,
}, info) => {
  const jid = customerJid(info, 92);
  const feedback: unknown[] = [];
  let completions = 0;
  await page.route('**/api/reply-suggestions', (route) =>
    route.fulfill({ json: { enabled: true, connected: true, state: 'on', upgraded: false } }),
  );
  await page.route('**/ai/phrases', (route) => route.fulfill({ json: { phrases: PHRASES } }));
  await page.route('**/ai/phrases/*/feedback', (route) => {
    feedback.push(route.request().postDataJSON());
    return route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/ai/complete', (route) => {
    completions++;
    return route.fulfill({ json: { completion: null } });
  });
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  await fakeIncoming(
    page,
    { chatJid: jid, text: 'What time do you open?', senderName: 'Nurul' },
    baseURL!,
  );
  await chatItem(page, jid).click();

  const composer = page.getByLabel('Message', { exact: true });
  const ghost = page.getByTestId('completion-ghost');
  await composer.pressSequentially('Our open', { delay: 30 });
  await expect(ghost).toHaveText('Our opening hours are 8am to 10pm daily.');
  expect(completions).toBe(0);
  if (['mobile', 'iphone'].includes(info.project.name))
    await page.getByTestId('accept-completion').click();
  else await composer.press('Tab');
  await expect(composer).toHaveValue('Our opening hours are 8am to 10pm daily.');
  await expect.poll(() => feedback).toEqual([{ accepted: true }]);
  await expectNoHorizontalScroll(page, `phrase grey text ${info.project.name}`);

  // Chinese: each character is a word.
  await composer.fill('');
  await composer.pressSequentially('谢谢您', { delay: 30 });
  await expect(ghost).toHaveText('谢谢您的留言！我们会尽快回复您。');
});

test('Settings → AI shows the model for suggestions and the phrase list', async ({
  page,
}, info) => {
  test.skip(!['desktop-chromium', 'mobile'].includes(info.project.name));
  await page.route('**/api/reply-suggestions', (route) =>
    route.fulfill({ json: { enabled: true, connected: true, state: 'on', upgraded: false } }),
  );
  await page.route('**/api/ai/reply-suggestions/model', (route) =>
    route.fulfill({
      json: {
        model: 'fast',
        fastModel: 'gpt-6-luna',
        agentModel: 'gpt-6.1-sol',
        models: ['gpt-6.1-sol', 'gpt-6-luna'],
        resolved: 'gpt-6-luna',
      },
    }),
  );
  await page.route('**/api/ai/phrases?*', (route) => route.fulfill({ json: ADMIN }));
  await page.goto('/admin/settings/ai');
  const suggest = page.getByTestId('reply-suggestions-settings');
  await expect(suggest.getByText('Fast (recommended): gpt-6-luna')).toBeVisible();
  const card = page.getByTestId('phrase-dictionary-settings');
  await expect(card.getByText('Phrases: 3')).toBeVisible();
  await expect(card.getByText('English · 2')).toBeVisible();
  await expectNoHorizontalScroll(page, `settings/ai phrases ${info.project.name}`);
  await card.getByRole('button', { name: 'View phrases' }).click();
  const list = page.getByTestId('phrase-list');
  await expect(list.getByTestId('phrase-row')).toHaveCount(3);
  await expect(list.getByText('Fact checked against the business context')).toBeVisible();
  await expectNoHorizontalScroll(page, `phrase list ${info.project.name}`);
});
