import { describe, expect, it } from 'vitest';
import type { WaState } from '@ezychat/shared';
import { i18n } from '../i18n';
import { formatInboxNumber, inboxCardStatus } from './inbox-status';

const t = i18n.getFixedT('en', 'admin');

describe('inboxCardStatus', () => {
  it.each([
    ['open', 'success', 'Connected', null, false],
    ['qr', 'warning', 'Waiting for the QR scan', 'scan', true],
    ['logged_out', 'warning', 'Waiting for the QR scan', 'scan', true],
    ['disconnected', 'danger', 'Phone offline', 'offline', false],
    ['connecting', 'warning', 'Connecting', null, false],
    ['replaced', 'danger', 'Opened elsewhere', 'replaced', false],
    ['blocked', 'danger', 'Blocked', null, true],
  ] as const)('%s → %s "%s"', (state, tone, label, notice, needsLink) => {
    const s = inboxCardStatus(state);
    expect(s.tone).toBe(tone);
    expect(t(s.labelKey as never)).toBe(label);
    expect(s.notice).toBe(notice);
    expect(s.needsLink).toBe(needsLink);
  });

  it('keeps a state the web does not know yet neutral', () => {
    expect(inboxCardStatus('future' as WaState)).toEqual({
      tone: 'muted',
      labelKey: '',
      notice: null,
      needsLink: false,
    });
  });
});

describe('formatInboxNumber', () => {
  it('adds the plus sign to WhatsApp digits and leaves other text as it is', () => {
    expect(formatInboxNumber('60112233445')).toBe('+60112233445');
    expect(formatInboxNumber('+60 11-2233 4455')).toBe('+60 11-2233 4455');
    expect(formatInboxNumber(null)).toBeNull();
    expect(formatInboxNumber('')).toBeNull();
  });
});
