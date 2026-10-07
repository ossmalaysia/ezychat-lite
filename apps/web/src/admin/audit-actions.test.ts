import { describe, expect, it } from 'vitest';
import { i18n } from '../i18n';
import { auditActionLabel, auditDetails, isSignInAction } from './audit-actions';

const t = i18n.getFixedT('en', 'admin');

it('labels startup chat merges in the audit log', () => {
  expect(auditActionLabel('chat.merge', t)).toBe('Chats merged');
});

// Every action the server writes (packages/server/src/**: `action: '…'` and `record(req, '…')`).
const SERVER_ACTIONS = [
  'ai.connection_update',
  'ai.document_add',
  'ai.document_remove',
  'ai.document_update',
  'ai.handoff',
  'ai.member_update',
  'ai.resolve',
  'ai.voice_model_cancel',
  'ai.voice_model_download',
  'ai.voice_model_remove',
  'ai.voice_update',
  'auth.change_password',
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.reset_admin_cli',
  'chat.merge',
  'chats.resolve_all',
  'cloudflare.create',
  'cloudflare.login',
  'logs.download',
  'quick_reply.create',
  'quick_reply.delete',
  'quick_reply.update',
  'settings.update',
  'setup.admin',
  'tunnel.start',
  'tunnel.stop',
  'user.create',
  'user.reset_password',
  'user.revoke_sessions',
  'user.update',
  'wa.logout',
  'wa.pairing_code',
  'wa.relink',
  'wa.takeover',
];

describe('auditActionLabel', () => {
  it.each(SERVER_ACTIONS)('has a human label for %s', (action) => {
    const label = auditActionLabel(action, t);
    expect(label).not.toBe(action);
    expect(label).not.toMatch(/[._]/);
  });

  it('turns an action the catalog does not know yet into words that wrap', () => {
    expect(auditActionLabel('order.status_change', t)).toBe('Order status change');
  });
});

describe('auditDetails', () => {
  const names = (id: number) => ({ 2: 'Bob Agent' })[id];

  it('shows phone numbers instead of chat JIDs and changed fields as a sentence', () => {
    expect(
      auditDetails({ chatJid: '60129001234@s.whatsapp.net', changed: ['name', 'tags'] }, t, names),
    ).toBe('Chat: +60129001234 · Changed name, tags');
  });

  it('names members instead of ids and skips empty values', () => {
    expect(auditDetails({ targetId: 2, role: 'admin', model: '' }, t, names)).toBe(
      'Member: Bob Agent · Role: Admin',
    );
    expect(auditDetails({ targetId: 9 }, t, names)).toBe('Member: User #9');
  });

  it('summarises change flags and settings patches without raw JSON', () => {
    expect(
      auditDetails(
        { enabled: false, role: 'sales', instructionsChanged: true, handoffRulesChanged: false },
        t,
        names,
      ),
    ).toBe('Changed instructions · Enabled: No · Role: AI · Sales Agent');
    expect(
      auditDetails({ changes: { lanEnabled: true, port: 7500 }, restartRequired: true }, t, names),
    ).toBe('Changed LAN access, port · Restart required: Yes');
    expect(auditDetails({ mode: 'api', model: '' }, t, names)).toBe('Mode: API key');
  });

  it('summarises object values such as the moved counts of a chat merge instead of dropping them', () => {
    const details = auditDetails(
      {
        from: '60129001234@s.whatsapp.net',
        to: '888000111@lid',
        moved: { messages: 12, events: 0, notes: 1, aiState: 0 },
      },
      t,
      names,
    );
    expect(details).toContain('messages 12');
    expect(details).toContain('notes 1');
    expect(details).not.toContain('[object Object]');
  });

  it('is empty when there is nothing to show', () => {
    expect(auditDetails({}, t, names)).toBe('');
  });
});

it('treats only successful sign-ins and sign-outs as routine', () => {
  expect(isSignInAction('auth.login')).toBe(true);
  expect(isSignInAction('auth.logout')).toBe(true);
  expect(isSignInAction('auth.login_failed')).toBe(false);
  expect(isSignInAction('user.update')).toBe(false);
});

it('labels customer detail changes and lists the changed fields, never the WhatsApp ID', () => {
  expect(auditActionLabel('customer.profile_update', t)).toBe('Customer details updated');
  expect(
    auditDetails(
      { chatJid: '60123456789@s.whatsapp.net', changed: ['company', 'otherPhone'] },
      t,
      () => undefined,
    ),
  ).toBe('Chat: +60123456789 · Changed company, other phone');
  const lid = auditDetails({ chatJid: '888000222@lid', changed: ['email'] }, t, () => undefined);
  expect(lid).toBe('Changed email');
  expect(lid).not.toContain('888000222');
});
