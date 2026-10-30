// Screenshots of Ask Ezy in the real app (fresh standalone server with --fake-wa), for docs/screenshots/ask-ezy.
// Ask Ezy's status, questions and Apply are answered in the browser with demo answers (the NDJSON stream
// the server sends), so no model is ever called.
// Usage: node e2e/ask-ezy-screens.mjs <port> <outDir>
import {
  apiPost,
  eachScreen,
  launchBrowser,
  screensArgs,
  shot,
  signInDemoAdmin,
} from './screens-common.mjs';

const { base: BASE, out: OUT } = screensArgs('ask-ezy-screens');
const FARAH = '60123110021@s.whatsapp.net';
const PRIYA = '60124410087@s.whatsapp.net';
const SITI = '60127730045@s.whatsapp.net';

const WEEK = {
  text: 'The last 7 days were good: more new conversations, and the AI agent answered most questions by itself.',
  steps: [{ key: 'get_stats', count: 1 }],
  followUps: ['Why does the AI hand off chats?', 'Which customers wait for a reply?'],
  blocks: [
    {
      type: 'stats',
      items: [
        { label: 'New conversations', value: '18', change: '+4 vs the 7 days before', good: true },
        { label: 'Waiting for a reply', value: '3', note: 'Longest: 42 min' },
        {
          label: 'Answered by the AI agent',
          value: '42',
          change: '+11 vs the 7 days before',
          good: true,
        },
        {
          label: 'Handed off to the team',
          value: '9',
          change: '−2 vs the 7 days before',
          good: true,
        },
      ],
    },
  ],
};
const WAITING = {
  text: 'Three customers wait for a reply. Priya has waited the longest.',
  steps: [{ key: 'list_chats', count: 3 }],
  followUps: ['Summarise the chat with Priya Nair'],
  blocks: [
    {
      type: 'chats',
      title: 'Waiting for a reply',
      chats: [
        {
          jid: PRIYA,
          name: 'Priya Nair',
          preview: 'Is the 2 kg kopi bag back in stock?',
          wait: '42 min',
          assignee: null,
        },
        {
          jid: SITI,
          name: 'Siti Rahman',
          preview: 'Ada hantar ke Bayan Lepas tak?',
          wait: '15 min',
          assignee: null,
        },
        {
          jid: FARAH,
          name: 'Farah Aziz',
          preview: 'Can I book catering for 30 people?',
          wait: '6 min',
          assignee: 'Mei Ling',
        },
      ],
    },
  ],
};
const CHANGE = {
  text: 'Four customers asked about delivery to Bayan Lepas and the AI agent had no answer. This change adds the fee. Nothing changes until you press Apply.',
  steps: [
    { key: 'get_stats', count: 1 },
    { key: 'get_ai_agent_setup', count: 1 },
    { key: 'try_ai_reply', count: 2 },
  ],
  followUps: ['Which customers wait for a reply?'],
  blocks: [
    {
      type: 'change',
      id: 'demo-change-1',
      agent: 'Aina',
      title: 'Delivery to Bayan Lepas',
      target: 'context_text',
      itemName: 'Delivery areas',
      added: 1,
      removed: 0,
      before: 'We deliver in George Town and Jelutong: RM5, same day for orders before 3 pm.',
      after:
        'We deliver in George Town and Jelutong: RM5, same day for orders before 3 pm.\nBayan Lepas: RM8, same day for orders before 3 pm.',
      reason:
        '4 customers asked about Bayan Lepas this week; the AI agent had no answer and handed each one off.',
      test: {
        question: 'Ada hantar ke Bayan Lepas tak? Berapa caj?',
        before: 'Saya akan serahkan kepada pasukan kami untuk membantu anda.',
        after:
          'Ya, kami hantar ke Bayan Lepas: RM8, hari yang sama untuk pesanan sebelum 3 petang.',
      },
      status: 'proposed',
    },
  ],
};
const SUMMARY = {
  text: 'Farah wants catering for 30 people this Saturday; the deposit is not confirmed yet.',
  steps: [
    { key: 'get_chat', count: 1 },
    { key: 'get_messages', count: 2 },
  ],
  followUps: ['What should I reply to Farah?'],
  blocks: [
    {
      type: 'customer',
      jid: FARAH,
      name: 'Farah Aziz',
      facts: ['Farah Catering Co', 'Tags: VIP, Catering'],
      points: ['Asked to book catering for 30 people this Saturday.', 'Was told RM12 per person.'],
      open: ['The deposit is not confirmed yet.'],
      next: 'Confirm the deposit with Farah today.',
    },
  ],
};
const answerFor = (question) =>
  /week/i.test(question)
    ? WEEK
    : /wait/i.test(question)
      ? WAITING
      : /fix|improve|knowledge/i.test(question)
        ? CHANGE
        : SUMMARY;

