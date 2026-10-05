import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStoredLidMappings } from './stored-lid-mappings.js';

let dir: string;
const put = (name: string, content: string) => writeFileSync(join(dir, name), content);
const json = (v: unknown) => JSON.stringify(v);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wati-wa-auth-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readStoredLidMappings', () => {
  it('reads the forward and reverse lid-mapping files Baileys writes into wa-auth', () => {
    put('creds.json', json({ me: { id: '60000000000:12@s.whatsapp.net' } }));
    put('pre-key-1.json', json({ public: 'x' }));
    put('session-123456789.0.json', json({}));
    put('lid-mapping-60111111111.json', json('123456789'));
    put('lid-mapping-123456789_reverse.json', json('60111111111'));
    put('lid-mapping-222_reverse.json', json('60222222222')); // only the reverse file survived
    expect(readStoredLidMappings(dir)).toEqual([
      { jid: '60111111111@s.whatsapp.net', alias: '123456789@lid', source: 'keystore' },
      { jid: '60222222222@s.whatsapp.net', alias: '222@lid', source: 'keystore' },
    ]);
  });

  it("trusts a number's forward file over a stale reverse file and ignores ambiguous reverse files", () => {
    put('creds.json', json({ me: { id: '60000000000:12@s.whatsapp.net' } }));
    put('lid-mapping-60111111111.json', json('999'));
    put('lid-mapping-123456789_reverse.json', json('60111111111')); // the number moved to 999
    put('lid-mapping-301_reverse.json', json('60333333333'));
    put('lid-mapping-302_reverse.json', json('60333333333'));
    expect(readStoredLidMappings(dir)).toEqual([
      { jid: '60111111111@s.whatsapp.net', alias: '999@lid', source: 'keystore' },
    ]);
  });

  it('skips the linked account and unreadable, non-string or non-numeric files', () => {
    put('creds.json', json({ me: { id: '60000000000:12@s.whatsapp.net', lid: '500:12@lid' } }));
    put('lid-mapping-60000000000.json', json('500'));
    put('lid-mapping-60444444444.json', 'not json');
    put('lid-mapping-60555555555.json', json(555));
    put('lid-mapping-60666666666.json', json('abc'));
    expect(readStoredLidMappings(dir)).toEqual([]);
  });

  it('returns nothing for a missing directory and throws when wa-auth is not a directory', () => {
    expect(readStoredLidMappings(join(dir, 'missing'))).toEqual([]);
    put('wa-auth', 'not a directory');
    expect(() => readStoredLidMappings(join(dir, 'wa-auth'))).toThrow();
  });

  it('drops a LID claimed by more than one number', () => {
    put('creds.json', json({ me: { id: '60000000000:12@s.whatsapp.net' } }));
    put('lid-mapping-60111111111.json', json('700'));
    put('lid-mapping-60222222222.json', json('700')); // two forward files, same LID
    put('lid-mapping-60333333333.json', json('800'));
    put('lid-mapping-800_reverse.json', json('60333333333'));
    put('lid-mapping-900_reverse.json', json('60444444444'));
    put('lid-mapping-60555555555.json', json('900')); // forward + reverse-only claim LID 900
    expect(readStoredLidMappings(dir)).toEqual([
      { jid: '60333333333@s.whatsapp.net', alias: '800@lid', source: 'keystore' },
    ]);
  });

  it('fails closed when creds.json is missing, corrupt or has no account id', () => {
    put('lid-mapping-60111111111.json', json('123'));
    expect(() => readStoredLidMappings(dir)).toThrow(/creds\.json/);
    put('creds.json', 'not json');
    expect(() => readStoredLidMappings(dir)).toThrow(/creds\.json/);
    put('creds.json', json({ me: { lid: '500:12@lid' } }));
    expect(() => readStoredLidMappings(dir)).toThrow(/creds\.json/);
  });

  it('excludes both own identities and returns nothing without mapping files or creds', () => {
    expect(readStoredLidMappings(dir)).toEqual([]); // empty dir, no creds needed
    put('creds.json', json({ me: { id: '60000000000:12@s.whatsapp.net', lid: '500:12@lid' } }));
    put('lid-mapping-60000000000.json', json('1'));
    put('lid-mapping-60777777777.json', json('500'));
    put('lid-mapping-60888888888.json', json('888'));
    expect(readStoredLidMappings(dir)).toEqual([
      { jid: '60888888888@s.whatsapp.net', alias: '888@lid', source: 'keystore' },
    ]);
  });

  it('skips oversized and non-regular mapping files', () => {
    put('creds.json', json({ me: { id: '60000000000:12@s.whatsapp.net' } }));
    put('lid-mapping-60111111111.json', json('1'.repeat(2000)));
    mkdirSync(join(dir, 'lid-mapping-60222222222.json'));
    expect(readStoredLidMappings(dir)).toEqual([]);
  });
});
