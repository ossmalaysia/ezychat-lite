import { describe, expect, it } from 'vitest';
import { i18n } from '../i18n';
import { connectedAsLabel } from './connected-label';

const t = i18n.getFixedT('en', 'auth');

describe('connectedAsLabel', () => {
  it('shows the linked phone number', () => {
    expect(connectedAsLabel({ jid: '60123456789:3@s.whatsapp.net', name: 'Shop' }, t)).toBe(
      'Connected as Shop (+60123456789).',
    );
    expect(connectedAsLabel({ jid: '60123456789@s.whatsapp.net', name: null }, t)).toBe(
      'Connected as +60123456789.',
    );
  });

  it('never leaves the number empty for a WhatsApp ID (LID) account', () => {
    expect(connectedAsLabel({ jid: '123456789012345:3@lid', name: 'Shop' }, t)).toBe(
      'Connected as Shop.',
    );
    expect(connectedAsLabel({ jid: '123456789012345@lid', name: null }, t)).toBe('Connected.');
    expect(connectedAsLabel(null, t)).toBe('Connected.');
  });
});
