import {
  chatItem,
  customerJid,
  expect,
  expectNoHorizontalScroll,
  fakeIncoming,
  inboxHeading,
  test,
} from './helpers';

// Never contacts a model: the questions are answered in the browser (NDJSON like the server streams),
// so the whole panel runs against the real web app without any provider.
const ndjson = (...events: object[]) => events.map((e) => JSON.stringify(e)).join('\n') + '\n';

test('the real server answers that no AI is connected: Ask Ezy shows the setup first', async ({
  page,
}) => {
  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  await page.locator('[data-testid="ask-ezy-open"]:visible').first().click();
  const panel = page.getByTestId('ask-ezy-panel');
  await expect(panel.getByText('Connect an AI to use Ask Ezy')).toBeVisible();
  await expect(panel.getByRole('textbox')).toBeDisabled();
  await expectNoHorizontalScroll(page, 'Ask Ezy setup first');
});

test('an admin asks about the week, applies a change and asks about one chat', async ({
  page,
  baseURL,
}, info) => {
  const jid = customerJid(info, 93);
  const asked: Array<{ question: string; chatJid: string | null }> = [];
  await page.route('**/api/ask-ezy/status', (route) =>
    route.fulfill({ json: { connected: true } }),
  );
  await page.route('**/api/ask-ezy', async (route) => {
    const body = route.request().postDataJSON() as { question: string; chatJid: string | null };
    asked.push(body);
    const answer = body.chatJid
      ? {
          text: 'Nurul wants two Nasi Lemak at 1 PM.',
          steps: [{ key: 'get_chat', count: 1 }],
          followUps: [],
          blocks: [
            {
              type: 'customer',
              jid: body.chatJid,
              name: 'Nurul',
              facts: ['1 message'],
              points: ['Two Nasi Lemak for pickup at 1 PM.'],
              open: ['Pickup time not confirmed.'],
              next: 'Confirm the pickup time.',
            },
          ],
        }
      : body.question.startsWith('Fix')
        ? {
            text: 'One change.',
            steps: [{ key: 'propose_ai_setup_change', count: 1 }],
            followUps: [],
            blocks: [
              {
                type: 'change',
                id: 'c1',
                agent: 'Aina',
                title: 'Delivery to Bayan Lepas',
                target: 'context_text',
                itemName: 'Delivery areas',
                added: 1,
                removed: 0,
                before: 'We deliver in George Town.',
                after: 'We deliver in George Town.\nBayan Lepas: RM8.',
                reason: '4 customers asked about Bayan Lepas.',
                status: 'proposed',
              },
            ],
          }
        : {
            text: 'A good week.',
            steps: [{ key: 'get_stats', count: 1 }],
            followUps: ['Fix my knowledge and hand-off rules'],
            blocks: [
              {
                type: 'stats',
                items: [{ label: 'New conversations', value: '18', change: '+4', good: true }],
              },
            ],
          };
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body: ndjson(
        { type: 'step', key: answer.steps[0]!.key, count: 1 },
        { type: 'answer', answer },
      ),
    });
  });
  await page.route('**/api/ask-ezy/changes/c1/apply', (route) =>
    route.fulfill({ json: { status: 'applied', version: 7 } }),
  );

  await page.goto('/');
  await expect(inboxHeading(page)).toBeVisible();
  await page.locator('[data-testid="ask-ezy-open"]:visible').first().click();
  const panel = page.getByTestId('ask-ezy-panel');
  await panel.getByRole('button', { name: 'How is my inbox this week?' }).click();
  await expect(panel.getByTestId('ask-block-stats')).toContainText('18');
  await expect(panel.getByText('Ezy read: inbox statistics')).toBeVisible();
  await expectNoHorizontalScroll(page, 'Ask Ezy stats answer');

  await panel.getByRole('button', { name: 'Fix my knowledge and hand-off rules' }).click();
  const card = panel.getByTestId('ask-block-change-c1');
  await expect(card).toContainText('Adds 1 line · Business context · Delivery areas · Aina');
  await card.getByRole('button', { name: 'Apply' }).click();
  await expect(card).toContainText('Applied to Aina’s setup.');
  await panel.getByRole('button', { name: 'Close Ask Ezy' }).click();

  await fakeIncoming(
    page,
    { chatJid: jid, text: 'Can I order two Nasi Lemak for pickup at 1pm?', senderName: 'Nurul' },
    baseURL!,
  );
  await chatItem(page, 'Nurul').click();
  await page.getByTestId('ask-ezy-about-chat').click();
  await expect(panel.getByTestId('ask-block-customer')).toContainText('Confirm the pickup time.');
  expect(asked.at(-1)).toMatchObject({ chatJid: jid });
  await expectNoHorizontalScroll(page, 'Ask Ezy chat summary');
});
