import { expect, it } from 'vitest';
import { i18n } from '../i18n';
import { auditActionLabel } from './audit-actions';

it('labels startup chat merges in the audit log', () => {
  expect(auditActionLabel('chat.merge', i18n.getFixedT('en', 'admin'))).toBe('Chats merged');
});
