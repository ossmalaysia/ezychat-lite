import type { Page } from '@playwright/test';
import {
  chatHref,
  customerJid,
  expect,
  expectNoHorizontalScroll,
  inboxHeading,
  projectTag,
  signIn,
  test,
} from './helpers';

/** A minimal ZIP whose only file is a fake PDF that is really a script (the statement-of-account lure). */
function lureZip(inside: string): Buffer {
  const name = Buffer.from(inside, 'latin1');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(name.length, 28);
  const dir = Buffer.concat([central, name]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(30 + name.length, 16);
  return Buffer.concat([local, name, dir, eocd]);
}

async function signInAgent(page: Page, username: string, temp: string): Promise<void> {
  await signIn(page, username, temp);
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel('Current password').fill(temp);
  await page.getByLabel('New password', { exact: true }).fill(`${temp}-new`);
  await page.getByLabel('Confirm new password').fill(`${temp}-new`);
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(inboxHeading(page)).toBeVisible();
}

test('WhatsApp Safety: a ZIP lure is flagged, locked for agents, reported and counted in Reports', async ({
  page,
  browser,
  baseURL,
}, info) => {
  // Two signed-in people and four screens.
  test.setTimeout(150_000);
  const tag = projectTag(info);
  const jid = customerJid(info, 71);
  const sender = `Accounts Dept ${tag}`;
  const origin = new URL(baseURL!).origin;
  const sent = await page.request.post('/api/dev/fake-incoming', {
    headers: { Origin: origin },
    data: {
      chatJid: jid,
      senderName: sender,
      text: 'Please forward this statement of account to your finance manager. Open it on a laptop.',
      type: 'document',
      media: {
        mime: 'application/zip',
        fileName: `Statement_${tag}.zip`,
        base64: lureZip(`Statement_${tag}.pdf.vbs`).toString('base64'),
      },
    },
  });
  expect(sent.status(), await sent.text()).toBe(200);

  // The admin sees the warning and the file locked for the team.
  await page.goto(chatHref(jid));
  const notice = page.getByTestId('safety-notice');
  await expect(notice).toHaveAttribute('data-level', 'high');
  await expect(notice).toContainText("Don't open this file");
  await expect(notice).toContainText('The ZIP hides a program, not a document.');
  await expect(page.getByTestId('safety-file')).toContainText('Locked for your team');
  await expectNoHorizontalScroll(page, 'safety chat');

  // An agent cannot download it; the try is recorded.
  const username = `safety${tag}${String(Date.now()).slice(-5)}`;
  const temp = 'agent-temp-123';
  const created = await page.request.post('/api/users', {
    headers: { Origin: origin },
    data: { username, displayName: `Daniel ${tag}`, role: 'agent', password: temp },
  });
  expect(created.ok(), await created.text()).toBe(true);
  // A fresh sign-in: the project's saved admin session must not carry over.
  const agent = await (
    await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  ).newPage();
  try {
    await signInAgent(agent, username, temp);
    await agent.goto(chatHref(jid));
    const file = agent.getByTestId('safety-file');
    await expect(file).toHaveAttribute('data-locked', 'true');
    const refused = agent.waitForResponse((r) =>
      new URL(r.url()).pathname.startsWith('/api/media/'),
    );
    await file.click();
    expect((await refused).status()).toBe(403);
    await expect(agent.getByText('This file is locked. Ask an admin to unlock it.')).toBeVisible();
  } finally {
    await agent.context().close();
  }

  // Admin → Safety: who sent it, from which number, and who tried to download it; report and block.
  await page.goto('/admin/safety');
  const row = page.getByTestId('safety-row').filter({ hasText: sender });
  await expect(row).toContainText('New number');
  await expect(row).toContainText('File locked');
  await expectNoHorizontalScroll(page, 'safety page');
  await row.click();
  const sheet = page.getByTestId('safety-sheet');
  await expect(sheet).toContainText(`Inside the ZIP: Statement_${tag}.pdf.vbs`);
  await expect(sheet).toContainText(`Daniel ${tag} tried to download it (locked)`);
  await sheet.getByTestId('safety-report').click();
  await expect(page.getByTestId('safety-report-dialog')).toContainText('997');
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  await expect(sheet).toContainText('Blocked');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
  await page.getByRole('tab', { name: 'Blocked' }).click();
  await expect(page.getByTestId('safety-blocked')).toContainText(sender);

  // The chat shows the number is blocked.
  await page.goto(chatHref(jid));
  await expect(page.getByTestId('safety-chat-bar')).toHaveAttribute('data-kind', 'blocked');

  // Admin → Reports → WhatsApp Safety counts it.
  await page.goto('/admin/reports');
  const section = page.getByTestId('report-safety');
  await expect(section).toBeVisible();
  await expect(section.getByTestId('safety-totals')).toContainText('Dangerous files');
  await expect(section.getByTestId('card-safety-senders')).toContainText(sender);
  await expectNoHorizontalScroll(page, 'reports safety');
});