const cookie = await signInDemoAdmin(BASE);
for (const [jid, name, text] of [
  [FARAH, 'Farah Aziz', 'Can I book catering for 30 people this Saturday?'],
  [SITI, 'Siti Rahman', 'Ada hantar ke Bayan Lepas tak? Berapa caj?'],
  [PRIYA, 'Priya Nair', 'Is the 2 kg kopi bag back in stock?'],
])
  await apiPost(BASE, '/dev/fake-incoming', { chatJid: jid, senderName: name, text }, cookie);

const browser = await launchBrowser();
const problems = [];
await eachScreen(browser, BASE, cookie, async (ctx, tag) => {
  await ctx.route('**/api/ask-ezy/status', (r) => r.fulfill({ json: { connected: true } }));
  await ctx.route('**/api/ask-ezy', (r) => {
    const { question } = r.request().postDataJSON();
    const answer = answerFor(question);
    const lines = [
      ...answer.steps.map((s) => ({ type: 'step', ...s })),
      { type: 'answer', answer },
    ];
    return r.fulfill({
      contentType: 'application/x-ndjson',
      body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    });
  });
  await ctx.route('**/api/ask-ezy/changes/*/apply', (r) =>
    r.fulfill({ json: { status: 'applied', version: 7 } }),
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
  const panel = page.getByTestId('ask-ezy-panel');
  const ask = async (question) => {
    // A new question starts a clean conversation (the first one has nothing to clear).
    await panel
      .getByRole('button', { name: 'Start over' })
      .click({ timeout: 1_000 })
      .catch(() => {});
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Start over' })
      .click({ timeout: 1_000 })
      .catch(() => {});
    await panel.getByRole('textbox').fill(question);
    await panel.getByRole('button', { name: 'Send' }).click();
    await panel.getByTestId('ask-ezy-answer').last().waitFor();
  };

  await page.goto('/');
  await page.locator('[data-testid="ask-ezy-open"]:visible').first().click();
  await panel.getByText('Try one').waitFor();
  await shot(page, OUT, problems, tag, 'start');
  await ask('How is my inbox this week?');
  await shot(page, OUT, problems, tag, 'week-stats');
  await ask('Which customers wait for a reply?');
  await shot(page, OUT, problems, tag, 'waiting-chats');
  await ask('Fix my knowledge and hand-off rules');
  await panel.getByTestId('ask-block-change-demo-change-1').scrollIntoViewIfNeeded();
  await shot(page, OUT, problems, tag, 'suggested-change');
  await panel
    .getByTestId('ask-block-change-demo-change-1')
    .getByRole('button', { name: 'Apply' })
    .click();
  await panel.getByText('Undo stays here', { exact: false }).waitFor();
  await shot(page, OUT, problems, tag, 'applied-undo');
  await panel.getByRole('button', { name: 'Close Ask Ezy' }).click();

  await page.goto(`/chats/${encodeURIComponent(FARAH)}`);
  await page.getByTestId('ask-ezy-about-chat').click();
  await panel.getByTestId('ask-block-customer').waitFor();
  await shot(page, OUT, problems, tag, 'chat-summary');
});
await browser.close();
console.log(problems.length ? `Problems:\n${problems.join('\n')}` : 'No problems found.');
console.log(`Saved Ask Ezy screenshots in ${OUT}`);
