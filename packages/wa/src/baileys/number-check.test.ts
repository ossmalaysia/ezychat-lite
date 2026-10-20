import { describe, expect, it } from 'vitest';
import { checkedNumberJid } from './number-check.js';

describe('checkedNumberJid', () => {
  it('returns the phone JID WhatsApp reports for a number with an account', async () => {
    const asked: string[] = [];
    const jid = await checkedNumberJid('60128887777', async (j) => {
      asked.push(j);
      return [{ jid: '60128887777@s.whatsapp.net', exists: true }];
    });
    expect(jid).toBe('60128887777@s.whatsapp.net');
    expect(asked).toEqual(['60128887777@s.whatsapp.net']);
  });

  it('returns null for no account, an empty or missing answer, and never asks for a non-number', async () => {
    expect(await checkedNumberJid('60111000003', async () => [])).toBeNull();
    expect(await checkedNumberJid('60111000003', async () => undefined)).toBeNull();
    expect(
      await checkedNumberJid('60111000003', async () => [
        { jid: '60111000003@s.whatsapp.net', exists: false },
      ]),
    ).toBeNull();
    let called = false;
    expect(
      await checkedNumberJid('12ab', async () => {
        called = true;
        return [];
      }),
    ).toBeNull();
    expect(called).toBe(false);
  });

  it('passes a WhatsApp request error on to the caller', async () => {
    await expect(
      checkedNumberJid('60128887777', () => Promise.reject(new Error('timed out'))),
    ).rejects.toThrow('timed out');
  });
});
