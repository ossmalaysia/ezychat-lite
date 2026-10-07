import { expect, it } from 'vitest';
import { i18n } from '../i18n';
import { auditActionLabel, auditDetails } from './audit-actions';

it('labels startup chat merges in the audit log', () => {
  expect(auditActionLabel('chat.merge', i18n.getFixedT('en', 'admin'))).toBe('Chats merged');
});

it('labels customer detail changes and lists the changed fields, never the WhatsApp ID', () => {
  const t = i18n.getFixedT('en', 'admin');
  expect(auditActionLabel('customer.profile_update', t)).toBe('Customer details updated');
  expect(
    auditDetails(
      'customer.profile_update',
      { chatJid: '60123456789@s.whatsapp.net', changed: ['name', 'tags'] },
      t,
    ),
  ).toBe('Changed name, tags · +60123456789');
  const lid = auditDetails(
    'customer.profile_update',
    { chatJid: '888000222@lid', changed: ['otherPhone'] },
    t,
  );
  expect(lid).toBe('Changed other phone');
  expect(lid).not.toContain('888000222');
});

it('keeps the generic key: value summary for other actions', () => {
  const t = i18n.getFixedT('en', 'admin');
  expect(auditDetails('user.update', { username: 'mei', role: 'agent' }, t)).toBe(
    'username: mei, role: agent',
  );
});
