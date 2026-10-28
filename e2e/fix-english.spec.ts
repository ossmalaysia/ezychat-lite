import {
  chatItem,
  customerJid,
  expect,
  expectNoHorizontalScroll,
  fakeIncoming,
  inboxHeading,
  test,
} from './helpers';

// Spelling runs for real (the dictionary in the browser); the grammar check is answered in the
// browser, so no model is ever called.
const DRAFT = 'Hi Nurul, your order have been ready tommorow. pls check ';

test('Fix English marks spelling at once and grammar after a pause; Fix all and Undo', async ({
  page,
  baseURL,
}, info) => {
  const jid = customerJid(info, 93);
  const mobile = ['mobile', 'iphone'].includes(info.project.name);
  await page.route('**/api/fix-english', (route) =>
    route.fulfill({
      json: { enabled: true, connected: true, spelling: 'on', grammar: 'on', upgraded: false },
    }),
  );
  await page.route('**/ai/fix-grammar', (route) =>
    route.fulfill({
      json: {
        status: 'checked',
        issues: [{ start: 21, end: 25, original: 'have', replacement: 'has' }],
      },
    }),
  );
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  await fakeIncoming(
    page,
    { chatJid: jid, text: 'Is my order ready?', senderName: 'Nurul' },
    baseURL!,
  );
  await chatItem(page, jid).click();

  const composer = page.getByLabel('Message', { exact: true });
  await composer.fill(DRAFT);
  const marks = page.getByTestId('fix-english-marks').locator('[data-issue]');
  await expect(marks).toHaveText(['have', 'tommorow', 'pls']);
  await expect(composer).toHaveAttribute('spellcheck', 'false');
  await expectNoHorizontalScroll(page, `fix english ${info.project.name}`);

  // One word from its card: hover on desktop, tap on a phone.
  const word = marks.filter({ hasText: 'tommorow' });
  const box = (await word.boundingBox())!;
  if (mobile) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const card = page.getByTestId('fix-english-card');
  await expect(card).toContainText('Spelling');
  await card.getByRole('button', { name: 'tomorrow' }).click();
  await expect(composer).toHaveValue('Hi Nurul, your order have been ready tomorrow. pls check ');

  // Everything else at once, then Undo.
  await page.getByTestId('fix-english-fix-all').click();
  await expect(composer).toHaveValue('Hi Nurul, your order has been ready tomorrow. Please check ');
  await expect(page.getByTestId('fix-english-undo')).toContainText('2 fixed');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(composer).toHaveValue('Hi Nurul, your order have been ready tomorrow. pls check ');
});

test('Settings → AI shows Fix English with the team words', async ({ page }, info) => {
  // One install-wide list shared by the projects.
  test.skip(info.project.name !== 'desktop-chromium');
  await page.goto('/admin/settings/ai');
  const card = page.getByTestId('fix-english-settings');
  await expect(card.getByText('Fix English', { exact: true })).toBeVisible();
  await expect(card.getByText(/built-in British English dictionary/)).toBeVisible();
  const words = card.getByTestId('team-words');
  await words.getByRole('textbox', { name: 'New team word' }).fill('cendol');
  await words.getByRole('button', { name: 'Add word' }).click();
  await expect(words.getByText('cendol', { exact: true })).toBeVisible();
  await words.getByRole('button', { name: 'Remove cendol' }).click();
  await expect(words.getByText('cendol', { exact: true })).toHaveCount(0);
  await expectNoHorizontalScroll(page, 'settings/ai fix english');
});
